import 'dotenv/config';

/** Puertos habituales del servidor de desarrollo de Vite. */
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

/**
 * Orígenes del frontend autorizados a llamar a la API.
 * Es una lista explícita, no un comodín: con `*` el navegador rechazaría las
 * peticiones que envían credenciales, y cualquier sitio podría consumir la API
 * desde el navegador de un usuario con sesión iniciada.
 *
 * Lo usan tanto el CORS de HTTP (main.ts) como el del gateway de WebSocket
 * (CU03), para que ambos canales admitan exactamente los mismos orígenes.
 */
export function corsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS?.trim() || DEFAULT_CORS_ORIGINS;

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
