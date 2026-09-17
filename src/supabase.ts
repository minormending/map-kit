import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isOffline, type MapKitConfig } from './config.js'

/**
 * Null when no project is configured, which is a supported state rather than
 * an error: both apps ship a bundled dataset and work without a database.
 *
 * The anon key is meant to be public. It identifies the project and authorises
 * nothing — every restriction is a row-level security policy or a function
 * grant, because the browser is treated as hostile throughout.
 */
export function createSupabase(config: MapKitConfig): SupabaseClient | null {
  if (isOffline(config)) return null
  return createClient(config.supabaseUrl!, config.supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // OAuth comes back with tokens in the URL
    },
  })
}

export type { SupabaseClient }
