import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const appId = import.meta.env.VITE_FIREBASE_APP_ID
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
const authRequestTimeoutMs = 12_000

const requiredConfiguration: Record<string, boolean> = {
  VITE_FIREBASE_API_KEY: Boolean(apiKey && /^AIza[0-9A-Za-z_-]{30,}$/.test(apiKey)),
  VITE_FIREBASE_AUTH_DOMAIN: Boolean(
    authDomain && /^(?!https?:\/\/)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(authDomain),
  ),
  VITE_FIREBASE_PROJECT_ID: projectId === 'classwork-ec166',
  VITE_FIREBASE_APP_ID: Boolean(appId && /^1:\d+:web:[0-9a-f]+$/i.test(appId)),
  VITE_FIREBASE_APPCHECK_SITE_KEY: Boolean(
    appCheckSiteKey && !/^https?:\/\//i.test(appCheckSiteKey) && !appCheckSiteKey.includes('/'),
  ),
}

export const missingFirebaseConfiguration = Object.entries(requiredConfiguration)
  .filter(([, isValid]) => !isValid)
  .map(([name]) => name)

const configured = missingFirebaseConfiguration.length === 0
const app = configured ? initializeApp({ apiKey, authDomain, projectId, appId }) : null

export function withRequestTimeout<T>(request: Promise<T>, action: string) {
  let timeoutId: number | undefined
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(`${action} timed out. Check your connection and try again.`)),
      authRequestTimeoutMs,
    )
  })

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  })
}

if (app && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

export const isFirebaseConfigured = Boolean(app)
export const firebaseAuth = app ? getAuth(app) : null
export const firebaseFunctions = app ? getFunctions(app) : null

export async function provisionFirebaseAccount(email: string, password: string) {
  if (!firebaseFunctions || !firebaseAuth) throw new Error('Firebase is not configured.')
  const provision = httpsCallable<{ email: string; password: string }, { customToken: string }>(
    firebaseFunctions,
    'provisionFirebaseAccount',
    { timeout: authRequestTimeoutMs },
  )
  const { data } = await withRequestTimeout(provision({ email, password }), 'Account setup')
  await withRequestTimeout(signInWithCustomToken(firebaseAuth, data.customToken), 'Firebase sign-in')
}

export async function activateVerifiedFirebaseAccount() {
  if (!firebaseFunctions) throw new Error('Firebase is not configured.')
  const activate = httpsCallable<Record<string, never>, { authenticated: boolean }>(
    firebaseFunctions,
    'activateFirebaseAccount',
    { timeout: authRequestTimeoutMs },
  )
  await withRequestTimeout(activate({}), 'Account activation')
}
