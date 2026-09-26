// Step 1: stage PDFs, upload (which kicks off extraction on the server),
// handle the filename-conflict dialog, and poll project status until the
// run lands. A run that fails puts the project back to 'draft' — surface it.

import { useEffect, useState } from 'react'
import type { Project, SpecDocument } from '../../types'
import { api } from '../../api'
import { ConflictDialog } from '../../components/ConflictDialog'
import { FileDropzone } from '../../components/FileDropzone'
import { StepPill } from '../../components/Stepper'
import { CheckIcon, FileIcon, SpinnerIcon, WarnIcon } from '../../components/icons'

const PROCESSING_LINES = [
  'Reading page text and coordinates…',
  'Classifying which pages carry hardware data…',
  'Locating hardware set boundaries…',
  'Extracting components and mapping columns…',
  'Scoring confidence on every field…',
]

const POLL_MS = 2000

interface Props {
  project: Project
  onExtracted: () => void
}

export function UploadStep({ project, onExtracted }: Props) {
  const [documents, setDocuments] = useState<SpecDocument[]>([])
  const [staged, setStaged] = useState<File[]>([])
  const [conflict, setConflict] = useState<SpecDocument | null>(null)
  const [processing, setProcessing] = useState(project.status === 'processing')
  const [failed, setFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lineIndex, setLineIndex] = useState(0)

  useEffect(() => {
    api.getDocuments(project.id).then(setDocuments)
  }, [project.id])

  useEffect(() => {
    if (!processing) return
    const lines = setInterval(() => setLineIndex((i) => (i + 1) % PROCESSING_LINES.length), 1800)
    const poll = setInterval(async () => {
      const fresh = await api.getProject(project.id)
      if (fresh.status === 'extracted' || fresh.status === 'reviewed') {
        clearInterval(poll)
        clearInterval(lines)
        onExtracted()
      } else if (fresh.status === 'draft') {
        // the run failed server-side and dropped the project back to draft
        clearInterval(poll)
        clearInterval(lines)
        setProcessing(false)
        setFailed(true)
        setDocuments(await api.getDocuments(project.id))
      }
    }, POLL_MS)
    return () => {
      clearInterval(poll)
      clearInterval(lines)
    }
  }, [processing, project.id, onExtracted])

  async function startUpload(strategy?: 'replace' | 'rename') {
    setConflict(null)
    setFailed(false)
    setUploading(true)
    try {
      const result = await api.upload(project.id, staged, strategy)
      if (result.conflict) {
        setConflict(result.existing)
        return
      }
      setStaged([])
      setProcessing(true)
    } finally {
      setUploading(false)
    }
  }

  if (processing) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-20 text-center">
        <SpinnerIcon size={36} className="text-accent" />
        <h2 className="text-2xl font-bold">Extracting hardware sets</h2>
        <p className="text-sm text-muted" aria-live="polite">
          {PROCESSING_LINES[lineIndex]}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <StepPill step={1} total={3} />
        <h1 className="mt-3 text-3xl font-bold">Let's start by uploading your project documents</h1>
        <p className="mt-2 text-muted">Drag and drop your PDF specifications below.</p>
      </div>

      {failed && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3">
          <WarnIcon size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-sm">
            <p className="font-bold text-warn">Extraction didn't finish</p>
            <p className="mt-0.5 text-warn/90">
              The documents were uploaded, but the extraction run failed. Upload again to retry.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8">
        <FileDropzone
          staged={staged}
          onFiles={(files) =>
            setStaged((prev) => [...prev.filter((p) => !files.some((f) => f.name === p.name)), ...files])
          }
        />
      </div>

      {documents.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-muted">Already in this project</h3>
          <ul className="mt-2 space-y-2">
            {documents.map((doc) => (
              <li key={doc.id} className="card flex items-center gap-3 px-4 py-3">
                <FileIcon size={18} className="text-muted" />
                <span className="flex-1 truncate text-sm">{doc.filename}</span>
                {doc.status === 'failed' ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-warn">
                    <WarnIcon size={13} /> failed
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-ok">
                    <CheckIcon size={13} /> uploaded
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          disabled={staged.length === 0 || uploading}
          onClick={() => startUpload()}
          className="btn-primary px-6 py-3"
        >
          {uploading ? 'Uploading…' : 'Upload and extract hardware sets'}
        </button>
      </div>

      {conflict && (
        <ConflictDialog
          existing={conflict}
          onReplace={() => startUpload('replace')}
          onRename={() => startUpload('rename')}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
}
