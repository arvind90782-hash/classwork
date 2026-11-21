import { jsPDF } from 'jspdf'
import { supabase } from './supabase'

export type WorkTask = {
  id: string
  title: string
  academic_date: string
  status: string
  chapter: string | null
  exercise: string | null
  subject_id: string
  subjects: { name: string } | null
}

export type WorkPage = {
  id: string
  page_number: number
  storage_path: string
  mime_type: string
  rotation: number
  signed_url: string
}

export type WorkSubmission = {
  id: string
  task_id: string
  contributor_id: string
  uploaded_at: string
  notes: string | null
  is_hidden: boolean
  task: WorkTask | null
  contributor: { id: string; display_name: string; roll_number: string } | null
  pages: WorkPage[]
}

export type CuratedPage = {
  task_id: string
  page_number: number
  submission_page_id: string
  task: WorkTask
  page: WorkPage
}

export type PdfArchive = {
  id: string
  pdf_type: string
  academic_date: string | null
  subject_id: string | null
  storage_path: string
  version: number
  published_at: string
  subject_name: string | null
  signed_url: string
}

export type ClassDocumentPage = {
  id: string
  document_id: string
  page_number: number
  storage_path: string
  mime_type: string
  rotation: number
  signed_url: string
}

export type ClassDocument = {
  id: string
  class_id: string
  category: string
  title: string
  notes: string | null
  created_at: string
  uploaded_by: string
  uploader_name: string | null
  pages: ClassDocumentPage[]
}

export async function fetchWorkSubmissions(contributorId?: string): Promise<WorkSubmission[]> {
  const client = supabase
  if (!client) throw new Error('Supabase is not configured.')

  let query = client.from('submissions')
    .select('id,task_id,contributor_id,uploaded_at,notes,is_hidden,submission_pages(id,page_number,storage_path,mime_type,rotation)')
    .order('uploaded_at', { ascending: false })
  if (contributorId) query = query.eq('contributor_id', contributorId)
  const { data: rows, error } = await query
  if (error) throw error
  if (!rows?.length) return []

  const taskIds = [...new Set(rows.map(row => row.task_id))]
  const contributorIds = [...new Set(rows.map(row => row.contributor_id))]
  const { data: taskRows, error: taskError } = await client.from('tasks')
    .select('id,title,academic_date,status,chapter,exercise,subject_id,subjects(name)')
    .in('id', taskIds)
  if (taskError) throw taskError
  const { data: contributors, error: contributorError } = await client.from('students')
    .select('id,display_name,roll_number')
    .in('id', contributorIds)
  if (contributorError) throw contributorError

  const pages = rows.flatMap(row => row.submission_pages || [])
  const paths = [...new Set(pages.map(page => page.storage_path))]
  const signedByPath = new Map<string, string>()
  if (paths.length) {
    const { data: signedPages, error: signedError } = await client.storage
      .from('classwork-pages').createSignedUrls(paths, 3600)
    if (signedError) throw signedError
    for (const signedPage of signedPages || []) {
      if (signedPage.error || !signedPage.path || !signedPage.signedUrl) {
        throw new Error(signedPage.error || 'Could not create a secure link for an uploaded page.')
      }
      if (signedPage.path && signedPage.signedUrl) signedByPath.set(signedPage.path, signedPage.signedUrl)
    }
    if (signedByPath.size !== paths.length) throw new Error('Could not create secure links for all uploaded pages.')
  }

  const taskById = new Map<string, WorkTask>()
  for (const task of taskRows || []) {
    const subject = Array.isArray(task.subjects) ? task.subjects[0] : task.subjects
    taskById.set(task.id, {
      ...task,
      subjects: subject ? { name: subject.name } : null,
    })
  }
  const contributorById = new Map((contributors || []).map(contributor => [contributor.id, contributor]))
  return rows.map(row => ({
    ...row,
    task: taskById.get(row.task_id) || null,
    contributor: contributorById.get(row.contributor_id) || null,
    pages: (row.submission_pages || []).flatMap(page => {
      const signedUrl = signedByPath.get(page.storage_path)
      return signedUrl ? [{ ...page, signed_url: signedUrl }] : []
    }),
  }))
}

export async function fetchClassDocuments(classId: string): Promise<ClassDocument[]> {
  const client = supabase
  if (!client) throw new Error('Supabase is not configured.')
  const { data: documents, error } = await client.from('class_documents')
    .select('id,class_id,category,title,notes,created_at,uploaded_by')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!documents?.length) return []

  const documentIds = documents.map(document => document.id)
  const { data: pages, error: pagesError } = await client.from('class_document_pages')
    .select('id,document_id,page_number,storage_path,mime_type,rotation')
    .in('document_id', documentIds)
    .order('page_number')
  if (pagesError) throw pagesError

  const storedPages = pages || []
  const paths = [...new Set(storedPages.map(page => page.storage_path))]
  const signedByPath = new Map<string, string>()
  if (paths.length) {
    const { data: signedFiles, error: signedError } = await client.storage
      .from('classwork-documents').createSignedUrls(paths, 3600)
    if (signedError) throw signedError
    for (const file of signedFiles || []) {
      if (file.error || !file.path || !file.signedUrl) {
        throw new Error(file.error || 'Could not create a secure link for a class page.')
      }
      signedByPath.set(file.path, file.signedUrl)
    }
    if (signedByPath.size !== paths.length) throw new Error('Could not create secure links for all class pages.')
  }

  const uploaderIds = [...new Set(documents.map(document => document.uploaded_by))]
  const { data: uploaders, error: uploadersError } = await client.from('students')
    .select('id,display_name')
    .in('id', uploaderIds)
  if (uploadersError) throw uploadersError
  const nameById = new Map((uploaders || []).map(uploader => [uploader.id, uploader.display_name]))
  const pagesByDocument = new Map<string, ClassDocumentPage[]>()
  for (const page of storedPages) {
    const signedUrl = signedByPath.get(page.storage_path)
    if (!signedUrl) throw new Error(`Could not create a secure link for page ${page.page_number}.`)
    const documentPages = pagesByDocument.get(page.document_id) || []
    documentPages.push({ ...page, signed_url: signedUrl })
    pagesByDocument.set(page.document_id, documentPages)
  }

  return documents.flatMap(document => {
    const documentPages = pagesByDocument.get(document.id) || []
    if (!documentPages.length) return []
    return [{
      ...document,
      uploader_name: nameById.get(document.uploaded_by) || null,
      pages: documentPages,
    }]
  })
}

