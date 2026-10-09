/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WAYMARK_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
