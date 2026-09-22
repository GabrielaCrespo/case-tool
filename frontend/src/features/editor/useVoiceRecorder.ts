import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * CU04 — Grabación de la instrucción dictada.
 *
 * Envuelve MediaRecorder para que el asistente sólo tenga que preocuparse de
 * dos cosas: empezar y parar. Lo que sale es un Blob de audio que se manda al
 * backend; aquí no se transcribe ni se interpreta nada —eso ocurre en el
 * servidor, con Whisper y el mismo flujo de CU04 que el texto—.
 */

export type RecorderState =
  /** Listo para grabar. */
  | 'idle'
  /** Pidiendo permiso al navegador. */
  | 'requesting'
  | 'recording'
  /** El navegador no permite grabar (sin micrófono, o sin HTTPS). */
  | 'unsupported'
  /** El usuario denegó el permiso. */
  | 'denied'

/**
 * Formatos que produce MediaRecorder, por orden de preferencia, con la
 * extensión que les corresponde. Opus en WebM es lo que usan Chrome y Edge;
 * Firefox prefiere Ogg y Safari sólo sabe MP4.
 */
const FORMATS: { mimeType: string; extension: string }[] = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
]

function chooseFormat(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined') return null

  return FORMATS.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null
}

interface Options {
  /** Recibe la grabación terminada, con un nombre acorde a su formato. */
  onFinish: (audio: Blob, fileName: string) => void
}

export function useVoiceRecorder({ onFinish }: Options) {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // onFinish se vuelve a crear en cada render del componente que usa el hook,
  // pero el grabador en marcha guarda el que hubiera cuando empezó. Se anota
  // en una referencia —desde un efecto, no durante el render— para que al
  // terminar llame siempre al último.
  const finishRef = useRef(onFinish)
  useEffect(() => {
    finishRef.current = onFinish
  }, [onFinish])

  /** Suelta el micrófono: sin esto el navegador sigue marcando la pestaña. */
  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  /** Corta lo que haya en marcha sin entregar la grabación. */
  const teardown = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      // Se quita el manejador antes de parar: si no, se entregaría un audio
      // que el usuario ya no quiere.
      recorder.onstop = null
      recorder.stop()
    }
    release()
  }, [release])

  // Cerrar el diálogo a media frase no puede dejar el micrófono abierto.
  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    setError(null)

    const format = chooseFormat()
    if (format === null || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      setError('Este navegador no permite grabar audio.')
      return
    }

    setState('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // Denegado, sin micrófono conectado, o la página no va por HTTPS. Para
      // el usuario es el mismo problema: no se puede grabar.
      setState('denied')
      setError('No se pudo usar el micrófono. Revise el permiso del navegador.')
      return
    }

    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType })
    const chunks: Blob[] = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      release()
      setState('idle')
      // El tipo se toma sin el códec: es lo que el backend compara para saber
      // qué formato llegó.
      const audio = new Blob(chunks, { type: format.mimeType.split(';')[0] })
      if (audio.size > 0) finishRef.current(audio, `instruccion.${format.extension}`)
    }

    streamRef.current = stream
    recorderRef.current = recorder
    recorder.start()
    setState('recording')
  }, [release])

  const stop = useCallback(() => {
    // `stop()` dispara onstop, que es donde se arma el Blob y se suelta el
    // micrófono; hacerlo aquí además perdería el último fragmento.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  /** Descarta la grabación en curso y vuelve al estado inicial. */
  const cancel = useCallback(() => {
    teardown()
    setState('idle')
  }, [teardown])

  return { state, error, start, stop, cancel }
}
