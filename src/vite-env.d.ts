/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Set to "1" / "true" to simulate offline boot in dev. */
  readonly VITE_FORCE_OFFLINE?: string;
}

declare module "*.mp4" {
  const src: string;
  export default src;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
