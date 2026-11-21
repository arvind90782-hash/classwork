import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive, Bell, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, Download, FileText, FolderOpen, Grid2X2, Home, ImagePlus,
  LogOut, Menu, RotateCw, Search, Settings, ShieldCheck, Upload,
  UserRound, Users, X, AlertTriangle
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import imageCompression from 'browser-image-compression'
import { isSupabaseConfigured, supabase } from './lib/supabase'
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
  'All Submissions' | 'My Contributions' | 'Admin Panel' | 'Member Approvals' | 'Settings'

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

const navItems: { label: PageName; icon: typeof Home }[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Daily Work', icon: CalendarDays },
  { label: 'Upload Work', icon: Upload },
  { label: 'Digital Notebook', icon: BookOpen },
  { label: 'All Submissions', icon: FolderOpen },
  { label: 'My Contributions', icon: FileText },
  { label: 'Admin Panel', icon: ShieldCheck },
  { label: 'Member Approvals', icon: Users },
  { label: 'Settings', icon: Settings },
]

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
  const [page, setPage] = useState<PageName>('Dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [selectedDate, setSelectedDate] = useState(todayKolkata())
  const [session, setSession] = useState<any>(null)
  const [authMode, setAuthMode] = useState<'signin' | 'join'>('signin')
  const [authLoading, setAuthLoading] = useState(false)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [student, setStudent] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileRefreshVersion, setProfileRefreshVersion] = useState(0)

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    window.setTimeout(() => setToast(null), 3500)
  }, [])
  const userId = session?.user.id

  const loadData = useCallback(async () => {
    const client = supabase
    if (!client || !userId) return
    setLoading(true)
    try {
      const { data: profile, error: profileError } = await client
        .from('students').select('*').eq('id', userId).maybeSingle()
      if (profileError) throw profileError
      setStudent(profile)
      if (profile?.status === 'approved') {
        const { data, error } = await client.from('tasks')
          .select('id,title,academic_date,status,chapter,exercise,subjects(name)')
          .eq('academic_date', selectedDate)
          .order('created_at', { ascending: false })
        if (error) throw error
        setTasks((data as unknown as TaskRow[]) || [])
      } else {
        setTasks([])
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load your class profile.', 'error')
    } finally {
      setLoading(false)
    }
  }, [userId, selectedDate, showToast])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData, profileRefreshVersion])

  async function signOut() {
    await supabase?.auth.signOut()
    setSession(null)
    setStudent(null)
    setPendingCount(0)
  }

  const navigate = (next: PageName) => {
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

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }
  if (!session) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} loading={authLoading} setLoading={setAuthLoading} showToast={showToast} onJoined={() => setProfileRefreshVersion(value => value + 1)} />
  }
  if (session && !student) {
    return <JoinScreen session={session} onJoined={loadData} showToast={showToast} onLogout={signOut} />
  }
  if (student && student.status === 'pending') {
    return <PendingScreen student={student} onLogout={signOut} />
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
            if ((item.label === 'Admin Panel' || item.label === 'Member Approvals') && !student?.is_owner) return null
            const Icon = item.icon
            return (
              <button key={item.label} className={page === item.label ? 'active' : ''} onClick={() => navigate(item.label)}>
                <Icon size={19} /><span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="profile-avatar">{(student?.display_name || session.user.email || 'S').slice(0, 1).toUpperCase()}</div>
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
          page === 'Dashboard' ? <Dashboard date={selectedDate} tasks={tasks} navigate={navigate} /> :
          page === 'Upload Work' ? <UploadWork student={student} date={selectedDate} showToast={showToast} onComplete={loadData} /> :
          page === 'Digital Notebook' ? <Notebook /> :
          page === 'Daily Work' ? <DailyWork date={selectedDate} tasks={tasks} navigate={navigate} /> :
          page === 'All Submissions' ? <SubmissionsView /> :
          page === 'My Contributions' ? <Contributions student={student} /> :
          page === 'Admin Panel' && student?.is_owner ? <AdminPanel navigate={navigate} pendingCount={pendingCount} /> :
          page === 'Member Approvals' && student?.is_owner ? <MemberApprovals showToast={showToast} /> :
          page === 'Settings' ? <SettingsView student={student} /> :
          <Dashboard date={selectedDate} tasks={tasks} navigate={navigate} />}
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

function SetupScreen() {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="brand-mark large"><BookOpen size={28} /></div>
        <h1>Classwork needs configuration</h1>
        <p>This deployment is missing its public Supabase configuration. Authentication, uploads and PDFs are unavailable until it is set.</p>
        <ol>
          <li>In Vercel, open <strong>Project Settings → Environment Variables</strong>.</li>
          <li>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> for Production.</li>
          <li>Redeploy after saving the variables. For local development, set them in <code>.env.local</code> and restart Vite.</li>
          <li>Confirm the database migration and class setup in the Supabase project.</li>
        </ol>
        <div className="setup-callout"><ShieldCheck size={18} /><span>Use only the Supabase publishable key in frontend variables. Never add a service-role key to Vercel frontend settings.</span></div>
      </div>
    </div>
  )
}