export async function fetchCuratedPages(): Promise<CuratedPage[]> {
  const client = supabase
  if (!client) throw new Error('Supabase is not configured.')
  const { data: selections, error } = await client.from('notebook_page_selections')
    .select('task_id,page_number,submission_page_id')
    .eq('status', 'finalised')
    .not('submission_page_id', 'is', null)
    .order('task_id')
    .order('page_number')
  if (error) throw error
  if (!selections?.length) return []

  const submissions = await fetchWorkSubmissions()
  const pageById = new Map<string, { task: WorkTask; page: WorkPage }>()
  for (const submission of submissions) {
    if (!submission.task) continue
    for (const page of submission.pages) {
      pageById.set(page.id, { task: submission.task, page })
    }
  }

  return selections.flatMap(selection => {
    if (!selection.submission_page_id) return []
    const selected = pageById.get(selection.submission_page_id)
    return selected ? [{
      task_id: selection.task_id,
      page_number: selection.page_number,
      submission_page_id: selection.submission_page_id,
      ...selected,
    }] : []
  })
}

export async function fetchPdfArchives(classId: string, limit = 30): Promise<PdfArchive[]> {
  const client = supabase
  if (!client) throw new Error('Supabase is not configured.')
  const { data: archives, error } = await client.from('daily_pdf_archives')
    .select('id,pdf_type,academic_date,subject_id,storage_path,version,published_at')
    .eq('class_id', classId)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  if (!archives?.length) return []

  const subjectIds = [...new Set(archives.flatMap(archive => archive.subject_id ? [archive.subject_id] : []))]
  const subjectById = new Map<string, string>()
  if (subjectIds.length) {
    const { data: subjectRows, error: subjectError } = await client.from('subjects')
      .select('id,name')
      .in('id', subjectIds)
    if (subjectError) throw subjectError
    for (const subject of subjectRows || []) subjectById.set(subject.id, subject.name)
  }
  const { data: signedFiles, error: signedError } = await client.storage
    .from('classwork-pdfs')
    .createSignedUrls(archives.map(archive => archive.storage_path), 3600)
  if (signedError) throw signedError
  const signedByPath = new Map<string, string>()
  for (const file of signedFiles || []) {
    if (file.error || !file.path || !file.signedUrl) {
      throw new Error(file.error || 'Could not create a secure link for a published PDF.')
    }
    if (file.path && file.signedUrl) signedByPath.set(file.path, file.signedUrl)
  }
  if (signedByPath.size !== archives.length) throw new Error('Could not create secure links for all published PDFs.')

  return archives.flatMap(archive => {
    const signedUrl = signedByPath.get(archive.storage_path)
    if (!signedUrl) return []
    return [{
      ...archive,
      subject_name: archive.subject_id ? subjectById.get(archive.subject_id) || null : null,
      signed_url: signedUrl,
    }]
  })
}

export async function downloadPagesPdf(title: string, pages: Array<{ label: string; signedUrl: string; rotation: number }>, filename: string) {
  const pdf = await buildPagesPdf(title, pages)
  pdf.save(filename)
}

export async function createPagesPdfBlob(title: string, pages: Array<{ label: string; signedUrl: string; rotation: number }>): Promise<Blob> {
  const pdf = await buildPagesPdf(title, pages)
  return pdf.output('blob')
}

async function buildPagesPdf(title: string, pages: Array<{ label: string; signedUrl: string; rotation: number }>) {
  if (!pages.length) throw new Error('There are no notebook pages to download.')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  pdf.setProperties({ title })

  for (const [index, page] of pages.entries()) {
    if (index > 0) pdf.addPage()
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text(`${title} · ${page.label}`, 20, 18)
    const imageData = await imageUrlToJpeg(page.signedUrl, page.rotation)
    const dimensions = pdf.getImageProperties(imageData)
    const scale = Math.min(170 / dimensions.width, 250 / dimensions.height)
    const width = dimensions.width * scale
    const height = dimensions.height * scale
    pdf.addImage(imageData, 'JPEG', (210 - width) / 2, 25 + (250 - height) / 2, width, height)
  }
  return pdf
}

async function imageUrlToJpeg(url: string, rotation: number): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load a notebook page (${response.status}).`)
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const normalizedRotation = ((rotation % 360) + 360) % 360
    const swapsDimensions = normalizedRotation === 90 || normalizedRotation === 270
    const canvas = document.createElement('canvas')
    canvas.width = swapsDimensions ? image.naturalHeight : image.naturalWidth
    canvas.height = swapsDimensions ? image.naturalWidth : image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare a notebook page for PDF export.')
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(normalizedRotation * Math.PI / 180)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    return canvas.toDataURL('image/jpeg', 0.92)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
