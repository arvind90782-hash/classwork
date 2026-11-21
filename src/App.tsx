import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive, Bell, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, Download, FileText, FolderOpen, Grid2X2, Home, ImagePlus,
  LogOut, Menu, Search, Settings, ShieldCheck, Upload,
  UserRound, Users, X, AlertTriangle
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import imageCompression from 'browser-image-compression'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

const subjects = [
  { name: 'English', short: 'EN', color: '#3867d6' },
  { name: 'EVS / TWAU', short: 'EV', color: '#4b9b82' },
  { name: 'Hindi', short: 'HI', color: '#c68137' },
  { name: 'Mathematics', short: 'MA', color: '#6d66bd' },
  { name: 'Computer', short: 'CO', color: '#368da0' },
  { name: 'Music', short: 'MU', color: '#ad6279' },
]

type PageName = 'Dashboard' | 'Daily Work' | 'Upload Work' | 'Digital Notebook' |
  'All Submissions' | 'My Contributions' | 'Admin Panel' | 'Settings'

type TaskRow = {
  id: string
  title: string
  academic_date: string
  status: string
  subjects?: { name: string }
  chapter?: string | null
  exercise?: string | null
}

const navItems: { label: PageName; icon: typeof Home }[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Daily Work', icon: CalendarDays },
  { label: 'Upload Work', icon: Upload },
  { label: 'Digital Notebook', icon: BookOpen },
  { label: 'All Submissions', icon: FolderOpen },
  { label: 'My Contributions', icon: FileText },
  { label: 'Admin Panel', icon: ShieldCheck },
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

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session) return
    loadData()
  }, [session, selectedDate])

  async function loadData() {
    setLoading(true)
    const { data: profile } = await supabase!.from('students').select('*').eq('id', session!.user.id).maybeSingle()
    setStudent(profile)
    if (profile?.status === 'approved') {
      const { data } = await supabase!.from('tasks')
        .select('id,title,academic_date,status,chapter,exercise,subjects(name)')
        .eq('academic_date', selectedDate)
        .order('created_at', { ascending: false })
      setTasks((data as unknown as TaskRow[]) || [])
    }
    setLoading(false)
  }

  function showToast(text: string, type: 'success' | 'error' = 'success') {
    setToast({ text, type })
    window.setTimeout(() => setToast(null), 3500)
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setSession(null)
  }

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }
  if (!session) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} loading={authLoading} setLoading={setAuthLoading} showToast={showToast} />
  }
  if (session && !student) {
    return <JoinScreen session={session} onJoined={loadData} showToast={showToast} onLogout={signOut} />
  }
  if (student && student.status === 'pending') {
    return <PendingScreen student={student} onLogout={signOut} />
  }

  const navigate = (next: PageName) => {
    setPage(next)
    setMobileMenu(false)
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
            if (item.label === 'Admin Panel' && !student?.is_owner) return null
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
          <button className="icon-button notification" aria-label="Notifications"><Bell size={19} /><i /></button>
        </header>

        {loading ? <Loading /> :
          page === 'Dashboard' ? <Dashboard date={selectedDate} tasks={tasks} navigate={navigate} /> :
          page === 'Upload Work' ? <UploadWork student={student} date={selectedDate} showToast={showToast} /> :
          page === 'Digital Notebook' ? <Notebook /> :
          page === 'Daily Work' ? <DailyWork date={selectedDate} tasks={tasks} /> :
          page === 'All Submissions' ? <SubmissionsView /> :
          page === 'My Contributions' ? <Contributions student={student} /> :
          page === 'Admin Panel' && student?.is_owner ? <AdminPanel /> :
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
        <p>Connect this workspace to Supabase before authentication, uploads or PDFs can operate.</p>
        <ol>
          <li>Create a Supabase project.</li>
          <li>Run <code>supabase/migrations/001_classwork.sql</code> in the SQL editor.</li>
          <li>Create <code>.env.local</code> using <code>.env.example</code>.</li>
          <li>Restart the Vite server and create the owner account.</li>
        </ol>
        <div className="setup-callout"><ShieldCheck size={18} /><span>The owner must be set explicitly in <code>students.is_owner</code>. Never expose a service-role key.</span></div>
      </div>
    </div>
  )
}