function AuthScreen({ mode, setMode, loading, setLoading, showToast, onJoined }: any) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [roll, setRoll] = useState('')
  const [invite, setInvite] = useState('')

  async function submitAuth(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    if (mode === 'signin') {
      const { error } = await supabase!.auth.signInWithPassword({ email, password })
      if (error) showToast(error.message, 'error')
    } else {
      const { data, error } = await supabase!.auth.signUp({ email, password })
      if (error) { showToast(error.message, 'error'); setLoading(false); return }
      if (data.user && data.session) {
        const { error: joinError } = await supabase!.rpc('join_class', {
          invite_code: invite, student_name: name, student_roll: roll
        })
        if (joinError) showToast(joinError.message, 'error')
        else {
          showToast('Registration submitted for owner approval.')
          onJoined?.()
        }
      } else if (data.user) {
        showToast('Account created. Confirm the email, then sign in and join the class.')
      }
    }
    setLoading(false)
  }

  return (
    <div className="auth-screen">
      <section className="auth-art">
        <div className="auth-brand"><div className="brand-mark"><BookOpen size={22} /></div><strong>Classwork</strong></div>
        <div className="auth-art-copy"><span>CLASS 5 · PRIVATE WORKSPACE</span><h1>Your class notes,<br />carefully organised.</h1><p>A secure digital notebook for daily school work and complete class submissions.</p></div>
      </section>
      <section className="auth-form-section">
        <form className="auth-form" onSubmit={submitAuth}>
          <div className="auth-tabs">
            <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join class</button>
          </div>
          <h2>{mode === 'signin' ? 'Welcome back' : 'Join the private class'}</h2>
          <p>{mode === 'signin' ? 'Sign in to continue to your notebook.' : 'Registration requires owner approval.'}</p>
          {mode === 'join' && <>
            <label>Display name<input value={name} onChange={e => setName(e.target.value)} required placeholder="Your name" /></label>
            <label>Roll number<input value={roll} onChange={e => setRoll(e.target.value)} required placeholder="e.g. 18" /></label>
            <label>Invite code<input value={invite} onChange={e => setInvite(e.target.value)} required placeholder="Enter class invite code" /></label>
          </>}
          <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="At least 6 characters" /></label>
          <button className="primary-button" disabled={loading}>{loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Request access'}</button>
          <small><ShieldCheck size={14} /> Private workspace · Class 5 only</small>
        </form>
      </section>
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

function JoinScreen({ onJoined, showToast, onLogout }: any) {
  const [name, setName] = useState('')
  const [roll, setRoll] = useState('')
  const [invite, setInvite] = useState('')
  const [loading, setLoading] = useState(false)

  async function join(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase!.rpc('join_class', {
      invite_code: invite,
      student_name: name,
      student_roll: roll,
    })
    if (error) showToast(error.message, 'error')
    else {
      showToast('Class registration saved.')
      await onJoined()
    }
    setLoading(false)
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
    <div className="loading-wrap">
      <div className="spinner" /><span>Loading workspace…</span>
    </div>
  )
}

function Dashboard({ date, tasks, navigate }: { date: string; tasks: TaskRow[]; navigate: (page: PageName) => void }) {
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
          <div className="empty-inline"><Archive size={24} /><div><strong>No published PDFs</strong><span>Published notebooks will appear here.</span></div></div>
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
            <button className="task-row" key={task.id} onClick={() => navigate('Digital Notebook')}>
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
  const [subject, setSubject] = useState(subjects[0].name)
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

  useEffect(() => () => {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

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
        const { data: subjectRow, error: subjectError } = await supabase
          .from('subjects')
          .select('id')
          .eq('class_id', student.class_id)
          .eq('name', subject)
          .maybeSingle()
        if (subjectError) throw subjectError
        if (!subjectRow) throw new Error('The subject could not be found. Ask the owner to complete class setup.')
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
          setTaskTitle(`${subject} notebook pages`)
          setPageDetails('Index followed by completed pages')
        }} disabled={Boolean(batch)}>
          <BookOpen size={16} /> Whole copy
        </button>
      </div>
      <div className="upload-layout">
        <section className="form-card">
          <h2>1. Label this upload</h2>
          <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)} disabled={Boolean(batch)}>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
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
              <Upload size={27} /><strong>Take a page photo</strong><span>Add one clear page at a time</span>
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
      <div className="submit-bar"><span>{files.length ? `${files.length} pages ${batch ? 'in this upload' : 'ready'}` : 'Add at least one notebook page'}{batch ? ' · keep this page open until all pages finish' : ''}</span><button className="primary-button" disabled={!taskTitle.trim() || !confirmed || !files.length || submitting} onClick={submit}>{submitting ? 'Uploading…' : batch ? 'Retry remaining pages' : 'Upload all pages'}</button></div>
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
      {!tasks.length && <div className="empty-state"><CalendarDays size={34} /><h3>No submissions for this date</h3><p>Select a different date or upload work.</p></div>}
    </div>
  )
}

