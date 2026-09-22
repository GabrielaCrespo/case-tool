import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'

/**
 * Un código QR con lo que se le dé.
 *
 * Existe por una razón concreta: al publicar un backend, la forma de conectar
 * el teléfono es escanear su dirección. Teclear
 * `https://algo.com/d/sistema-de-ventas` en un móvil es justo lo que sobra en
 * una demostración.
 *
 * Se dibuja en blanco y negro puros y no con los colores de la interfaz: un
 * lector necesita contraste de verdad para leerlo.
 */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    // Sin dirección no hay nada que dibujar. No se borra lo que hubiera: de eso
    // se encarga el propio pintado, mirando `value`.
    if (value.length === 0) return

    let cancelled = false

    toDataURL(value, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setImage(url)
      })
      .catch(() => {
        // Si no se puede dibujar, queda la dirección escrita al lado: el QR es
        // una comodidad, no la única forma de conectarse.
        if (!cancelled) setImage(null)
      })

    return () => {
      cancelled = true
    }
  }, [value])

  if (value.length === 0 || image === null) {
    return <div className={className} />
  }

  return (
    <img
      src={image}
      alt={`Código QR con la dirección ${value}`}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