function AuthScreen({ mode, setMode, loading, setLoading, showToast }: any) {
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
        else showToast('Registration submitted for owner approval.')
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
        <p>Hi {student.display_name}. Your joining request is waiting for the platform owner to approve your account.</p>
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

function UploadWork({ student, date, showToast }: any) {
  const [subject, setSubject] = useState(subjects[0].name)
  const [taskTitle, setTaskTitle] = useState('')
  const [chapter, setChapter] = useState('')
  const [exercise, setExercise] = useState('')
  const [pageDetails, setPageDetails] = useState('')
  const [instructions, setInstructions] = useState('')
  const [files, setFiles] = useState<{ file: File; url: string }[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [workDate, setWorkDate] = useState(date)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => files.forEach(file => URL.revokeObjectURL(file.url)), [])

  function onFiles(selected: FileList | null) {
    if (!selected) return
    const accepted = Array.from(selected).filter(file =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 15 * 1024 * 1024
    )
    setFiles(current => [...current, ...accepted.map(file => ({ file, url: URL.createObjectURL(file) }))])
  }

  async function submit() {
    if (!taskTitle.trim() || !confirmed || !files.length) return
    setSubmitting(true)
    try {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data: subjectRow, error: subjectError } = await supabase
        .from('subjects')
        .select('id')
        .eq('class_id', student.class_id)
        .eq('name', subject)
        .maybeSingle()
      if (subjectError || !subjectRow) throw new Error('The subject could not be found. Ask the owner to complete class setup.')
      const { data: task, error: taskError } = await supabase.from('tasks').insert({
        class_id: student.class_id, subject_id: subjectRow.id, academic_date: workDate, title: taskTitle.trim(),
        chapter: chapter || null, exercise: exercise || null, page_details: pageDetails || null,
        instructions: instructions || null, created_by: student.id
      }).select('id').single()
      if (taskError) throw taskError
      const { data: submission, error: submissionError } = await supabase.from('submissions').insert({
        task_id: task.id, contributor_id: student.id
      }).select('id').single()
      if (submissionError) throw submissionError
      for (let index = 0; index < files.length; index++) {
        let compressed = files[index].file
        if (compressed.size > 1.5 * 1024 * 1024) {
          compressed = await imageCompression(compressed, { maxSizeMB: 1.5, maxWidthOrHeight: 2600, useWebWorker: true })
        }
        const path = `${student.class_id}/${task.id}/${submission.id}/${index + 1}-${crypto.randomUUID()}.jpg`
        const { error: uploadError } = await supabase.storage.from('classwork-pages').upload(path, compressed, {
          contentType: compressed.type, upsert: false
        })
        if (uploadError) throw uploadError
        const { error: pageError } = await supabase.from('submission_pages').insert({
          submission_id: submission.id, page_number: index + 1, storage_path: path,
          mime_type: compressed.type, file_size: compressed.size
        })
        if (pageError) throw pageError
      }
      showToast('Submission uploaded successfully.')
      setFiles([]); setTaskTitle(''); setChapter(''); setExercise(''); setPageDetails(''); setInstructions(''); setConfirmed(false)
    } catch (error: any) {
      showToast(error.message || 'Upload failed. Your form is still preserved.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function moveFile(index: number, amount: number) {
    setFiles(current => {
      const next = [...current]
      const target = index + amount
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <div className="page upload-page">
      <div className="page-heading"><div><p className="eyebrow">NEW SUBMISSION</p><h1>Upload work</h1></div></div>
      <div className="upload-layout">
        <section className="form-card">
          <h2>1. Work details</h2>
          <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{subjects.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
          <div className="form-row">
            <label>Academic date<input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} /></label>
            <label>Task title <span>*</span><input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="e.g. Fractions exercise" /></label>
          </div>
          <div className="form-row">
            <label>Chapter / exercise<input value={chapter} onChange={e => setChapter(e.target.value)} placeholder="Chapter name" /></label>
            <label>Exercise / page<input value={exercise} onChange={e => setExercise(e.target.value)} placeholder="Ex. 4.2" /></label>
          </div>
          <label>Question numbers & page details<input value={pageDetails} onChange={e => setPageDetails(e.target.value)} placeholder="Q. 1–10, pages 42–43" /></label>
          <label>Teacher instructions <span>(optional)</span><textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Any instructions for this task" /></label>
        </section>
        <section className="form-card">
          <div className="form-card-title"><h2>2. Notebook pages</h2><span>{files.length} {files.length === 1 ? 'page' : 'pages'}</span></div>
          <button className="upload-dropzone" onClick={() => inputRef.current?.click()} type="button">
            <ImagePlus size={30} /><strong>Capture or select pages</strong><span>JPEG, PNG or WebP · up to 15 MB each</span>
          </button>
          <input ref={inputRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={e => onFiles(e.target.files)} />
          {files.length > 0 && (
            <div className="page-preview-list">
              {files.map((file, index) => (
                <div className="page-preview" key={file.url}>
                  <img src={file.url} alt={`Notebook page ${index + 1}`} />
                  <div className="page-preview-meta"><strong>Page {index + 1}</strong><div>
                    <button type="button" disabled={index === 0} onClick={() => moveFile(index, -1)} aria-label="Move left"><ChevronLeft size={15} /></button>
                    <button type="button" disabled={index === files.length - 1} onClick={() => moveFile(index, 1)} aria-label="Move right"><ChevronRight size={15} /></button>
                    <button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))} aria-label="Remove page"><X size={15} /></button>
                  </div></div>
                </div>
              ))}
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
      <div className="submit-bar"><span>{files.length ? `${files.length} pages ready` : 'Add at least one notebook page'}</span><button className="primary-button" disabled={!taskTitle.trim() || !confirmed || !files.length || submitting} onClick={submit}>{submitting ? 'Uploading…' : 'Submit work'}</button></div>
    </div>
  )
}

function DailyWork({ date, tasks }: { date: string; tasks: TaskRow[] }) {
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
            {subjectTasks.map(task => <div className="task-card" key={task.id}><div><strong>{task.title}</strong><span>{task.chapter || 'No chapter'} · {task.status.replaceAll('_', ' ')}</span></div><button className="icon-button"><ChevronRight size={18} /></button></div>)}
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

function AdminPanel() {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">OWNER ONLY</p><h1>Admin panel</h1></div></div>
      <div className="admin-grid">
        {[
          ['Student approvals', Users, '0 pending'],
          ['Manage subjects', Grid2X2, '6 subjects'],
          ['Task & submission review', FolderOpen, 'Needs review'],
          ['PDF publishing', FileText, 'Versioned archive'],
          ['Reports', AlertTriangle, '0 open'],
          ['Audit history', Clock3, 'Owner activity'],
        ].map(([title, Icon, subtitle]: any) => (
          <button className="admin-card" key={title}><div className="admin-icon"><Icon size={21} /></div><div><strong>{title}</strong><span>{subtitle}</span></div><ChevronRight size={18} /></button>
        ))}
      </div>
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
