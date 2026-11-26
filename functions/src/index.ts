import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth, type UserRecord } from 'firebase-admin/auth'
import { createClient, type User as SupabaseUser } from '@supabase/supabase-js'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/https'

initializeApp()

const supabaseUrl = defineSecret('SUPABASE_URL')
const supabaseServiceRoleKey = defineSecret('SUPABASE_SERVICE_ROLE_KEY')
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getSupabaseAdmin() {
  return createClient(supabaseUrl.value(), supabaseServiceRoleKey.value(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function findSupabaseUserByEmail(email: string): Promise<SupabaseUser | null> {
  const supabase = getSupabaseAdmin()
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      throw new HttpsError('internal', 'Could not look up the linked Supabase identity.')
    }
    const user = data.users.find(candidate => candidate.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 1000) return null
  }
}

async function findFirebaseUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUserByEmail(email)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'auth/user-not-found') return null
    throw new HttpsError('internal', 'Could not look up the Firebase account.')
  }
}

async function createUnverifiedToken(uid: string, claims: Record<string, unknown>) {
  const auth = getAuth()
  await auth.setCustomUserClaims(uid, { ...claims, role: 'anon' })
  return auth.createCustomToken(uid, { role: 'anon' })
}

export const provisionFirebaseAccount = onCall<{
  email: unknown
  password: unknown
}>(
  {
    enforceAppCheck: true,
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async request => {
    const email = typeof request.data.email === 'string' ? request.data.email.trim().toLowerCase() : ''
    const password = request.data.password
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.')
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'Password must be between 6 and 128 characters.')
    }

    const existingFirebaseUser = await findFirebaseUserByEmail(email)
    const linkedSupabaseUser = await findSupabaseUserByEmail(email)
    if (existingFirebaseUser) {
      if (!linkedSupabaseUser || existingFirebaseUser.uid !== linkedSupabaseUser.id) {
        throw new HttpsError('failed-precondition', 'This Firebase account is not linked to the Classwork identity.')
      }
      if (existingFirebaseUser.emailVerified) {
        throw new HttpsError('already-exists', 'An account already exists. Sign in instead.')
      }
      const customToken = await createUnverifiedToken(existingFirebaseUser.uid, existingFirebaseUser.customClaims ?? {})
      return { customToken }
    }

    let supabaseUser = linkedSupabaseUser
    let createdSupabaseUser = false
    if (!supabaseUser) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: randomBytes(32).toString('hex'),
        email_confirm: true,
        user_metadata: { auth_provider: 'firebase' },
      })
      if (error || !data.user) {
        throw new HttpsError('internal', 'Could not create the linked Supabase identity.')
      }
      supabaseUser = data.user
      createdSupabaseUser = true
    }
    if (!uuidPattern.test(supabaseUser.id)) {
      throw new HttpsError('failed-precondition', 'The linked Supabase identity does not have a supported UUID.')
    }

    const auth = getAuth()
    let firebaseUser: UserRecord
    try {
      firebaseUser = await auth.createUser({
        uid: supabaseUser.id,
        email,
        password,
        emailVerified: false,
      })
    } catch {
      const racedFirebaseUser = await findFirebaseUserByEmail(email)
      if (racedFirebaseUser?.uid === supabaseUser.id) {
        firebaseUser = racedFirebaseUser
      } else {
        if (createdSupabaseUser) {
          const { error: deleteError } = await getSupabaseAdmin().auth.admin.deleteUser(supabaseUser.id)
          if (deleteError) {
            throw new HttpsError('internal', 'Firebase account creation failed and the temporary linked identity could not be removed.')
          }
        }
        throw new HttpsError('internal', 'Could not create the Firebase account.')
      }
    }

    const customToken = await createUnverifiedToken(firebaseUser.uid, firebaseUser.customClaims ?? {})
    return { customToken }
  },
)

export const activateFirebaseAccount = onCall(
  { enforceAppCheck: true },
  async request => {
    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError('permission-denied', 'Verify your email before activating class access.')
    }
    if (!uuidPattern.test(request.auth.uid)) {
      throw new HttpsError('failed-precondition', 'The Firebase identity is not linked to a Classwork account.')
    }
    const auth = getAuth()
    const user = await auth.getUser(request.auth.uid)
    await auth.setCustomUserClaims(request.auth.uid, {
      ...user.customClaims,
      role: 'authenticated',
    })
    return { authenticated: true }
  },
)
