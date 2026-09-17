import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { MapKitConfig } from './config.js'

export interface Account {
  id: string
  name: string
  avatar: string | null
}

function toAccount(session: Session | null): Account | null {
  if (!session?.user) return null
  const meta = session.user.user_metadata ?? {}
  return {
    id: session.user.id,
    // Matches the display_name the signup trigger derives, so the name on
    // screen is the name attached to your submissions.
    name: meta.full_name || meta.name || session.user.email?.split('@')[0] || 'You',
    avatar: meta.avatar_url ?? meta.picture ?? null,
  }
}

export interface Auth {
  current(): Promise<Account | null>
  onChange(fn: (account: Account | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

export function createAuth(
  supabase: SupabaseClient | null,
  config: MapKitConfig,
): Auth {
  let providerCheck: Promise<boolean> | null = null

  /**
   * `signInWithOAuth` navigates the browser before any error can be caught, so
   * a provider that is not switched on lands the user on a bare JSON error
   * page with no way back. `/auth/v1/settings` is public and says which
   * providers are configured, so ask before leaving the page.
   */
  const googleEnabled = (): Promise<boolean> => {
    providerCheck ??= fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.supabaseAnonKey! },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => Boolean(body?.external?.google))
      // A failed check should not block sign-in; let the redirect decide.
      .catch(() => true)
    return providerCheck
  }

  return {
    async current() {
      if (!supabase) return null
      const { data } = await supabase.auth.getSession()
      return toAccount(data.session)
    },

    onChange(fn) {
      if (!supabase) return () => {}
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        fn(toAccount(session))
      })
      return () => data.subscription.unsubscribe()
    },

    async signInWithGoogle() {
      if (!supabase) throw new Error('Signing in needs a database connection.')
      if (!(await googleEnabled())) {
        throw new Error("Google sign-in isn't switched on for this project yet.")
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // Come back to the page they were on, base path and all.
        options: { redirectTo: window.location.origin + window.location.pathname },
      })
      if (error) throw new Error(error.message)
    },

    async signOut() {
      await supabase?.auth.signOut()
    },
  }
}
