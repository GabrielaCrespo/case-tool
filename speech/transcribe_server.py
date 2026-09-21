"""CU04 — Servicio local de transcripción de voz (Speech-to-Text).

Convierte audio en texto y nada más. No sabe qué es una clase UML, ni un
atributo, ni una relación: lo que dice el usuario sale de aquí como una frase
en castellano y entra en el mismo flujo de CU04 que una instrucción escrita.
Esa es toda su responsabilidad, y por eso el backend sigue siendo NestJS.

Se usa faster-whisper en local: ni el audio ni la transcripción salen de la
máquina. El modelo se descarga la primera vez que se arranca el servicio y
queda en la caché de Hugging Face.

Se ha escrito con la biblioteca estándar de Python a propósito. Un framework
web aquí sólo añadiría dependencias que instalar y mantener para recibir un
POST con unos bytes: NestJS manda el audio en el cuerpo, tal cual, con su
Content-Type, así que no hace falta ni interpretar multipart.

Arranque:

    whisper-env/Scripts/python.exe speech/transcribe_server.py

Configuración (variables de entorno, todas opcionales):

    SPEECH_HOST          dirección donde escuchar          (127.0.0.1)
    SPEECH_PORT          puerto                            (8001)
    WHISPER_MODEL        modelo de Whisper                 (small)
    WHISPER_LANGUAGE     idioma de la transcripción        (es)
    WHISPER_DEVICE       cpu o cuda                        (cpu)
    WHISPER_COMPUTE_TYPE precisión del modelo              (int8)
    SPEECH_MAX_BYTES     tamaño máximo del audio           (10 MiB)
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel

HOST = os.environ.get("SPEECH_HOST", "127.0.0.1")
PORT = int(os.environ.get("SPEECH_PORT", "8001"))

# «small» es el equilibrio razonable para dictar instrucciones cortas en
# castellano: «base» confunde nombres de clase y «medium» tarda demasiado en
# CPU para que la interfaz siga sintiéndose viva.
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "es")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

MAX_BYTES = int(os.environ.get("SPEECH_MAX_BYTES", str(10 * 1024 * 1024)))

logging.basicConfig(level=logging.INFO, format="[speech] %(message)s")
log = logging.getLogger("speech")

# El modelo se carga una sola vez, al arrancar. Cargarlo por petición
# multiplicaría por diez el tiempo de cada transcripción.
log.info("Cargando Whisper «%s» (%s, %s)…", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
log.info("Listo. Escuchando en http://%s:%s", HOST, PORT)


def transcribe(audio: bytes, suffix: str) -> dict:
    """Devuelve el texto dictado, junto con el idioma que Whisper reconoció."""
    # faster-whisper lee de una ruta, así que el audio pasa por un archivo
    # temporal que se borra en cuanto termina: no se guarda nada del usuario.
    temporary = Path(tempfile.gettempdir()) / f"case-tool-voz-{os.getpid()}{suffix}"
    temporary.write_bytes(audio)

    try:
        segments, info = model.transcribe(
            str(temporary),
            language=LANGUAGE,
            # Con beam_size 5 se acierta bastante más en nombres propios como
            # «Cliente» o «Pedido», que es justo lo que hay que dictar aquí.
            beam_size=5,
            vad_filter=True,
        )
        text = "".join(segment.text for segment in segments).strip()

        return {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        }
    finally:
        temporary.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    """Dos rutas: una para comprobar que el servicio vive y otra para el audio."""

    # Por defecto BaseHTTPRequestHandler escribe una línea por petición en
    # stderr; se redirige al log para que la salida sea una sola cosa.
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        log.info("%s", format % args)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("", "/health"):
            self._json(200, {"status": "ok", "model": MODEL_SIZE, "language": LANGUAGE})
            return

        self._json(404, {"error": "Ruta desconocida."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/transcribe":
            self._json(404, {"error": "Ruta desconocida."})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json(400, {"error": "No se recibió ningún audio."})
            return
        if length > MAX_BYTES:
            self._json(413, {"error": "El audio es demasiado largo."})
            return

        audio = self.rfile.read(length)

        # La extensión ayuda a ffmpeg a elegir el demuxer correcto; el nombre
        # real del archivo no importa porque es temporal.
        suffix = {
            "audio/webm": ".webm",
            "audio/ogg": ".ogg",
            "audio/mpeg": ".mp3",
            "audio/mp4": ".m4a",
            "audio/wav": ".wav",
            "audio/x-wav": ".wav",
        }.get((self.headers.get("Content-Type") or "").split(";")[0].strip(), ".webm")

        try:
            result = transcribe(audio, suffix)
        except Exception as error:  # noqa: BLE001
            log.exception("No se pudo transcribir el audio")
            self._json(500, {"error": f"No se pudo transcribir el audio: {error}"})
            return

        log.info("Transcrito (%.2fs): %s", result["duration"], result["text"])
        self._json(200, result)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
