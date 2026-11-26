import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive, Bell, BookOpen, CalendarDays, Camera, Check, ChevronLeft, ChevronRight,
  Clock3, Download, FileText, FolderOpen, Grid2X2, Home, ImagePlus,
  Eye, EyeOff, LogOut, Menu, RotateCw, Search, Settings, ShieldCheck, Upload,
  UserRound, Users, X, AlertTriangle
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import imageCompression from 'browser-image-compression'
import { FirebaseError } from 'firebase/app'
import { onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { activateVerifiedFirebaseAccount, firebaseAuth, isFirebaseConfigured, missingFirebaseConfiguration, provisionFirebaseAccount } from './lib/firebase'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { createPagesPdfBlob, downloadPagesPdf, fetchClassDocuments, fetchCuratedPages, fetchPdfArchives, fetchWorkSubmissions } from './lib/work'
import type { ClassDocument, CuratedPage, PdfArchive, WorkSubmission } from './lib/work'
import './App.css'
import './upload.css'

const subjects = [
  { name: 'English', short: 'EN', color: '#3867d6' },
  { name: 'EVS / TWAU', short: 'EV', color: '#4b9b82' },
  { name: 'Hindi', short: 'HI', color: '#c68137' },
  { name: 'Mathematics', short: 'MA', color: '#6d66bd' },
  { name: 'Computer', short: 'CO', color: '#368da0' },
  { name: 'Music', short: 'MU', color: '#ad6279' },
]

type PageName = 'Dashboard' | 'Daily Work' | 'Upload Work' | 'Digital Notebook' |
  'All Submissions' | 'My Contributions' | 'Admin Panel' | 'Member Approvals' |
  'Manage Subjects' | 'Reports' | 'Audit History' | 'Class Pages' | 'Settings' | 'Admin Settings'

type TaskRow = {
  id: string
  title: string
  academic_date: string
  status: string
  subjects?: { name: string }
  chapter?: string | null
  exercise?: string | null
}

type UploadPage = { id: string; file: File; url: string; rotation: number }
type UploadBatch = {
  taskId: string
  submissionId: string | null
  pathByFileId: Record<string, string>
  completedFileIds: string[]
}
type ClassDocumentBatch = {
  documentId: string
  completedFileIds: string[]
}

const navItems: { label: PageName; icon: typeof Home }[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Daily Work', icon: CalendarDays },
  { label: 'Upload Work', icon: Upload },
  { label: 'Digital Notebook', icon: BookOpen },
  { label: 'Class Pages', icon: Archive },
  { label: 'All Submissions', icon: FolderOpen },
  { label: 'My Contributions', icon: FileText },
  { label: 'Admin Panel', icon: ShieldCheck },
  { label: 'Member Approvals', icon: Users },
  { label: 'Admin Settings', icon: Settings },
  { label: 'Settings', icon: Settings },
]

const pagePaths: Record<PageName, string> = {
  Dashboard: '/dashboard',
  'Daily Work': '/daily-work',
  'Upload Work': '/upload',
  'Digital Notebook': '/notebook',
  'All Submissions': '/submissions',
  'My Contributions': '/contributions',
  'Admin Panel': '/admin',
  'Member Approvals': '/admin/member-approvals',
  'Manage Subjects': '/admin/subjects',
  Reports: '/admin/reports',
  'Audit History': '/admin/audit',
  'Class Pages': '/class-pages',
  Settings: '/settings',
  'Admin Settings': '/admin/settings',
}

function pageFromPath(pathname: string): PageName {
  return (Object.entries(pagePaths).find(([, path]) => path === pathname)?.[0] as PageName) || 'Dashboard'
}

function todayKolkata() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replaceAll('/', '-')
}

function formatDate(date: string) {
  if (!date) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
  }).format(new Date(`${date}T12:00:00+05:30`))
}