function Notebook() {
  const [subject, setSubject] = useState(subjects[0].name)
  async function downloadSubjectPdf() {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    pdf.setProperties({ title: `Class 5 ${subject} Notebook` })
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(24)
    pdf.text('Class 5 Digital Notebook', 105, 30, { align: 'center' })
    pdf.setFontSize(16); pdf.text(subject, 105, 42, { align: 'center' })
    pdf.setDrawColor(200); pdf.line(20, 50, 190, 50)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11)
    pdf.text('No selected notebook pages are available for publication.', 20, 65)
    pdf.save(`class-5-${subject.replaceAll(' / ', '-').toLowerCase()}-notebook.pdf`)
  }

  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">DIGITAL NOTEBOOK</p><h1>Curated pages</h1></div><button className="secondary-button" onClick={downloadSubjectPdf}><Download size={16} /> Download subject PDF</button></div>
      <div className="notebook-toolbar">
        <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
        <div className="search-box"><Search size={16} /><input placeholder="Search task title" /></div>
      </div>
      <div className="notebook-layout">
        <aside className="notebook-index">
          <strong>Notebook index</strong>
          {subjects.map(s => <button key={s.name} className={subject === s.name ? 'active' : ''} onClick={() => setSubject(s.name)}><span style={{ background: s.color }}>{s.short}</span>{s.name}</button>)}
        </aside>
        <div className="notebook-empty">
          <div className="empty-page"><BookOpen size={38} /></div>
          <h3>No selected pages yet</h3>
          <p>The owner can review submissions and select one page for each numbered notebook slot.</p>
        </div>
      </div>
    </div>
  )
}

function SubmissionsView() {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">WORK ARCHIVE</p><h1>All submissions</h1></div></div>
      <div className="filter-bar">
        <div className="search-box large"><Search size={16} /><input placeholder="Search title, chapter or contributor" /></div>
        <select aria-label="Filter subject"><option>All subjects</option>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select>
        <input type="date" aria-label="Filter date" />
      </div>
      <div className="empty-state"><FolderOpen size={34} /><h3>No submissions match this view</h3><p>Submitted work will appear here after the database is configured and work is uploaded.</p></div>
    </div>
  )
}

function Contributions({ student }: any) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">CONTRIBUTOR HISTORY</p><h1>My contributions</h1></div></div>
      <div className="empty-state"><UserRound size={34} /><h3>No contributions yet</h3><p>Uploads made by {student?.display_name || 'you'} will appear here.</p></div>
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
        <div className="admin-card admin-card-disabled" aria-disabled="true">
          <div className="admin-icon"><Grid2X2 size={21} /></div>
          <div><strong>Manage subjects</strong><span>Not available yet</span></div>
        </div>
        <div className="admin-card admin-card-disabled" aria-disabled="true">
          <div className="admin-icon"><FolderOpen size={21} /></div>
          <div><strong>Task & submission review</strong><span>Not available yet</span></div>
        </div>
        <div className="admin-card admin-card-disabled" aria-disabled="true">
          <div className="admin-icon"><FileText size={21} /></div>
          <div><strong>PDF publishing</strong><span>Not available yet</span></div>
        </div>
        <div className="admin-card admin-card-disabled" aria-disabled="true">
          <div className="admin-icon"><AlertTriangle size={21} /></div>
          <div><strong>Reports</strong><span>Not available yet</span></div>
        </div>
        <div className="admin-card admin-card-disabled" aria-disabled="true">
          <div className="admin-icon"><Clock3 size={21} /></div>
          <div><strong>Audit history</strong><span>Not available yet</span></div>
        </div>
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
      const { data, error } = await client.from('students')
        .update({ status })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (error) {
        showToast(error.message, 'error')
      } else if (!data) {
        showToast('This request was already handled. Refreshing the list.', 'error')
      } else {
        showToast(status === 'approved' ? `${request.display_name} approved.` : `${request.display_name} declined.`)
      }
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

function SettingsView({ student }: any) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h1>Settings</h1></div></div>
      <section className="settings-card">
        <h2>Student identity</h2>
        <div className="form-row">
          <label>Display name<input value={student?.display_name || ''} readOnly /></label>
          <label>Roll number<input value={student?.roll_number || ''} readOnly /></label>
        </div>
        <div className="settings-note"><ShieldCheck size={17} /><span>Name and roll number can only be changed by the class owner.</span></div>
      </section>
    </div>
  )
}

export default App
