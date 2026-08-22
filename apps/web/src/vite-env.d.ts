/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_MOYASAR_PUBLISHABLE_KEY?: string;
  readonly VITE_TAMARA_PUBLIC_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected at build time by vite.config.ts (define). Short git SHA + ISO build
// time of the currently deployed build; rendered in the header badge.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
