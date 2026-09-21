# Servicio de transcripción (CU04 por voz)

Convierte audio en texto y nada más. Es la única pieza del proyecto escrita en
Python, porque Faster-Whisper es una librería de Python; el backend sigue
siendo NestJS, que le pide la transcripción por HTTP local y después
interpreta el texto con el mismo flujo de CU04 que una instrucción escrita.

Ni el audio ni la transcripción salen de la máquina.

## Preparar el entorno (una sola vez)

El entorno virtual ya existe en `whisper-env/`, en la raíz del repositorio:

```bash
whisper-env/Scripts/python.exe -m pip install faster-whisper
```

## Arrancar

Desde la raíz del repositorio:

```bash
whisper-env/Scripts/python.exe speech/transcribe_server.py
```

La primera vez descarga el modelo (unos 480 MB con `small`) y lo deja en la
caché de Hugging Face; los arranques siguientes tardan unos segundos. Cuando
está listo escribe:

```
[speech] Listo. Escuchando en http://127.0.0.1:8001
```

Se puede comprobar con:

```bash
curl http://127.0.0.1:8001/health
# {"status": "ok", "model": "small", "language": "es"}
```

## Configuración

Todo son variables de entorno, ninguna obligatoria:

| Variable | Por defecto | Para qué |
|---|---|---|
| `SPEECH_HOST` | `127.0.0.1` | Dirección donde escucha. |
| `SPEECH_PORT` | `8001` | Puerto. Si se cambia, hay que cambiar también `SPEECH_URL` en `backend/.env`. |
| `WHISPER_MODEL` | `small` | `tiny`, `base`, `small`, `medium`, `large-v3`. Más grande transcribe mejor y tarda más. |
| `WHISPER_LANGUAGE` | `es` | Idioma de la transcripción. |
| `WHISPER_DEVICE` | `cpu` | `cuda` si hay GPU con CUDA. |
| `WHISPER_COMPUTE_TYPE` | `int8` | `float16` va mejor en GPU. |
| `SPEECH_MAX_BYTES` | `10485760` | Tamaño máximo del audio (10 MiB). |

`small` es el equilibrio razonable para dictar instrucciones cortas en
castellano: `base` confunde nombres de clase y `medium` tarda demasiado en CPU
para que la interfaz siga sintiéndose viva.

## Interfaz

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | Dice si el modelo está cargado. |
| `POST /transcribe` | Recibe los bytes del audio en el cuerpo, con su `Content-Type`, y devuelve `{"text": …, "language": …, "duration": …}`. |

El audio va en crudo, sin multipart: no hay nada más que enviar, y así el
servicio no necesita ninguna librería para leerlo. El archivo temporal que usa
para decodificarlo se borra en cuanto termina.

## Si no está en marcha

El asistente sigue funcionando por texto y por imagen. Al pulsar el micrófono,
la API responde que el servicio de transcripción no está disponible y dice en
qué dirección lo buscó.