function App() {
  const [page, setPage] = useState<PageName>(() => pageFromPath(window.location.pathname))
  const [mobileMenu, setMobileMenu] = useState(false)
  const [selectedDate, setSelectedDate] = useState(todayKolkata())
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'join'>('signin')
  const [authLoading, setAuthLoading] = useState(false)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [student, setStudent] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const loadRequestId = useRef(0)

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    window.setTimeout(() => setToast(null), 3500)
  }, [])
  const userId = emailVerified ? user?.uid : undefined

  const loadData = useCallback(async () => {
    const client = supabase
    if (!client || !userId) return
    const requestId = ++loadRequestId.current
    setLoading(true)
    try {
      const { data: profile, error: profileError } = await client
        .from('students').select('*').eq('id', userId).maybeSingle()
      if (profileError) throw profileError
      if (requestId !== loadRequestId.current) return
      setStudent(profile)
      if (profile) {
        const { data: preference } = await client
          .from('user_preferences').select('theme,accessibility_reduced_motion').eq('user_id', userId).maybeSingle()
        if (preference) {
          // Keep the academic workspace light regardless of OS theme or a
          // stale dark preference saved by an earlier version of the app.
          document.documentElement.dataset.theme = 'light'
          document.documentElement.style.scrollBehavior = preference.accessibility_reduced_motion ? 'auto' : 'smooth'
        }
      }
      if (profile?.status === 'approved') {
        const { data, error } = await client.from('tasks')
          .select('id,title,academic_date,status,chapter,exercise,subjects(name)')
          .eq('academic_date', selectedDate)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (requestId !== loadRequestId.current) return
        setTasks((data as unknown as TaskRow[]) || [])
      } else {
        setTasks([])
      }
    } catch (error) {
      if (requestId === loadRequestId.current) {
        setTasks([])
        showToast(error instanceof Error ? error.message : 'Could not load your class profile.', 'error')
      }
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [userId, selectedDate, showToast])

  useEffect(() => {
    const auth = firebaseAuth
    const client = supabase
    if (!auth || !client) return
    let initialStateReceived = false
    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      const isInitialState = !initialStateReceived
      initialStateReceived = true
      setUser(nextUser)
      setStudent(null)
      setTasks([])
      if (!nextUser || !nextUser.emailVerified) {
        setEmailVerified(false)
        setAuthReady(true)
        return
      }

      setAuthReady(false)
      void (async () => {
        try {
          await nextUser.getIdToken(true)
          await activateVerifiedFirebaseAccount()
          await nextUser.getIdToken(true)
          setEmailVerified(true)
          setAuthReady(true)
          if (!isInitialState) {
            // Record the authentication action without browsing or device details.
            void client.rpc('log_activity', {
              p_action: 'signed_in',
              p_entity_type: 'authentication',
            })
          }
        } catch (error) {
          setEmailVerified(false)
          setAuthReady(true)
          showToast(error instanceof Error ? error.message : 'Could not activate verified Firebase access.', 'error')
        }
      })()
    })
    return unsubscribe
  }, [showToast])

  useEffect(() => {
    const handlePopState = () => {
      setPage(pageFromPath(window.location.pathname))
      setMobileMenu(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function signOut() {
    try {
      if (!firebaseAuth) throw new Error('Firebase is not configured.')
      await firebaseSignOut(firebaseAuth)
      setUser(null)
      setEmailVerified(false)
      setStudent(null)
      setPendingCount(0)
      setNotificationsOpen(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not sign out.', 'error')
    }
  }

  const navigate = (next: PageName) => {
    const path = pagePaths[next]
    if (window.location.pathname !== path) window.history.pushState({ page: next }, '', path)
    setPage(next)
    setMobileMenu(false)
    setNotificationsOpen(false)
  }

  const isOwner = student?.is_owner
  const classId = student?.class_id
  const studentId = student?.id
  const studentStatus = student?.status
  const refreshPendingCount = useCallback(async () => {
    if (!supabase || !isOwner) return
    try {
      let query = supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      if (classId) query = query.eq('class_id', classId)
      const { count, error } = await query
      if (error) throw error
      setPendingCount(count || 0)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not refresh member requests.', 'error')
    }
  }, [classId, isOwner, showToast])

  useEffect(() => {
    const client = supabase
    if (!client || !userId || !studentId) return
    const profileChannel = client.channel(`student-profile-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'students', filter: `id=eq.${userId}`
      }, () => { void loadData() })
      .subscribe()

    let ownerChannel: ReturnType<typeof client.channel> | undefined
    if (isOwner) {
      ownerChannel = client.channel(`owner-member-requests-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, payload => {
          if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
            showToast(`New member request: ${payload.new.display_name}`)
          }
          void refreshPendingCount()
        })
        .subscribe()
    }

    const refreshTimer = window.setInterval(() => {
      if (isOwner) void refreshPendingCount()
      else if (studentStatus === 'pending') void loadData()
    }, 15000)

    return () => {
      window.clearInterval(refreshTimer)
      void client.removeChannel(profileChannel)
      if (ownerChannel) void client.removeChannel(ownerChannel)
    }
  }, [userId, studentId, isOwner, studentStatus, loadData, refreshPendingCount, showToast])

  useEffect(() => {
    if (isOwner) void refreshPendingCount()
  }, [isOwner, refreshPendingCount, studentId])

  if (!isSupabaseConfigured || !isFirebaseConfigured) {
    return <SetupScreen
      missingSupabase={!isSupabaseConfigured}
      missingFirebase={missingFirebaseConfiguration}
    />
  }
  if (!authReady) {
    return <Loading />
  }
  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} loading={authLoading} setLoading={setAuthLoading} showToast={showToast} />
  }
  if (!emailVerified) {
    return <VerifyEmailScreen user={user} showToast={showToast} onVerified={() => { setEmailVerified(true); setAuthReady(true) }} onLogout={signOut} />
  }
  if (user && !student) {
    return <JoinScreen onJoined={loadData} showToast={showToast} onLogout={signOut} />
  }
  if (student && student.status === 'pending') {
    return <PendingScreen student={student} onLogout={signOut} />
  }
  if (student && student.status === 'suspended') {
    return <SuspendedScreen onLogout={signOut} />
  }

  return (
    <div className="app-shell">
      {mobileMenu && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><BookOpen size={22} /></div>
          <div><strong>Classwork</strong><span>Digital Notebook</span></div>
          <button className="icon-button sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(item => {
            const ownerOnly = item.label === 'Admin Panel'
              || item.label === 'Member Approvals'
              || item.label === 'Manage Subjects'
              || item.label === 'Reports'
              || item.label === 'Audit History'
              || item.label === 'Admin Settings'
            if (ownerOnly && !student?.is_owner) return null
            const Icon = item.icon
            return (
              <button key={item.label} className={page === item.label ? 'active' : ''} onClick={() => navigate(item.label)}>
                <Icon size={19} /><span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="profile-avatar">{(student?.display_name || user.email || 'S').slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy"><strong>{student?.display_name || 'Student'}</strong><span>{student?.roll_number ? `Roll No. ${student.roll_number}` : 'Pending setup'}</span></div>
          <button className="icon-button" onClick={signOut} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="date-control">
            <button aria-label="Previous date" onClick={() => changeDate(selectedDate, -1, setSelectedDate)}><ChevronLeft size={17} /></button>
            <label><CalendarDays size={16} /><input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} /></label>
            <button aria-label="Next date" onClick={() => changeDate(selectedDate, 1, setSelectedDate)}><ChevronRight size={17} /></button>
          </div>
          <div className="notification-wrap">
            <button
              className="icon-button notification"
              aria-label={`Notifications${pendingCount ? `, ${pendingCount} pending member requests` : ''}`}
              aria-expanded={notificationsOpen}
              aria-controls="notification-panel"
              onClick={() => setNotificationsOpen(open => !open)}
            >
              <Bell size={19} />{pendingCount > 0 && <span className="notification-count">{pendingCount > 99 ? '99+' : pendingCount}</span>}
            </button>
            {notificationsOpen && (
              <section className="notification-panel" id="notification-panel" aria-label="Notifications">
                <strong>Member requests</strong>
                <p>{pendingCount ? `${pendingCount} new member request${pendingCount === 1 ? '' : 's'} need your review.` : 'You’re all caught up.'}</p>
                {student?.is_owner && <button className="text-button" onClick={() => navigate('Member Approvals')}>Review requests</button>}
              </section>
            )}
          </div>
        </header>

        {loading ? <Loading /> :
          page === 'Dashboard' ? <Dashboard date={selectedDate} tasks={tasks} navigate={navigate} student={student} showToast={showToast} /> :
          page === 'Upload Work' ? <UploadWork student={student} date={selectedDate} showToast={showToast} onComplete={loadData} /> :
          page === 'Class Pages' ? <ClassPages student={student} showToast={showToast} /> :
          page === 'Digital Notebook' ? <Notebook showToast={showToast} student={student} /> :
          page === 'Daily Work' ? <DailyWork date={selectedDate} tasks={tasks} navigate={navigate} /> :
          page === 'All Submissions' ? <SubmissionsView student={student} showToast={showToast} /> :
          page === 'My Contributions' ? <Contributions student={student} showToast={showToast} /> :
          page === 'Admin Panel' && student?.is_owner ? <AdminPanel navigate={navigate} pendingCount={pendingCount} /> :
          page === 'Member Approvals' && student?.is_owner ? <MemberApprovals showToast={showToast} /> :
          page === 'Manage Subjects' && student?.is_owner ? <ManageSubjects student={student} showToast={showToast} /> :
          page === 'Reports' && student?.is_owner ? <ReportsView student={student} showToast={showToast} /> :
          page === 'Audit History' && student?.is_owner ? <AuditHistory showToast={showToast} /> :
          page === 'Settings' ? <SettingsView student={student} showToast={showToast} /> :
          page === 'Admin Settings' && student?.is_owner ? <AdminSettingsView student={student} showToast={showToast} /> :
          <Dashboard date={selectedDate} tasks={tasks} navigate={navigate} student={student} showToast={showToast} />}
      </main>
      {toast && <div className={`toast ${toast.type}`}>{toast.type === 'success' ? <Check size={17} /> : <AlertTriangle size={17} />}{toast.text}</div>}
    </div>
  )
}

function changeDate(value: string, amount: number, setter: (value: string) => void) {
  const date = new Date(`${value}T12:00:00+05:30`)
  date.setDate(date.getDate() + amount)
  setter(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('/', '-'))
}

function SetupScreen({ missingSupabase, missingFirebase }: {
  missingSupabase: boolean
  missingFirebase: string[]
}) {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="brand-mark large"><BookOpen size={28} /></div>
        <h1>Classwork needs configuration</h1>
        <p>Sign-in, uploads and PDFs are unavailable until the missing configuration is added to this deployment and it is rebuilt.</p>
        <ol>
          {missingSupabase && <li>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>}
          {missingFirebase.length > 0 && (
            <li>
              Add these Firebase web app settings from Firebase Console → Project settings → General → Your apps:
              <ul>{missingFirebase.filter(name => name !== 'VITE_FIREBASE_APPCHECK_SITE_KEY').map(name => <li key={name}><code>{name}</code></li>)}</ul>
              {missingFirebase.includes('VITE_FIREBASE_PROJECT_ID') && <span>The Project ID must exactly match <code>classwork-ec166</code>.</span>}
              {missingFirebase.includes('VITE_FIREBASE_APPCHECK_SITE_KEY') && (
                <span>Register reCAPTCHA v3 for this deployment in Firebase App Check and add <code>VITE_FIREBASE_APPCHECK_SITE_KEY</code> (the site key, not the website URL).</span>
              )}
            </li>
          )}
          <li>For Vercel, add these as environment variables and redeploy. Locally, use <code>.env.local</code> and restart Vite.</li>
        </ol>
        <div className="setup-callout"><ShieldCheck size={18} /><span>Only public Firebase web config and the Supabase publishable key belong in frontend variables. Never expose the Supabase service-role key.</span></div>
      </div>
    </div>
  )
}

type AuthScreenProps = {
  mode: 'signin' | 'join'
  setMode: (mode: 'signin' | 'join') => void
  loading: boolean
  setLoading: (loading: boolean) => void
  showToast: (text: string, type?: 'success' | 'error') => void
}

function AuthScreen({ mode, setMode, loading, setLoading, showToast }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function submitAuth(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const auth = firebaseAuth
      if (!auth) throw new Error('Firebase is not configured.')
      if (mode === 'signin') {
        const { user: signedInUser } = await signInWithEmailAndPassword(auth, email.trim(), password)
        if (!signedInUser.emailVerified) {
          showToast('Verify your email address before accessing the class.', 'error')
        }
      } else {
        await provisionFirebaseAccount(email.trim(), password)
        const newUser = firebaseAuth?.currentUser
        if (!newUser) throw new Error('Firebase account was created but could not be signed in.')
        await sendEmailVerification(newUser)
        showToast('Account created. Verify your email to continue to your class request.')
        setMode('signin')
      }
    } catch (error) {
      showToast(getAuthErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword() {
    const auth = firebaseAuth
    if (!auth) {
      showToast('Firebase is not configured.', 'error')
      return
    }
    if (!email.trim()) {
      showToast('Enter your email address first.', 'error')
      return
    }
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email.trim())
      showToast('Password reset email sent. Check your inbox.')
    } catch (error) {
      showToast(getAuthErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-art">
        <div className="auth-brand"><div className="brand-mark"><BookOpen size={22} /></div><strong>Classwork</strong></div>
        <div className="auth-art-copy"><h1>Your class notes,<br />carefully organised.</h1><p>A digital notebook for organising daily school work and class submissions.</p></div>
      </section>
      <section className="auth-form-section">
        <form className="auth-form" onSubmit={submitAuth}>
          <div className="auth-tabs">
            <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Sign up</button>
          </div>
          <h2>{mode === 'signin' ? 'Welcome back' : 'Join the private class'}</h2>
          <p>{mode === 'signin' ? 'Sign in to continue to your notebook.' : 'Create a Firebase account, verify your email, then request owner approval to join.'}</p>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" /></label>
          <label>Password
            <span className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(value => !value)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {mode === 'signin' && <button type="button" className="auth-link" disabled={loading} onClick={() => void resetPassword()}>Forgot password?</button>}
          <button className="primary-button" disabled={loading}>{loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          <small><ShieldCheck size={14} /> Private workspace · Class 5 only</small>
          <p className="settings-note">Classwork is an independent student-maintained project. It is not an official Kendriya Vidyalaya website and is not endorsed by the school.</p>
        </form>
      </section>
    </div>
  )
}

function getAuthErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code.startsWith('appCheck/')) {
      return 'Firebase App Check rejected this request. Confirm the registered reCAPTCHA v3 key and allowed domain in Firebase.'
    }
    if (error.code === 'functions/not-found') {
      return 'Account setup is unavailable because the Firebase provisioning service has not been deployed.'
    }
    if (error.code === 'functions/unauthenticated' || error.code === 'functions/permission-denied') {
      return 'Firebase App Check rejected this request. The site key must be registered for this app and domain.'
    }
    if (error.code === 'functions/failed-precondition') {
      return error.message
    }
    return error.message
  }
  return error instanceof Error ? error.message : 'Could not complete authentication.'
}

function VerifyEmailScreen({ user, showToast, onVerified, onLogout }: {
  user: User
  showToast: (text: string, type?: 'success' | 'error') => void
  onVerified: () => void
  onLogout: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function resendVerification() {
    setLoading(true)
    try {
      await sendEmailVerification(user)
      showToast('Verification email sent.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send a verification email.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshVerification() {
    setLoading(true)
    try {
      await reload(user)
      if (!user.emailVerified) {
        showToast('Your email is not verified yet.', 'error')
        return
      }
      await user.getIdToken(true)
      await activateVerifiedFirebaseAccount()
      await user.getIdToken(true)
      onVerified()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check email verification.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pending-screen">
      <div className="pending-card">
        <div className="brand-mark large"><ShieldCheck size={28} /></div>
        <h1>Verify your email</h1>
        <p>{user.emailVerified
          ? 'Your email is verified. Refresh to finish enabling your class access.'
          : `Open the verification link sent to ${user.email}. Class access stays locked until Firebase confirms your email.`}</p>
        <button className="primary-button" disabled={loading} onClick={() => void refreshVerification()}>{loading ? 'Checking…' : 'I have verified my email'}</button>
        {!user.emailVerified && <button className="secondary-button" disabled={loading} onClick={() => void resendVerification()}>Resend verification email</button>}
        <button className="secondary-button" style={{ width: '100%', marginTop: 10 }} onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}

function PendingScreen({ student, onLogout }: any) {
  return (
    <div className="pending-screen">
      <div className="pending-card">
        <div className="brand-mark large"><ShieldCheck size={28} /></div>
        <h1>Approval pending</h1>
        <p>Hi {student.display_name}. Your joining request is waiting for the platform owner to approve your account. This page will update automatically when it is approved.</p>
        <button className="secondary-button" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}

function SuspendedScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="pending-screen">
      <div className="pending-card">
        <div className="brand-mark large"><ShieldCheck size={28} /></div>
        <h1>Access paused</h1>
        <p>Your account is currently unable to access the class workspace. Contact the class owner if you think this is a mistake.</p>
        <button className="secondary-button" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}

function JoinScreen({ onJoined, showToast, onLogout }: any) {
  const [name, setName] = useState('')
  const [roll, setRoll] = useState('')
  const [invite, setInvite] = useState('')
  const [loading, setLoading] = useState(false)

  async function join(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase!.rpc('join_class', {
        invite_code: invite,
        student_name: name,
        student_roll: roll,
      })
      if (error) throw error
      showToast('Class registration saved.')
      await onJoined()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not submit your class request.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pending-screen">
      <form className="pending-card auth-form" onSubmit={join}>
        <div className="brand-mark large"><ShieldCheck size={28} /></div>
        <h1>Join Class 5</h1>
        <p>Enter the private invite code and your student identity.</p>
        <label>Display name<input value={name} onChange={e => setName(e.target.value)} required placeholder="Your name" /></label>
        <label>Roll number<input value={roll} onChange={e => setRoll(e.target.value)} required placeholder="e.g. 18" /></label>
        <label>Invite code<input value={invite} onChange={e => setInvite(e.target.value)} required placeholder="Private class invite code" /></label>
        <button className="primary-button" disabled={loading}>{loading ? 'Joining…' : 'Join class'}</button>
        <button type="button" className="secondary-button" style={{ width: '100%', marginTop: 10 }} onClick={onLogout}>Sign out</button>
      </form>
    </div>
  )
}

function Loading() {
  return (
    <div className="skeleton-page" role="status" aria-label="Loading workspace">
      <div className="skeleton-line wide" />
      <div className="skeleton-grid">
        <div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" />
      </div>
      <div className="skeleton-line" /><div className="skeleton-line short" />
      <span className="sr-only">Loading workspace…</span>
    </div>
  )
}

function Dashboard({ date, tasks, navigate, student, showToast }: {
  date: string
  tasks: TaskRow[]
  navigate: (page: PageName) => void
  student: any
  showToast: (text: string, type?: 'success' | 'error') => void
}) {
  const [archives, setArchives] = useState<PdfArchive[]>([])
  const loadArchives = useCallback(async () => {
    if (!student?.class_id) return
    try {
      setArchives(await fetchPdfArchives(student.class_id, 3))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load published PDFs.', 'error')
    }
  }, [showToast, student?.class_id])

  useEffect(() => { void loadArchives() }, [loadArchives])

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">CLASS 5 · DIGITAL NOTEBOOK</p><h1>Good to see you</h1></div>
        <button className="primary-button compact" onClick={() => navigate('Upload Work')}><Upload size={17} /> Quick upload</button>
      </div>
      <div className="dashboard-grid">
        <section className="summary-card">
          <div className="summary-head"><div><span>Selected date</span><strong>{formatDate(date)}</strong></div><CalendarDays size={22} /></div>
          <div className="summary-stats">
            <div><strong>{tasks.length}</strong><span>Uploaded tasks</span></div>
            <div><strong>{tasks.filter(t => t.status !== 'finalised').length}</strong><span>Pending review</span></div>
          </div>
        </section>
        <section className="published-card">
          <div className="section-title"><div><span>Recently published PDFs</span><strong>PDF archive</strong></div><button className="text-button" onClick={() => navigate('Digital Notebook')}>View archive</button></div>
          {archives.length ? (
            <div className="dashboard-archives">
              {archives.map(archive => (
                <a key={archive.id} href={archive.signed_url} target="_blank" rel="noreferrer">
                  <FileText size={17} /><span><strong>{archive.subject_name || 'Class'} · v{archive.version}</strong><small>{new Date(archive.published_at).toLocaleDateString()}</small></span><Download size={15} />
                </a>
              ))}
            </div>
          ) : <div className="empty-inline"><Archive size={24} /><div><strong>No published PDFs</strong><span>Published notebooks will appear here.</span></div></div>}
        </section>
      </div>
      <div className="section-title subjects-title"><div><span>Subjects</span><strong>Daily work</strong></div><button className="text-button" onClick={() => navigate('Daily Work')}>View all</button></div>
      <div className="subject-grid">
        {subjects.map((subject) => {
          const count = tasks.filter(t => t.subjects?.name === subject.name).length
          return (
            <button className="subject-card" key={subject.name} onClick={() => navigate('Daily Work')}>
              <div className="subject-icon" style={{ background: `${subject.color}16`, color: subject.color }}>{subject.short}</div>
              <div><strong>{subject.name}</strong><span>{count} {count === 1 ? 'task' : 'tasks'} on this date</span></div>
              <ChevronRight size={18} />
            </button>
          )
        })}
      </div>
      <div className="section-title recent-title"><div><span>Latest submissions</span><strong>For {formatDate(date)}</strong></div></div>
      {tasks.length ? (
        <div className="task-list">
          {tasks.map(task => (
            <button className="task-row" key={task.id} onClick={() => navigate('All Submissions')}>
              <div className="task-icon"><FileText size={18} /></div>
              <div className="task-main"><strong>{task.title}</strong><span>{task.subjects?.name || 'Subject'} · {task.chapter || 'No chapter'}</span></div>
              <span className={`status-pill ${task.status}`}>{task.status.replaceAll('_', ' ')}</span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state"><FolderOpen size={34} /><h3>No work uploaded for this date</h3><p>Upload the first task or choose another date.</p><button className="secondary-button" onClick={() => navigate('Upload Work')}>Upload work</button></div>
      )}
    </div>
  )
}

function UploadWork({ student, date, showToast, onComplete }: any) {
  const [subjectId, setSubjectId] = useState('')
  const [availableSubjects, setAvailableSubjects] = useState<Array<{ id: string; name: string }>>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectError, setSubjectError] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [chapter, setChapter] = useState('')
  const [exercise, setExercise] = useState('')
  const [pageDetails, setPageDetails] = useState('')
  const [instructions, setInstructions] = useState('')
  const [files, setFiles] = useState<UploadPage[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [workDate, setWorkDate] = useState(date)
  const [batch, setBatch] = useState<UploadBatch | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [fileError, setFileError] = useState('')
  const pickerRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const objectUrls = useRef(new Set<string>())

  useEffect(() => {
    if (!batch) setWorkDate(date)
  }, [batch, date])

  useEffect(() => () => {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  const loadSubjects = useCallback(async () => {
    setSubjectsLoading(true)
    setSubjectError('')
    if (!supabase || !student?.class_id) {
      setAvailableSubjects([])
      setSubjectId('')
      setSubjectError('Your class is not connected to an active Supabase profile.')
      setSubjectsLoading(false)
      return
    }
    try {
      const { data, error } = await supabase.from('subjects')
        .select('id,name')
        .eq('class_id', student.class_id)
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      const options = data || []
      setAvailableSubjects(options)
      setSubjectId(current => options.some(item => item.id === current) ? current : options[0]?.id || '')
    } catch (error) {
      setAvailableSubjects([])
      setSubjectId('')
      setSubjectError(error instanceof Error ? error.message : 'Could not load active subjects.')
    } finally {
      setSubjectsLoading(false)
    }
  }, [student?.class_id])

  useEffect(() => { void loadSubjects() }, [loadSubjects])
  const selectedSubject = availableSubjects.find(item => item.id === subjectId)

  function onFiles(selected: FileList | null, input?: HTMLInputElement) {
    if (!selected) return
    const accepted: File[] = []
    let rejected = 0
    for (const file of Array.from(selected)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
        rejected++
      } else {
        accepted.push(file)
      }
    }
    setFileError(rejected ? `${rejected} file(s) skipped. Choose JPEG, PNG or WebP images up to 15 MB each.` : '')
    if (accepted.length) {
      const newPages = accepted.map(file => {
        const url = URL.createObjectURL(file)
        objectUrls.current.add(url)
        return { id: crypto.randomUUID(), file, url, rotation: 0 }
      })
      setFiles(current => [...current, ...newPages])
    }
    if (input) input.value = ''
  }

  async function submit() {
    if (!taskTitle.trim() || !confirmed || !files.length) return
    setSubmitting(true)
    try {
      if (!supabase) throw new Error('Supabase is not configured.')
      let activeBatch = batch
      if (!activeBatch) {
        if (!selectedSubject || !subjectId) {
          throw new Error('Choose an active subject before uploading.')
        }
        const { data: subjectRow, error: subjectError } = await supabase
          .from('subjects')
          .select('id')
          .eq('id', subjectId)
          .eq('class_id', student.class_id)
          .eq('is_active', true)
          .maybeSingle()
        if (subjectError) throw subjectError
        if (!subjectRow) {
          await loadSubjects()
          throw new Error('That subject is no longer active. The subject list was refreshed; choose an available subject and try again.')
        }
        const { data: task, error: taskError } = await supabase.from('tasks').insert({
          class_id: student.class_id, subject_id: subjectRow.id, academic_date: workDate, title: taskTitle.trim(),
          chapter: chapter || null, exercise: exercise || null, page_details: pageDetails || null,
          instructions: instructions || null, created_by: student.id
        }).select('id').single()
        if (taskError) throw taskError
        activeBatch = { taskId: task.id, submissionId: null, pathByFileId: {}, completedFileIds: [] }
        setBatch(activeBatch)
      }
      if (!activeBatch.submissionId) {
        const { data: submission, error: submissionError } = await supabase.from('submissions').insert({
          task_id: activeBatch.taskId, contributor_id: student.id
        }).select('id').single()
        if (submissionError) throw submissionError
        activeBatch = { ...activeBatch, submissionId: submission.id }
        setBatch(activeBatch)
      }

      setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: '' })
      for (let index = 0; index < files.length; index++) {
        const page = files[index]
        if (activeBatch.completedFileIds.includes(page.id)) continue
        setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: page.file.name })
        let compressed = page.file
        if (compressed.size > 1.5 * 1024 * 1024) {
          compressed = await imageCompression(compressed, {
            maxSizeMB: 1.5, maxWidthOrHeight: 2600, useWebWorker: true
          })
        }
        const extension = compressed.type === 'image/png' ? 'png' : compressed.type === 'image/webp' ? 'webp' : 'jpg'
        const path: string = activeBatch.pathByFileId[page.id] ||
          `${student.class_id}/${activeBatch.taskId}/${activeBatch.submissionId}/${index + 1}-${page.id}.${extension}`
        if (!activeBatch.pathByFileId[page.id]) {
          activeBatch = {
            ...activeBatch,
            pathByFileId: { ...activeBatch.pathByFileId, [page.id]: path }
          }
          setBatch(activeBatch)
        }

        const { data: existingPage, error: lookupError } = await supabase
          .from('submission_pages')
          .select('id')
          .eq('submission_id', activeBatch.submissionId!)
          .eq('page_number', index + 1)
          .maybeSingle()
        if (lookupError) throw lookupError
        if (!existingPage) {
          const { error: uploadError } = await supabase.storage.from('classwork-pages').upload(path, compressed, {
            contentType: compressed.type, upsert: false
          })
          const isRetryOfStoredFile = uploadError &&
            (uploadError as { statusCode?: string }).statusCode === '409'
          if (uploadError && !isRetryOfStoredFile) throw uploadError

          const { error: pageError } = await supabase.from('submission_pages').insert({
            submission_id: activeBatch.submissionId!, page_number: index + 1, storage_path: path,
            mime_type: compressed.type, file_size: compressed.size, rotation: page.rotation
          })
          if (pageError) throw pageError
        }
        activeBatch = {
          ...activeBatch,
          completedFileIds: [...activeBatch.completedFileIds, page.id]
        }
        setBatch(activeBatch)
        setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: '' })
      }
      showToast('Submission uploaded successfully.')
      files.forEach(page => URL.revokeObjectURL(page.url))
      files.forEach(page => objectUrls.current.delete(page.url))
      setFiles([])
      setTaskTitle('')
      setChapter('')
      setExercise('')
      setPageDetails('')
      setInstructions('')
      setConfirmed(false)
      setBatch(null)
      setProgress(null)
      setFileError('')
      onComplete?.()
    } catch (error: any) {
      showToast(error.message || 'Upload paused. Your pages are preserved; retry to continue.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function moveFile(index: number, amount: number) {
    if (batch) return
    setFiles(current => {
      const next = [...current]
      const target = index + amount
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function rotateFile(id: string) {
    if (batch) return
    setFiles(current => current.map(page =>
      page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page
    ))
  }

  function removeFile(id: string) {
    if (batch) return
    const page = files.find(item => item.id === id)
    if (page) {
      URL.revokeObjectURL(page.url)
      objectUrls.current.delete(page.url)
    }
    setFiles(current => current.filter(item => item.id !== id))
  }

  function clearFiles() {
    if (batch) return
    files.forEach(page => {
      URL.revokeObjectURL(page.url)
      objectUrls.current.delete(page.url)
    })
    setFiles([])
    setFileError('')
  }

  return (
    <div className="page upload-page">
      <div className="page-heading">
        <div><p className="eyebrow">MULTI-PAGE SUBMISSION</p><h1>Upload work</h1></div>
        <button type="button" className="secondary-button" onClick={() => {
          setTaskTitle(`${selectedSubject?.name || 'Class'} notebook pages`)
          setPageDetails('Index followed by completed pages')
        }} disabled={Boolean(batch) || !selectedSubject}>
          <BookOpen size={16} /> Whole copy
        </button>
      </div>
      <div className="upload-layout">
        <section className="form-card">
          <h2>1. Label this upload</h2>
          <label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={Boolean(batch) || subjectsLoading || !availableSubjects.length}>
            {availableSubjects.length ? availableSubjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">No active subjects</option>}
          </select></label>
          {subjectsLoading && <p className="subject-load-message" role="status">Loading subjects for your class…</p>}
          {subjectError && <p className="subject-load-error" role="alert">Could not load active subjects: {subjectError}<button type="button" className="text-button" onClick={() => void loadSubjects()}>Try again</button></p>}
          {!subjectsLoading && !subjectError && !availableSubjects.length && <p className="subject-load-error" role="status">No active subjects are available. Ask the owner to enable a subject in Manage Subjects.</p>}
          <div className="form-row">
            <label>Academic date<input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} disabled={Boolean(batch)} /></label>
            <label>Task title <span>*</span><input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="e.g. English notebook pages" disabled={Boolean(batch)} /></label>
          </div>
          <div className="form-row">
            <label>Chapter / exercise<input value={chapter} onChange={e => setChapter(e.target.value)} placeholder="Chapter name" disabled={Boolean(batch)} /></label>
            <label>Exercise / page<input value={exercise} onChange={e => setExercise(e.target.value)} placeholder="Ex. 4.2" disabled={Boolean(batch)} /></label>
          </div>
          <label>Question numbers & page details<input value={pageDetails} onChange={e => setPageDetails(e.target.value)} placeholder="Index + completed pages 1–18" disabled={Boolean(batch)} /></label>
          <label>Notes <span>(optional)</span><textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Any notes for these pages" disabled={Boolean(batch)} /></label>
        </section>
        <section className="form-card">
          <div className="form-card-title"><h2>2. Add notebook pages</h2><span>{files.length} {files.length === 1 ? 'page' : 'pages'}</span></div>
          <p className="upload-instructions">Select the index and all completed pages together. The order you select is the page order; check the previews before uploading.</p>
          <div className="upload-actions">
            <button className="upload-dropzone" onClick={() => pickerRef.current?.click()} type="button" disabled={Boolean(batch)}>
              <ImagePlus size={27} /><strong>Choose multiple photos</strong><span>Pick pages from your gallery or files</span>
            </button>
            <button className="upload-dropzone camera-dropzone" onClick={() => cameraRef.current?.click()} type="button" disabled={Boolean(batch)}>
              <Camera size={27} /><strong>Take a page photo</strong><span>Open your camera and add pages one by one</span>
            </button>
          </div>
          <input ref={pickerRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => onFiles(e.target.files, e.currentTarget)} />
          <input ref={cameraRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => onFiles(e.target.files, e.currentTarget)} />
          {fileError && <p className="file-error" role="alert">{fileError}</p>}
          {files.length > 0 && (
            <>
              <div className="page-list-heading">
                <strong>{files.length} pages selected</strong>
                {!batch && <button type="button" className="text-button" onClick={clearFiles}>Clear all</button>}
              </div>
              <div className="page-preview-list">
                {files.map((page, index) => (
                  <div className={`page-preview ${batch?.completedFileIds.includes(page.id) ? 'uploaded' : ''}`} key={page.id}>
                    <div className="page-image-frame">
                      <img src={page.url} alt={`Notebook page ${index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} />
                    </div>
                    <div className="page-preview-meta">
                      <strong>{index === 0 ? 'Index / Page 1' : `Page ${index + 1}`}</strong>
                      <div>
                        <button type="button" disabled={Boolean(batch) || index === 0} onClick={() => moveFile(index, -1)} aria-label="Move page earlier"><ChevronLeft size={15} /></button>
                        <button type="button" disabled={Boolean(batch) || index === files.length - 1} onClick={() => moveFile(index, 1)} aria-label="Move page later"><ChevronRight size={15} /></button>
                        <button type="button" disabled={Boolean(batch)} onClick={() => rotateFile(page.id)} aria-label="Rotate page"><RotateCw size={15} /></button>
                        <button type="button" disabled={Boolean(batch)} onClick={() => removeFile(page.id)} aria-label="Remove page"><X size={15} /></button>
                      </div>
                    </div>
                    {batch?.completedFileIds.includes(page.id) && <span className="page-uploaded"><Check size={13} /> Uploaded</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          {progress && submitting && (
            <div className="upload-progress" role="status" aria-live="polite">
              <div><strong>Uploading page {Math.min(progress.done + 1, progress.total)} of {progress.total}</strong><span>{progress.current || 'Finishing page…'}</span></div>
              <progress max={progress.total} value={progress.done} />
            </div>
          )}
          {batch && !submitting && batch.completedFileIds.length < files.length && (
            <div className="retry-note" role="status">
              <AlertTriangle size={16} /> {batch.completedFileIds.length} of {files.length} pages saved. The page order is locked; retry to continue without duplicating uploaded pages.
            </div>
          )}
        </section>
      </div>
      <section className="warning-card">
        <div className="warning-icon"><AlertTriangle size={20} /></div>
        <div><strong>Before final submission</strong><p>⚠️ IMPORTANT: Please upload clear, complete and correctly labelled notebook pages. Verify the subject, date, task title, question numbers and page order before submitting. Incorrect or misleading work can confuse other students and create problems with their schoolwork. Please double-check everything before submission. Galti hui toh teacher se daant bhi pad sakti hai! 😂</p>
          <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I have checked my submission and confirm that the information is accurate to the best of my knowledge.</span></label>
        </div>
      </section>
      <div className="submit-bar"><span>{files.length ? `${files.length} pages ${batch ? 'in this upload' : 'ready'}` : 'Add at least one notebook page'}{batch ? ' · keep this page open until all pages finish' : ''}</span><button className="primary-button" disabled={subjectsLoading || !selectedSubject || !taskTitle.trim() || !confirmed || !files.length || submitting} onClick={submit}>{submitting ? 'Uploading…' : batch ? 'Retry remaining pages' : 'Upload all pages'}</button></div>
    </div>
  )
}

function ClassPages({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [documents, setDocuments] = useState<ClassDocument[]>([])
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<UploadPage[]>([])
  const [batch, setBatch] = useState<ClassDocumentBatch | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [fileError, setFileError] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const objectUrls = useRef(new Set<string>())

  const loadDocuments = useCallback(async () => {
    if (!student?.class_id) {
      setDocuments([])
      setListError('Your account is not linked to a class.')
      setLoading(false)
      return
    }
    setLoading(true)
    setListError('')
    try {
      setDocuments(await fetchClassDocuments(student.class_id))
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not load class pages.')
    } finally {
      setLoading(false)
    }
  }, [student?.class_id])

  useEffect(() => { void loadDocuments() }, [loadDocuments])
  useEffect(() => () => {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  const categories = [...new Set([
    'Index', 'Year syllabus', 'Timetable', 'Notice', 'Other',
    ...documents.map(document => document.category),
  ])]
  const visibleDocuments = documents.filter(document =>
    (!filterCategory || document.category === filterCategory)
    && `${document.title} ${document.category} ${document.notes || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  function onFiles(selected: FileList | null, input?: HTMLInputElement) {
    if (!selected) return
    const accepted: File[] = []
    let rejected = 0
    for (const file of Array.from(selected)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) rejected++
      else accepted.push(file)
    }
    setFileError(rejected ? `${rejected} file(s) skipped. Choose JPEG, PNG or WebP images up to 15 MB each.` : '')
    if (accepted.length) {
      const newPages = accepted.map(file => {
        const url = URL.createObjectURL(file)
        objectUrls.current.add(url)
        return { id: crypto.randomUUID(), file, url, rotation: 0 }
      })
      setFiles(current => [...current, ...newPages])
    }
    if (input) input.value = ''
  }

  function removeFile(id: string) {
    if (batch) return
    const page = files.find(item => item.id === id)
    if (page) {
      URL.revokeObjectURL(page.url)
      objectUrls.current.delete(page.url)
    }
    setFiles(current => current.filter(item => item.id !== id))
  }

  function moveFile(index: number, amount: number) {
    if (batch) return
    setFiles(current => {
      const next = [...current]
      const target = index + amount
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function submitDocuments() {
    if (!supabase || !student?.class_id || !category.trim() || !title.trim() || !files.length) return
    setSubmitting(true)
    try {
      let activeBatch = batch
      if (!activeBatch) {
        const { data: document, error } = await supabase.from('class_documents').insert({
          class_id: student.class_id,
          uploaded_by: student.id,
          category: category.trim(),
          title: title.trim(),
          notes: notes.trim() || null,
        }).select('id').single()
        if (error) throw error
        activeBatch = { documentId: document.id, completedFileIds: [] }
        setBatch(activeBatch)
      }

      setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: '' })
      for (let index = 0; index < files.length; index++) {
        const page = files[index]
        if (activeBatch.completedFileIds.includes(page.id)) continue
        setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: page.file.name })
        let compressed = page.file
        if (compressed.size > 1.5 * 1024 * 1024) {
          compressed = await imageCompression(compressed, {
            maxSizeMB: 1.5, maxWidthOrHeight: 2600, useWebWorker: true,
          })
        }
        const extension = compressed.type === 'image/png' ? 'png' : compressed.type === 'image/webp' ? 'webp' : 'jpg'
        const storagePath = `${student.class_id}/${activeBatch.documentId}/${index + 1}-${page.id}.${extension}`
        const { data: existingPage, error: lookupError } = await supabase.from('class_document_pages')
          .select('id')
          .eq('document_id', activeBatch.documentId)
          .eq('page_number', index + 1)
          .maybeSingle()
        if (lookupError) throw lookupError
        if (!existingPage) {
          const { error: uploadError } = await supabase.storage.from('classwork-documents').upload(storagePath, compressed, {
            contentType: compressed.type, upsert: false,
          })
          const isRetryOfStoredFile = uploadError
            && (uploadError as { statusCode?: string }).statusCode === '409'
          if (uploadError && !isRetryOfStoredFile) throw uploadError
          const { error: pageError } = await supabase.from('class_document_pages').insert({
            document_id: activeBatch.documentId,
            page_number: index + 1,
            storage_path: storagePath,
            mime_type: compressed.type,
            file_size: compressed.size,
            rotation: page.rotation,
          })
          if (pageError) throw pageError
        }
        activeBatch = {
          ...activeBatch,
          completedFileIds: [...activeBatch.completedFileIds, page.id],
        }
        setBatch(activeBatch)
        setProgress({ done: activeBatch.completedFileIds.length, total: files.length, current: '' })
      }

      showToast('Class pages uploaded successfully.')
      files.forEach(page => URL.revokeObjectURL(page.url))
      files.forEach(page => objectUrls.current.delete(page.url))
      setFiles([])
      setCategory('')
      setTitle('')
      setNotes('')
      setBatch(null)
      setFileError('')
      setProgress(null)
      await loadDocuments()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Upload paused. Your pages are preserved; retry to continue.', 'error')
    } finally {
      setSubmitting(false)
      setProgress(null)
    }
  }

  return (
    <div className="page class-pages">
      <div className="page-heading">
        <div><p className="eyebrow">CLASS REFERENCE</p><h1>Class pages</h1></div>
        <button className="secondary-button" onClick={() => void loadDocuments()} disabled={loading}>Refresh</button>
      </div>
      <p className="class-pages-intro">Share index pages, the year syllabus, timetables, notices, or your own category with the class.</p>
      <section className="form-card class-document-form">
        <h2>Add separate class pages</h2>
        <div className="form-row">
          <label>Category <span>*</span><input list="class-page-categories" value={category} onChange={e => setCategory(e.target.value)} maxLength={80} placeholder="Choose or type a category" disabled={Boolean(batch)} />
            <datalist id="class-page-categories">{categories.map(item => <option key={item} value={item} />)}</datalist>
          </label>
          <label>Title <span>*</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Mathematics syllabus 2026" disabled={Boolean(batch)} /></label>
        </div>
        <label>Notes <span>(optional)</span><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="Add helpful details for classmates" disabled={Boolean(batch)} /></label>
        <div className="form-card-title"><h2>Choose or take page photos</h2><span>{files.length} {files.length === 1 ? 'page' : 'pages'}</span></div>
        <p className="upload-instructions">Pick multiple images at once or use the camera button to capture pages one by one. Reorder and check the previews before submitting.</p>
        <div className="upload-actions">
          <button className="upload-dropzone" type="button" onClick={() => pickerRef.current?.click()} disabled={Boolean(batch)}>
            <ImagePlus size={27} /><strong>Choose multiple photos</strong><span>Select several pages from your device</span>
          </button>
          <button className="upload-dropzone camera-dropzone" type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(batch)}>
            <Camera size={27} /><strong>Take a page photo</strong><span>Open your camera and add pages one by one</span>
          </button>
        </div>
        <input ref={pickerRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => onFiles(e.target.files, e.currentTarget)} />
        <input ref={cameraRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => onFiles(e.target.files, e.currentTarget)} />
        {fileError && <p className="file-error" role="alert">{fileError}</p>}
        {files.length > 0 && (
          <div className="page-preview-list">
            {files.map((page, index) => (
              <div className={`page-preview ${batch?.completedFileIds.includes(page.id) ? 'uploaded' : ''}`} key={page.id}>
                <div className="page-image-frame"><img src={page.url} alt={`${category || 'Class'} page ${index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} /></div>
                <div className="page-preview-meta">
                  <strong>Page {index + 1}</strong>
                  <div>
                    <button type="button" disabled={Boolean(batch) || index === 0} onClick={() => moveFile(index, -1)} aria-label="Move page earlier"><ChevronLeft size={15} /></button>
                    <button type="button" disabled={Boolean(batch) || index === files.length - 1} onClick={() => moveFile(index, 1)} aria-label="Move page later"><ChevronRight size={15} /></button>
                    <button type="button" disabled={Boolean(batch)} onClick={() => setFiles(current => current.map(item => item.id === page.id ? { ...item, rotation: (item.rotation + 90) % 360 } : item))} aria-label="Rotate page"><RotateCw size={15} /></button>
                    <button type="button" disabled={Boolean(batch)} onClick={() => removeFile(page.id)} aria-label="Remove page"><X size={15} /></button>
                  </div>
                </div>
                {batch?.completedFileIds.includes(page.id) && <span className="page-uploaded"><Check size={13} /> Uploaded</span>}
              </div>
            ))}
          </div>
        )}
        {files.length > 0 && !batch && <button type="button" className="text-button clear-class-pages" onClick={() => {
          files.forEach(page => URL.revokeObjectURL(page.url))
          files.forEach(page => objectUrls.current.delete(page.url))
          setFiles([])
          setFileError('')
        }}>Clear selected pages</button>}
        {progress && submitting && (
          <div className="upload-progress" role="status" aria-live="polite">
            <div><strong>Uploading page {Math.min(progress.done + 1, progress.total)} of {progress.total}</strong><span>{progress.current || 'Finishing page…'}</span></div>
            <progress max={progress.total} value={progress.done} />
          </div>
        )}
        {batch && !submitting && batch.completedFileIds.length < files.length && (
          <div className="retry-note" role="status"><AlertTriangle size={16} /> {batch.completedFileIds.length} of {files.length} pages saved. Retry to continue without duplicating uploaded pages.</div>
        )}
        <div className="class-document-submit">
          <span>{files.length ? `${files.length} pages ready` : 'Add at least one page'}</span>
          <button className="primary-button" disabled={!student?.class_id || !category.trim() || !title.trim() || !files.length || submitting} onClick={() => void submitDocuments()}>
            {submitting ? 'Uploading…' : batch ? 'Retry remaining pages' : 'Submit class pages'}
          </button>
        </div>
      </section>

      <div className="class-pages-toolbar">
        <div className="search-box large"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, category or notes" /></div>
        <select aria-label="Filter class pages by category" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}
        </select>
      </div>
      {listError ? <div className="empty-state"><AlertTriangle size={32} /><h3>Could not load class pages</h3><p>{listError}</p><button className="secondary-button" onClick={() => void loadDocuments()}>Try again</button></div>
        : loading ? <Loading /> : visibleDocuments.length ? (
          <div className="class-document-list">
            {visibleDocuments.map(document => (
              <article className="class-document-card" key={document.id}>
                <div className="class-document-heading">
                  <div><span className="category-chip">{document.category}</span><strong>{document.title}</strong><small>Added by {document.uploader_name || 'Class member'} · {new Date(document.created_at).toLocaleDateString()}</small></div>
                </div>
                {document.notes && <p>{document.notes}</p>}
                <div className="class-document-pages">
                  {document.pages.map(page => (
                    <a href={page.signed_url} target="_blank" rel="noreferrer" key={page.id} aria-label={`Open ${document.title}, page ${page.page_number}`}>
                      <img src={page.signed_url} alt={`${document.title}, page ${page.page_number}`} style={{ transform: `rotate(${page.rotation}deg)` }} />
                      <span>Page {page.page_number}</span>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state"><Archive size={34} /><h3>{documents.length ? 'No class pages match this filter' : 'No separate pages yet'}</h3><p>{documents.length ? 'Try another category or search.' : 'Add the first index, syllabus, timetable, or custom reference pages above.'}</p></div>
        )}
    </div>
  )
}

function DailyWork({ date, tasks, navigate }: { date: string; tasks: TaskRow[]; navigate: (page: PageName) => void }) {
  async function downloadDailyPdf() {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.text('Class 5 · Daily Work', 105, 35, { align: 'center' })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(12); pdf.text(formatDate(date), 105, 45, { align: 'center' })
    pdf.setDrawColor(210); pdf.line(20, 52, 190, 52)
    let y = 65
    for (const task of tasks) {
      if (y > 250) { pdf.addPage(); y = 25 }
      pdf.setFont('helvetica', 'bold'); pdf.text(task.title, 20, y)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
      pdf.text(`${task.subjects?.name || 'Subject'} · ${task.chapter || ''}`, 20, y + 7)
      y += 18
    }
    if (!tasks.length) { pdf.setFontSize(12); pdf.text('No selected tasks or submissions for this date.', 20, y) }
    pdf.save(`class-5-daily-work-${date}.pdf`)
  }

  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">DAILY WORK</p><h1>{formatDate(date)}</h1></div><button className="secondary-button" onClick={downloadDailyPdf}><Download size={16} /> Download PDF</button></div>
      {subjects.map(subject => {
        const subjectTasks = tasks.filter(task => task.subjects?.name === subject.name)
        if (!subjectTasks.length) return null
        return (
          <section className="daily-section" key={subject.name}>
            <div className="daily-heading"><div className="subject-icon" style={{ background: `${subject.color}16`, color: subject.color }}>{subject.short}</div><h2>{subject.name}</h2></div>
            {subjectTasks.map(task => <div className="task-card" key={task.id}><div><strong>{task.title}</strong><span>{task.chapter || 'No chapter'} · {task.status.replaceAll('_', ' ')}</span></div><button className="icon-button" aria-label={`Open ${task.title}`} onClick={() => navigate('Digital Notebook')}><ChevronRight size={18} /></button></div>)}
          </section>
        )
      })}
      {!tasks.length && <div className="empty-state"><CalendarDays size={34} /><h3>No submissions for this date</h3><p>Select a different date or upload work.</p><button className="secondary-button" onClick={() => navigate('Upload Work')}>Upload work</button></div>}
    </div>
  )
}

function Notebook({ showToast, student }: { showToast: (text: string, type?: 'success' | 'error') => void; student: any }) {
  const [subject, setSubject] = useState(subjects[0].name)
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState<CuratedPage[]>([])
  const [archives, setArchives] = useState<PdfArchive[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const loadPages = useCallback(async () => {
    setLoading(true)
    try {
      const [curatedPages, pdfArchives] = await Promise.all([
        fetchCuratedPages(),
        student?.class_id ? fetchPdfArchives(student.class_id) : Promise.resolve([]),
      ])
      setPages(curatedPages)
      setArchives(pdfArchives)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load the digital notebook.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, student?.class_id])

  useEffect(() => { void loadPages() }, [loadPages])

  const visiblePages = pages
    .filter(page => page.task.subjects?.name === subject)
    .filter(page => `${page.task.title} ${page.task.chapter || ''} ${page.task.exercise || ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.task.academic_date.localeCompare(b.task.academic_date) || a.page_number - b.page_number)
  const subjectPages = pages.filter(page => page.task.subjects?.name === subject)

  async function downloadSubjectPdf() {
    setDownloading(true)
    try {
      await downloadPagesPdf(
        `Class 5 ${subject} Notebook`,
        visiblePages.map(page => ({
          label: `${page.task.title} · Page ${page.page_number}`,
          signedUrl: page.page.signed_url,
          rotation: page.page.rotation,
        })),
        `class-5-${subject.replaceAll(' / ', '-').toLowerCase()}-notebook.pdf`,
      )
      showToast('Notebook PDF downloaded.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the notebook PDF.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function publishSubjectPdf() {
    if (!supabase || !student?.is_owner || !subjectPages.length) return
    setPublishing(true)
    let path: string | null = null
    try {
      const { data: subjectRow, error: subjectError } = await supabase.from('subjects')
        .select('id')
        .eq('class_id', student.class_id)
        .eq('name', subject)
        .maybeSingle()
      if (subjectError) throw subjectError
      if (!subjectRow) throw new Error('The selected subject is no longer available.')

      const { data: latest, error: latestError } = await supabase.from('daily_pdf_archives')
        .select('version')
        .eq('class_id', student.class_id)
        .eq('pdf_type', 'subject')
        .eq('subject_id', subjectRow.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestError) throw latestError
      const version = (latest?.version || 0) + 1
      const blob = await createPagesPdfBlob(`Class 5 ${subject} Notebook`, subjectPages.map(page => ({
        label: `${page.task.title} · Page ${page.page_number}`,
        signedUrl: page.page.signed_url,
        rotation: page.page.rotation,
      })))
      path = `${student.class_id}/subject/${subjectRow.id}/${crypto.randomUUID()}-v${version}.pdf`
      const { error: uploadError } = await supabase.storage.from('classwork-pdfs').upload(path, blob, {
        contentType: 'application/pdf',
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { error: archiveError } = await supabase.from('daily_pdf_archives').insert({
        class_id: student.class_id,
        pdf_type: 'subject',
        subject_id: subjectRow.id,
        storage_path: path,
        version,
        published_by: student.id,
      })
      if (archiveError) {
        const { error: cleanupError } = await supabase.storage.from('classwork-pdfs').remove([path])
        if (cleanupError) throw new Error(`${archiveError.message}; uploaded file cleanup failed: ${cleanupError.message}`)
        throw archiveError
      }
      showToast(`${subject} PDF published to the class archive.`)
      await loadPages()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not publish the subject PDF.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">DIGITAL NOTEBOOK</p><h1>Curated pages</h1></div>
        <div className="notebook-actions">
          {student?.is_owner && <button className="secondary-button" onClick={() => void publishSubjectPdf()} disabled={publishing || loading || !subjectPages.length}>{publishing ? 'Publishing…' : 'Publish PDF'}</button>}
          <button className="secondary-button" onClick={() => void downloadSubjectPdf()} disabled={downloading || loading || !visiblePages.length}>
            <Download size={16} />{downloading ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>
      <div className="notebook-toolbar">
        <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
        <div className="search-box"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task title" /></div>
      </div>
      {loading ? <Loading /> : visiblePages.length ? (
        <div className="curated-page-list">
          {visiblePages.map(page => (
            <article className="curated-page" key={`${page.task_id}-${page.page_number}`}>
              <img src={page.page.signed_url} alt={`${page.task.title}, page ${page.page_number}`} style={{ transform: `rotate(${page.page.rotation}deg)` }} />
              <div><strong>{page.task.title}</strong><span>Page {page.page_number} · {formatDate(page.task.academic_date)}</span></div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><BookOpen size={34} /><h3>{pages.length ? 'No pages match this filter' : 'No curated pages yet'}</h3><p>{pages.length ? 'Try another search or subject.' : 'The owner can select submitted pages from All Submissions.'}</p></div>
      )}
      <section className="archive-section">
        <div className="section-title"><div><span>CLASS ARCHIVE</span><strong>Published PDFs</strong></div><button className="text-button" onClick={() => void loadPages()}>Refresh</button></div>
        {archives.length ? (
          <div className="archive-list">
            {archives.map(archive => (
              <a className="archive-item" key={archive.id} href={archive.signed_url} target="_blank" rel="noreferrer">
                <FileText size={18} />
                <div><strong>{archive.subject_name || 'Class'} · Version {archive.version}</strong><span>Published {new Date(archive.published_at).toLocaleString()}</span></div>
                <Download size={16} />
              </a>
            ))}
          </div>
        ) : <p className="archive-empty">No PDFs have been published yet.</p>}
      </section>
    </div>
  )
}

function SubmissionsView({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([])
  const [selectedBySlot, setSelectedBySlot] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyPageId, setBusyPageId] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null)

  const loadSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const work = await fetchWorkSubmissions(undefined, student?.is_owner)
      setSubmissions(work)
      if (student?.is_owner && supabase) {
        const { data, error } = await supabase.from('notebook_page_selections')
          .select('task_id,page_number,submission_page_id')
          .eq('status', 'finalised')
        if (error) throw error
        setSelectedBySlot(Object.fromEntries((data || []).flatMap(item =>
          item.submission_page_id ? [[`${item.task_id}:${item.page_number}`, item.submission_page_id]] : []
        )))
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load submissions.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, student?.is_owner])

  useEffect(() => { void loadSubmissions() }, [loadSubmissions])

  const visibleSubmissions = submissions.filter(submission => {
    const task = submission.task
    const searchable = `${task?.title || ''} ${task?.chapter || ''} ${task?.exercise || ''} ${submission.contributor?.display_name || ''} ${submission.contributor?.roll_number || ''}`.toLowerCase()
    return (!subject || task?.subjects?.name === subject)
      && (!date || task?.academic_date === date)
      && searchable.includes(search.toLowerCase())
  })

  async function selectPage(submission: WorkSubmission, page: WorkSubmission['pages'][number]) {
    if (!supabase || !student?.is_owner || !submission.task) return
    setBusyPageId(page.id)
    try {
      const { error } = await supabase.rpc('select_notebook_page', {
        p_task_id: submission.task_id,
        p_page_number: page.page_number,
        p_submission_page_id: page.id,
      })
      if (error) throw error
      setSelectedBySlot(current => ({ ...current, [`${submission.task_id}:${page.page_number}`]: page.id }))
      const expectedPageCount = submissions
        .filter(item => item.task_id === submission.task_id && !item.is_hidden)
        .flatMap(item => item.pages)
        .reduce((maxPage, item) => Math.max(maxPage, item.page_number), 0)
      const { count, error: selectionError } = await supabase.from('notebook_page_selections')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', submission.task_id)
        .eq('status', 'finalised')
      if (selectionError) throw selectionError
      if (expectedPageCount > 0 && (count || 0) >= expectedPageCount) {
        const { error: taskError } = await supabase.from('tasks')
          .update({ status: 'finalised' })
          .eq('id', submission.task_id)
        if (taskError) throw taskError
      }
      showToast(`Page ${page.page_number} selected for the digital notebook.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not select this notebook page.', 'error')
    } finally {
      setBusyPageId(null)
    }
  }

  async function submitReport(submissionId: string) {
    if (!supabase || !student?.id || !reportReason.trim()) return
    try {
      const { error } = await supabase.from('reports').insert({
        submission_id: submissionId,
        reporter_id: student.id,
        reason: reportReason.trim(),
      })
      if (error) throw error
      showToast('Report sent to the class owner.')
      setReportingId(null)
      setReportReason('')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not submit this report.', 'error')
    }
  }

  async function reviewSubmission(submissionId: string, status: 'approved' | 'rejected') {
    if (!supabase || !student?.is_owner) return
    setBusySubmissionId(submissionId)
    try {
      const { error } = await supabase.rpc('review_submission', {
        p_submission_id: submissionId,
        p_status: status,
        p_review_notes: null,
      })
      if (error) throw error
      showToast(status === 'approved' ? 'Submission approved.' : 'Submission rejected.')
      await loadSubmissions()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not review this submission.', 'error')
    } finally {
      setBusySubmissionId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">WORK ARCHIVE</p><h1>All submissions</h1></div>
        <button className="secondary-button" onClick={() => void loadSubmissions()}>Refresh</button>
      </div>
      <div className="filter-bar">
        <div className="search-box large"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, chapter or contributor" /></div>
        <select aria-label="Filter subject" value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select>
        <input type="date" aria-label="Filter date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      {loading ? <Loading /> : visibleSubmissions.length ? (
        <div className="submission-list">
          {visibleSubmissions.map(submission => (
            <article className="submission-card" key={submission.id}>
              <div className="submission-heading">
                <div><strong>{submission.task?.title || 'Untitled work'}</strong><span>{submission.task?.subjects?.name || 'Subject'} · {submission.task?.chapter || 'No chapter'} · {formatDate(submission.task?.academic_date || '')}</span></div>
                <div className="submission-contributor">
                  {submission.contributor?.display_name || 'Student'} · Roll {submission.contributor?.roll_number || '—'}
                  <span className={`status-pill ${submission.approval_status}`}>{submission.approval_status.replaceAll('_', ' ')}</span>
                </div>
              </div>
              {submission.notes && <p className="submission-notes">{submission.notes}</p>}
              <div className="submission-pages">
                {submission.pages.map(page => {
                  const slot = `${submission.task_id}:${page.page_number}`
                  const selected = selectedBySlot[slot] === page.id
                  return (
                    <div className="submission-page" key={page.id}>
                      <img src={page.signed_url} alt={`Page ${page.page_number}`} style={{ transform: `rotate(${page.rotation}deg)` }} />
                      <div><strong>Page {page.page_number}</strong>
                        {student?.is_owner && <button className={selected ? 'selected-page-button' : 'text-button'} disabled={busyPageId === page.id} onClick={() => void selectPage(submission, page)}>
                          {busyPageId === page.id ? 'Saving…' : selected ? 'Selected' : 'Select for notebook'}
                        </button>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {student?.is_owner && (
                <div className="approval-actions">
                  <button
                    className="secondary-button"
                    disabled={busySubmissionId === submission.id || submission.approval_status === 'rejected'}
                    onClick={() => void reviewSubmission(submission.id, 'rejected')}
                  >
                    {busySubmissionId === submission.id ? 'Saving…' : 'Reject'}
                  </button>
                  <button
                    className="primary-button"
                    disabled={busySubmissionId === submission.id || submission.approval_status === 'approved'}
                    onClick={() => void reviewSubmission(submission.id, 'approved')}
                  >
                    {busySubmissionId === submission.id ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              )}
              {!student?.is_owner && (reportingId === submission.id ? (
                <div className="report-form">
                  <label>What should the owner review?<textarea value={reportReason} onChange={e => setReportReason(e.target.value)} maxLength={500} placeholder="Describe the issue" /></label>
                  <button className="secondary-button" onClick={() => { setReportingId(null); setReportReason('') }}>Cancel</button>
                  <button className="primary-button" disabled={!reportReason.trim()} onClick={() => void submitReport(submission.id)}>Send report</button>
                </div>
              ) : (
                <button className="text-button report-button" onClick={() => setReportingId(submission.id)}>Report an issue</button>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><FolderOpen size={34} /><h3>{submissions.length ? 'No submissions match these filters' : 'No submissions yet'}</h3><p>{submissions.length ? 'Try changing the search, subject, or date.' : 'Student uploads will appear here after they are submitted.'}</p></div>
      )}
    </div>
  )
}

function Contributions({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const loadContributions = useCallback(async () => {
    if (!student?.id) return
    setLoading(true)
    try {
      setSubmissions(await fetchWorkSubmissions(student.id, true))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load your contributions.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, student?.id])

  useEffect(() => { void loadContributions() }, [loadContributions])

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">CONTRIBUTOR HISTORY</p><h1>My contributions</h1></div>
        <button className="secondary-button" onClick={() => void loadContributions()}>Refresh</button>
      </div>
      {loading ? <Loading /> : submissions.length ? (
        <div className="submission-list">
          {submissions.map(submission => (
            <article className="submission-card" key={submission.id}>
              <div className="submission-heading">
                <div><strong>{submission.task?.title || 'Untitled work'}</strong><span>{submission.task?.subjects?.name || 'Subject'} · {submission.task?.chapter || 'No chapter'} · {formatDate(submission.task?.academic_date || '')}</span></div>
                <div className="submission-contributor">{submission.pages.length} page{submission.pages.length === 1 ? '' : 's'}</div>
              </div>
              <div className="submission-pages">
                {submission.pages.map(page => <div className="submission-page" key={page.id}><img src={page.signed_url} alt={`Page ${page.page_number}`} style={{ transform: `rotate(${page.rotation}deg)` }} /><div><strong>Page {page.page_number}</strong></div></div>)}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><UserRound size={34} /><h3>No contributions yet</h3><p>Uploads made by {student?.display_name || 'you'} will appear here.</p></div>
      )}
    </div>
  )
}

function AdminPanel({ navigate, pendingCount }: { navigate: (page: PageName) => void; pendingCount: number }) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">OWNER ONLY</p><h1>Admin panel</h1></div></div>
      <div className="admin-grid">
        <button className="admin-card" onClick={() => navigate('Member Approvals')}>
          <div className="admin-icon"><Users size={21} /></div>
          <div><strong>Student approvals</strong><span>{pendingCount} pending request{pendingCount === 1 ? '' : 's'}</span></div>
          <ChevronRight size={18} />
        </button>
        <button className="admin-card" onClick={() => navigate('Manage Subjects')}>
          <div className="admin-icon"><Grid2X2 size={21} /></div>
          <div><strong>Manage subjects</strong><span>Enable or pause class subjects</span></div>
          <ChevronRight size={18} />
        </button>
        <button className="admin-card" onClick={() => navigate('All Submissions')}>
          <div className="admin-icon"><FolderOpen size={21} /></div>
          <div><strong>Task & submission review</strong><span>Review pages and curate the notebook</span></div>
          <ChevronRight size={18} />
        </button>
        <button className="admin-card" onClick={() => navigate('Digital Notebook')}>
          <div className="admin-icon"><FileText size={21} /></div>
          <div><strong>PDF publishing</strong><span>Download curated subject PDFs</span></div>
          <ChevronRight size={18} />
        </button>
        <button className="admin-card" onClick={() => navigate('Reports')}>
          <div className="admin-icon"><AlertTriangle size={21} /></div>
          <div><strong>Reports</strong><span>Review student-submitted reports</span></div>
          <ChevronRight size={18} />
        </button>
        <button className="admin-card" onClick={() => navigate('Audit History')}>
          <div className="admin-icon"><Clock3 size={21} /></div>
          <div><strong>Audit history</strong><span>View owner curation activity</span></div>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

type PendingStudent = {
  id: string
  display_name: string
  roll_number: string
  created_at: string
}

function MemberApprovals({ showToast }: { showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [requests, setRequests] = useState<PendingStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    const client = supabase
    if (!client) return
    try {
      const { data, error } = await client.from('students')
        .select('id,display_name,roll_number,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      setRequests(data || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load member requests.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadRequests()
    const client = supabase
    if (!client) return
    const channel = client.channel('member-approval-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        void loadRequests()
      })
      .subscribe()
    const timer = window.setInterval(() => { void loadRequests() }, 15000)
    return () => {
      window.clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [loadRequests])

  async function updateRequest(request: PendingStudent, status: 'approved' | 'suspended') {
    const client = supabase
    if (!client) return
    setBusyId(request.id)
    try {
      const { error } = await client.rpc('set_student_approval', {
        p_student_id: request.id,
        p_status: status,
      })
      if (error) throw error
      showToast(status === 'approved' ? `${request.display_name} approved.` : `${request.display_name} declined.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update this member request.', 'error')
    } finally {
      setBusyId(null)
      await loadRequests()
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">OWNER ONLY</p><h1>Member approvals</h1></div>
        <button className="secondary-button" onClick={() => { setLoading(true); void loadRequests() }}>Refresh</button>
      </div>
      <p className="approval-intro">Review class join requests here. Approved members can sign in and use the notebook immediately.</p>
      {loading ? <Loading /> : requests.length ? (
        <div className="approval-list">
          {requests.map(request => (
            <article className="approval-card" key={request.id}>
              <div className="approval-avatar">{request.display_name.slice(0, 1).toUpperCase()}</div>
              <div className="approval-details">
                <strong>{request.display_name}</strong>
                <span>Roll number {request.roll_number}</span>
                <small>Requested {new Date(request.created_at).toLocaleString()}</small>
              </div>
              <div className="approval-actions">
                <button className="secondary-button" disabled={busyId === request.id} onClick={() => void updateRequest(request, 'suspended')}>Decline</button>
                <button className="primary-button" disabled={busyId === request.id} onClick={() => void updateRequest(request, 'approved')}>
                  {busyId === request.id ? 'Saving…' : 'Approve'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Users size={34} /><h3>No pending member requests</h3><p>New requests will appear here and update automatically.</p></div>
      )}
    </div>
  )
}

type SubjectRecord = { id: string; name: string; sort_order: number; is_active: boolean }

function ManageSubjects({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [subjectRows, setSubjectRows] = useState<SubjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadSubjects = useCallback(async () => {
    if (!supabase || !student?.class_id) return
    try {
      const { data, error } = await supabase.from('subjects')
        .select('id,name,sort_order,is_active')
        .eq('class_id', student.class_id)
        .order('sort_order')
      if (error) throw error
      setSubjectRows(data || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load subjects.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, student?.class_id])

  useEffect(() => { void loadSubjects() }, [loadSubjects])

  async function toggleSubject(subject: SubjectRecord) {
    if (!supabase) return
    setBusyId(subject.id)
    try {
      const { error } = await supabase.from('subjects')
        .update({ is_active: !subject.is_active })
        .eq('id', subject.id)
      if (error) throw error
      showToast(`${subject.name} ${subject.is_active ? 'paused' : 'enabled'}.`)
      await loadSubjects()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update this subject.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">OWNER ONLY</p><h1>Manage subjects</h1></div>
        <button className="secondary-button" onClick={() => void loadSubjects()}>Refresh</button>
      </div>
      <p className="approval-intro">Paused subjects are hidden from new uploads. Existing work remains available.</p>
      {loading ? <Loading /> : (
        <div className="subject-management-list">
          {subjectRows.map(subject => (
            <article className="subject-management-row" key={subject.id}>
              <div><strong>{subject.name}</strong><span>{subject.is_active ? 'Available for uploads' : 'Paused'}</span></div>
              <button className={subject.is_active ? 'secondary-button' : 'primary-button'} disabled={busyId === subject.id} onClick={() => void toggleSubject(subject)}>
                {busyId === subject.id ? 'Saving…' : subject.is_active ? 'Pause' : 'Enable'}
              </button>
            </article>
          ))}
          {!subjectRows.length && <div className="empty-state"><Grid2X2 size={34} /><h3>No subjects configured</h3><p>Run the class setup migration to seed subjects.</p></div>}
        </div>
      )}
    </div>
  )
}

type ReportRecord = {
  id: string
  submission_id: string
  reporter_id: string
  reason: string
  status: 'open' | 'reviewed' | 'resolved'
  created_at: string
}

function ReportsView({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadReports = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const [{ data, error }, work] = await Promise.all([
        supabase.from('reports').select('id,submission_id,reporter_id,reason,status,created_at').order('created_at', { ascending: false }),
        fetchWorkSubmissions(),
      ])
      if (error) throw error
      setReports(data || [])
      setSubmissions(work)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load reports.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void loadReports() }, [loadReports])

  async function updateReport(report: ReportRecord, status: 'reviewed' | 'resolved') {
    if (!supabase) return
    setBusyId(report.id)
    try {
      const { error } = await supabase.from('reports')
        .update({ status, reviewed_by: student.id })
        .eq('id', report.id)
      if (error) throw error
      showToast(status === 'resolved' ? 'Report resolved.' : 'Report marked reviewed.')
      await loadReports()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update this report.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const submissionById = new Map(submissions.map(submission => [submission.id, submission]))

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">OWNER ONLY</p><h1>Student reports</h1></div>
        <button className="secondary-button" onClick={() => void loadReports()}>Refresh</button>
      </div>
      {loading ? <Loading /> : reports.length ? (
        <div className="report-list">
          {reports.map(report => {
            const submission = submissionById.get(report.submission_id)
            return (
              <article className="report-card" key={report.id}>
                <div><span className={`status-pill ${report.status}`}>{report.status}</span><small>{new Date(report.created_at).toLocaleString()}</small></div>
                <strong>{submission?.task?.title || 'Submission unavailable'}</strong>
                <p>{report.reason}</p>
                {submission && <span>{submission.contributor?.display_name || 'Student'} · Roll {submission.contributor?.roll_number || '—'}</span>}
                <div className="report-actions">
                  {report.status === 'open' && <button className="secondary-button" disabled={busyId === report.id} onClick={() => void updateReport(report, 'reviewed')}>Mark reviewed</button>}
                  {report.status !== 'resolved' && <button className="primary-button" disabled={busyId === report.id} onClick={() => void updateReport(report, 'resolved')}>{busyId === report.id ? 'Saving…' : 'Resolve'}</button>}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state"><AlertTriangle size={34} /><h3>No student reports</h3><p>Reports submitted from the All Submissions section will appear here.</p></div>
      )}
    </div>
  )
}

type AuditRecord = {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

function AuditHistory({ showToast }: { showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [actors, setActors] = useState<Record<string, { display_name: string; roll_number: string; is_owner: boolean }>>({})
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const loadRecords = useCallback(async () => {
    if (!supabase) return
    try {
      const { data, error } = await supabase.from('audit_logs')
        .select('id,actor_id,action,entity_type,entity_id,old_value,new_value,created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      const rows = (data || []) as AuditRecord[]
      const actorIds = [...new Set(rows.map(row => row.actor_id))]
      const { data: actors } = await supabase.from('students')
        .select('id,display_name,roll_number,is_owner')
        .in('id', actorIds)
      const actorById = new Map((actors || []).map(actor => [actor.id, actor]))
      setActors(Object.fromEntries(actorById))
      setRecords(rows)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load audit history.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])
  useEffect(() => { void loadRecords() }, [loadRecords])

  const actionOptions = [...new Set(records.map(record => record.action))]
  const visibleRecords = records.filter(record => {
    const actor = actors[record.actor_id]
    const text = `${record.action} ${record.entity_type} ${record.entity_id || ''} ${actor?.display_name || ''} ${actor?.roll_number || ''} ${JSON.stringify(record.new_value || {})}`.toLowerCase()
    return (!actionFilter || record.action === actionFilter) && text.includes(search.toLowerCase())
  })
  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">OWNER ONLY</p><h1>Audit history</h1></div>
        <button className="secondary-button" onClick={() => void loadRecords()}>Refresh</button>
      </div>
      <div className="filter-bar">
        <div className="search-box large"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search actor, action or details" /></div>
        <select value={actionFilter} onChange={event => setActionFilter(event.target.value)} aria-label="Filter audit action">
          <option value="">All activities</option>
          {actionOptions.map(action => <option key={action} value={action}>{action.replaceAll('_', ' ')}</option>)}
        </select>
      </div>
      {loading ? <Loading /> : visibleRecords.length ? (
        <div className="audit-list">
          {visibleRecords.map(record => (
            <article className="audit-row" key={record.id}>
              <div>
                <strong>{record.action.replaceAll('_', ' ')}</strong>
                <span>{actors[record.actor_id]?.display_name || 'Unknown account'} · Roll {actors[record.actor_id]?.roll_number || '—'} · {actors[record.actor_id]?.is_owner ? 'Owner' : 'Student'}</span>
                <span>{record.entity_type.replaceAll('_', ' ')}{record.entity_id ? ` · ${record.entity_id}` : ''}</span>
                {(record.old_value || record.new_value) && <pre className="audit-details">{JSON.stringify({ old: record.old_value, new: record.new_value }, null, 2)}</pre>}
              </div>
              <small>{new Date(record.created_at).toLocaleString()}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Clock3 size={34} /><h3>No audit events yet</h3><p>Owner curation activity will be recorded here.</p></div>
      )}
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="settings-skeleton" role="status" aria-label="Loading settings">
      <div className="skeleton-line wide" />
      <div className="settings-skeleton-grid"><div /><div /></div>
      <div className="skeleton-line" /><div className="skeleton-line short" />
    </div>
  )
}

function SettingsView({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [defaultSubjectId, setDefaultSubjectId] = useState('')
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([])
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [emailNotifications, setEmailNotifications] = useState(false)
  const [compactView, setCompactView] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [language, setLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabase || !student?.id) return
    void (async () => {
      try {
        const [{ data: preference }, { data: subjectRows }] = await Promise.all([
          supabase.from('user_preferences').select('*').eq('user_id', student.id).maybeSingle(),
          supabase.from('subjects').select('id,name').eq('class_id', student.class_id).eq('is_active', true).order('sort_order'),
        ])
        setSubjects(subjectRows || [])
        if (preference) {
          setDefaultSubjectId(preference.default_subject_id || '')
          setNotificationsEnabled(preference.notifications_enabled)
          setEmailNotifications(preference.email_notifications)
          setCompactView(preference.compact_view)
          setReducedMotion(preference.accessibility_reduced_motion)
          setLanguage(preference.language)
        }
      } finally {
        setReady(true)
      }
    })()
  }, [student?.id, student?.class_id])

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.scrollBehavior = reducedMotion ? 'auto' : 'smooth'
  }, [reducedMotion])

  async function savePreferences() {
    if (!supabase || !student?.id) return
    setSaving(true)
    try {
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: student.id,
        theme: 'light',
        default_subject_id: defaultSubjectId || null,
        notifications_enabled: notificationsEnabled,
        email_notifications: emailNotifications,
        compact_view: compactView,
        accessibility_reduced_motion: reducedMotion,
        language,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      await supabase.rpc('log_activity', {
        p_action: 'updated_personal_preferences',
        p_entity_type: 'user_preferences',
        p_metadata: { theme: 'light', default_subject_id: defaultSubjectId || null, notifications_enabled: notificationsEnabled, compact_view: compactView, language },
      })
      showToast('Personal settings saved.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save personal settings.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h1>Settings</h1></div></div>
      {!ready ? <SettingsSkeleton /> : (
      <section className="settings-card">
        <h2>Student identity</h2>
        <div className="form-row">
          <label>Display name<input value={student?.display_name || ''} readOnly /></label>
          <label>Roll number<input value={student?.roll_number || ''} readOnly /></label>
        </div>
        <div className="settings-note"><ShieldCheck size={17} /><span>Name and roll number can only be changed by the class owner.</span></div>
        <h2 className="settings-section-title">Personal preferences</h2>
        <div className="form-row">
          <label>Theme<div className="preference-value">Light · clean white workspace</div></label>
          <label>Default subject
            <select value={defaultSubjectId} onChange={event => setDefaultSubjectId(event.target.value)}>
              <option value="">Last used / no preference</option>
              {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="hi">Hindi</option></select></label>
          <label>&nbsp;<span className="settings-toggle"><input type="checkbox" checked={compactView} onChange={event => setCompactView(event.target.checked)} /> Compact view</span></label>
        </div>
        <div className="settings-toggle-list">
          <label><input type="checkbox" checked={notificationsEnabled} onChange={event => setNotificationsEnabled(event.target.checked)} /> In-app notifications</label>
          <label><input type="checkbox" checked={emailNotifications} onChange={event => setEmailNotifications(event.target.checked)} /> Email notifications when configured</label>
          <label><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} /> Reduce motion</label>
        </div>
        <button className="primary-button" disabled={saving} onClick={() => void savePreferences()}>{saving ? 'Saving…' : 'Save personal settings'}</button>
      </section>
      )}
    </div>
  )
}

function AdminSettingsView({ student, showToast }: { student: any; showToast: (text: string, type?: 'success' | 'error') => void }) {
  const [className, setClassName] = useState('Class 5')
  const [academicYear, setAcademicYear] = useState('2026-2027')
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [uploadLimitMb, setUploadLimitMb] = useState(15)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!supabase || !student?.class_id) return
    void (async () => {
      try {
        const [{ data: classRow }, { data: settings }] = await Promise.all([
          supabase.from('classes').select('name').eq('id', student.class_id).single(),
          supabase.from('admin_settings').select('key,value').eq('class_id', student.class_id),
        ])
        if (classRow) setClassName(classRow.name)
        for (const setting of settings || []) {
          if (setting.key === 'academic_year') setAcademicYear(String(setting.value?.value || '2026-2027'))
          if (setting.key === 'maintenance_mode') setMaintenanceMode(Boolean(setting.value?.value))
          if (setting.key === 'approval_required') setApprovalRequired(Boolean(setting.value?.value))
          if (setting.key === 'upload_limit_mb') setUploadLimitMb(Number(setting.value?.value || 15))
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not load admin settings.', 'error')
      } finally {
        setLoading(false)
      }
    })()
  }, [showToast, student?.class_id])

  async function saveSetting(key: string, value: unknown) {
    if (!supabase) return
    const { error } = await supabase.rpc('save_admin_setting', {
      p_key: key,
      p_value: { value },
    })
    if (error) throw error
  }

  async function saveAdminSettings() {
    if (!supabase || !student?.class_id) return
    setSaving(true)
    try {
      const { error: classError } = await supabase.from('classes')
        .update({ name: className.trim() || 'Class 5' })
        .eq('id', student.class_id)
      if (classError) throw classError
      await saveSetting('academic_year', academicYear)
      await saveSetting('maintenance_mode', maintenanceMode)
      await saveSetting('approval_required', approvalRequired)
      await saveSetting('upload_limit_mb', Math.max(1, Math.min(50, uploadLimitMb)))
      await supabase.rpc('log_activity', {
        p_action: 'updated_admin_settings',
        p_entity_type: 'admin_settings',
        p_metadata: { class_name: className.trim(), academic_year: academicYear, maintenance_mode: maintenanceMode, approval_required: approvalRequired, upload_limit_mb: uploadLimitMb },
      })
      showToast('Admin settings saved.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save admin settings.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">OWNER ONLY</p><h1>Admin settings</h1></div></div>
      {loading ? <SettingsSkeleton /> : (
        <section className="settings-card">
          <h2>Platform controls</h2>
          <div className="form-row">
            <label>Class name<input value={className} onChange={event => setClassName(event.target.value)} maxLength={80} /></label>
            <label>Academic year<input value={academicYear} onChange={event => setAcademicYear(event.target.value)} placeholder="2026-2027" /></label>
          </div>
          <div className="form-row">
            <label>Upload limit (MB)<input type="number" min={1} max={50} value={uploadLimitMb} onChange={event => setUploadLimitMb(Number(event.target.value))} /></label>
            <label>&nbsp;<span className="settings-toggle"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.target.checked)} /> Require submission approval</span></label>
          </div>
          <div className="settings-toggle-list">
            <label><input type="checkbox" checked={maintenanceMode} onChange={event => setMaintenanceMode(event.target.checked)} /> Maintenance mode</label>
          </div>
          <div className="settings-note"><ShieldCheck size={17} /><span>These controls are database-backed and restricted to the owner. Maintenance mode currently records state for future enforcement.</span></div>
          <button className="primary-button" disabled={saving} onClick={() => void saveAdminSettings()}>{saving ? 'Saving…' : 'Save admin settings'}</button>
        </section>
      )}
    </div>
  )
}

export default App
