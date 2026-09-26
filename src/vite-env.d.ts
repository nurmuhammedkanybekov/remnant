/// <reference types="vite/client" />

/** The package.json version, injected at build time by Vite. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Co-op relay (optional): Metered app domain, e.g. "remnant.metered.live", and its API key. */
  readonly VITE_METERED_APP?: string;
  readonly VITE_METERED_API_KEY?: string;
  /** Co-op relay (optional): any TURN server, comma-separated URLs plus credentials. */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}
