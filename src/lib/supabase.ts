import { createClient } from '@supabase/supabase-js'
import { firebaseAuth } from './firebase'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
const authClient = firebaseAuth

export const supabase = isSupabaseConfigured && authClient
  ? createClient(url!, anonKey!, {
      accessToken: async () => {
        const user = authClient.currentUser
        return user?.emailVerified ? user.getIdToken() : null
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null
