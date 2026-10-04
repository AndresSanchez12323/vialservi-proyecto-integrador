/// <reference types="vite/client" />

/**
 * Variables de entorno del frontend. Se declaran para que TypeScript las
 * conozca y avise si alguien escribe mal el nombre: una variable de Vite mal
 * escrita no falla, simplemente llega undefined.
 */
interface ImportMetaEnv {
  /** Base del API. Vacia cuando el SPA y el API comparten origen. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
