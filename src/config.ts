/**
 * Configuration is passed in, never read from the environment here.
 *
 * `restroom-map` reads `import.meta.env` at module scope, which is fine in a
 * Vite SPA where there is exactly one environment. Astro runs the same module
 * twice — once on the server during the build, once in the browser as an
 * island — and the two do not see the same variables. A module-level read is
 * then a value that silently differs between the two, which is the worst shape
 * a config bug can take.
 *
 * So the kit takes a config object and the app decides where it came from.
 */
export interface MapKitConfig {
  /** Supabase project URL. Empty means "no project"; the app runs read-only. */
  supabaseUrl?: string
  /** The publishable anon key. Public by design — it authorises nothing. */
  supabaseAnonKey?: string
  /** Photon instance for place search. Nominatim's public box forbids this use. */
  geocoderUrl?: string
}

export const DEFAULT_GEOCODER = 'https://photon.komoot.io/api/'

export const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** True when there is no project configured and the app must run off bundled data. */
export const isOffline = (c: MapKitConfig): boolean =>
  !c.supabaseUrl || !c.supabaseAnonKey
