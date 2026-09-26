// Wizard shell: loads the project, hosts the steps, and renders the bottom
// stepper bar. Finished (reviewed) projects skip the Upload step and lose the
// footer actions; editing a finished project drops it to 'edited', which
// brings Finish back and guards every exit with a mark-as-completed reminder.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Project, SpecDocument } from '../types'
import { api } from '../api'
import { DocumentsBrowser } from '../components/DocumentsBrowser'
import { AlertDialog } from '../components/Modal'
import { Stepper } from '../components/Stepper'
import type { Step } from '../components/Stepper'
import { ChevronLeftIcon, ClipboardIcon, FileIcon, HammerIcon, TrophyIcon, UploadIcon, WarnIcon } from '../components/icons'
import { plural } from '../review'
import { HardwareStep } from './steps/HardwareStep'
import { ReviewStep } from './steps/ReviewStep'
import { UploadStep } from './steps/UploadStep'

type StepKey = 'upload' | 'hardware' | 'review'

const STEP_DEFS: Record<StepKey, Step> = {
  upload: { key: 'upload', label: 'Upload', icon: <UploadIcon size={20} /> },
  hardware: { key: 'hardware', label: 'Hardware', icon: <HammerIcon size={20} /> },
  review: { key: 'review', label: 'Review', icon: <TrophyIcon size={20} /> },
}

export function ProjectWizard() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [documents, setDocuments] = useState<SpecDocument[]>([])
  const [stepKey, setStepKey] = useState<StepKey>('upload')
  const [missing, setMissing] = useState(false)
  const [browsingDocs, setBrowsingDocs] = useState(false)
  const [flaggedCount, setFlaggedCount] = useState(0)
  const [reviewFocusNonce, setReviewFocusNonce] = useState(0)
  const [showFinishReminder, setShowFinishReminder] = useState(false)
  const [showExitReminder, setShowExitReminder] = useState(false)
  const [focusSetId, setFocusSetId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const fresh = await api.getProject(id)
      setProject(fresh)
      setDocuments(await api.getDocuments(id))
      return fresh
    } catch {
      setMissing(true)
    }
  }, [id])

  useEffect(() => {
    load().then((p) => {
      if (!p) return
      if (p.status === 'reviewed') setStepKey('review')
      else if (p.status === 'extracted' || p.status === 'edited') setStepKey('hardware')
    })
  }, [load])

  const refreshProject = useCallback(async () => {
    if (!id) return
    setProject(await api.getProject(id))
  }, [id])

  const finished = project?.status === 'reviewed'
  const edited = project?.status === 'edited'
  const extracted = project !== null && (project.status === 'extracted' || finished || edited)

  // Finished (and edited-after-finish) projects have no Upload step.
  const stepKeys: StepKey[] = finished || edited ? ['hardware', 'review'] : ['upload', 'hardware', 'review']
  const steps = stepKeys.map((k) => STEP_DEFS[k])
  const stepIndex = Math.max(0, stepKeys.indexOf(stepKey))
  const maxReachable = extracted ? steps.length - 1 : 0

  /** Leaving with unfinished edits gets a reminder to mark as completed. */
  function guardedExit() {
    if (edited) setShowExitReminder(true)
    else navigate('/')
  }

  async function finishReview() {
    if (!project) return
    const updated = await api.markReviewed(project.id)
    setProject(updated)
    setStepKey('review')
  }

  if (missing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <ClipboardIcon size={28} className="text-muted" />
        <p className="text-muted">This project doesn't exist anymore.</p>
        <Link to="/" className="link-accent font-semibold">
          Back to projects
        </Link>
      </div>
    )
  }

  if (!project) return <p className="py-24 text-center text-muted">Loading project…</p>

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 px-6 py-4">
        <button
          type="button"
          onClick={guardedExit}
          className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
        >
          <ChevronLeftIcon size={15} /> Projects
        </button>
        <span className="text-line">/</span>
        <h1 className="text-sm font-semibold">{project.name}</h1>
        {finished && <span className="pill-ok">Finished</span>}
        {edited && <span className="pill-warn">Edits pending</span>}
        {documents.length > 0 && (
          <button
            type="button"
            onClick={() => setBrowsingDocs(true)}
            className="btn-outline ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted"
          >
            <FileIcon size={14} />
            {plural(documents.length, 'document')}
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 pb-6">
        {stepKey === 'upload' && !finished && !edited && (
          <UploadStep
            project={project}
            onExtracted={async () => {
              await load()
              setStepKey('hardware')
            }}
          />
        )}
        {stepKey === 'hardware' && (
          <HardwareStep
            project={project}
            reviewFocusNonce={reviewFocusNonce}
            focusSetId={focusSetId}
            onFlaggedCount={setFlaggedCount}
            onEdited={refreshProject}
          />
        )}
        {stepKey === 'review' && (
          <ReviewStep
            project={project}
            onFixRemaining={() => setStepKey('hardware')}
            onOpenSet={(setId) => {
              setFocusSetId(setId)
              setStepKey('hardware')
            }}
          />
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center">
          <button
            type="button"
            onClick={() => (stepIndex === 0 ? guardedExit() : setStepKey(stepKeys[stepIndex - 1]))}
            className="flex items-center gap-1 justify-self-start text-sm font-medium text-muted hover:text-ink"
          >
            <ChevronLeftIcon size={15} /> Back
          </button>
          <Stepper
            steps={steps}
            currentIndex={stepIndex}
            completedThrough={extracted ? stepIndex : 0}
            maxReachable={maxReachable}
            onSelect={(i) => setStepKey(stepKeys[i])}
          />
          {stepKey === 'hardware' && !finished ? (
            <div className="flex items-center gap-2 justify-self-end">
              <button
                type="button"
                onClick={guardedExit}
                title="Everything is saved as you go — come back to finish corrections anytime"
                className="btn-outline text-muted"
              >
                Save for now
              </button>
              <button
                type="button"
                onClick={() => (flaggedCount > 0 ? setShowFinishReminder(true) : finishReview())}
                className="btn-primary px-5"
              >
                {edited ? 'Mark as completed' : 'Finish'}
              </button>
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </footer>

      {browsingDocs && <DocumentsBrowser documents={documents} onClose={() => setBrowsingDocs(false)} />}

      {showFinishReminder && (
        <AlertDialog
          icon={<WarnIcon size={18} />}
          title={`${plural(flaggedCount, 'field')} still need${flaggedCount === 1 ? 's' : ''} review`}
          body="The highlighted fields have extraction confidence under 80. You can fix them now, or finish and come back later — your progress is saved either way."
          onClose={() => setShowFinishReminder(false)}
          actions={[
            {
              label: "Show me what's left",
              onClick: () => {
                setShowFinishReminder(false)
                setReviewFocusNonce((n) => n + 1)
              },
              variant: 'primary',
            },
            {
              label: 'Finish anyway — fix later',
              onClick: () => {
                setShowFinishReminder(false)
                finishReview()
              },
            },
          ]}
        />
      )}

      {showExitReminder && (
        <AlertDialog
          icon={<WarnIcon size={18} />}
          title="You made edits — mark the project as completed?"
          body={'Your changes are saved, but the project is still marked "Edits pending" until it\'s completed.'}
          onClose={() => setShowExitReminder(false)}
          actions={[
            {
              label: 'Mark as completed and exit',
              onClick: async () => {
                setShowExitReminder(false)
                await finishReview()
                navigate('/')
              },
              variant: 'primary',
            },
            {
              label: 'Exit without completing',
              onClick: () => {
                setShowExitReminder(false)
                navigate('/')
              },
            },
            { label: 'Stay', onClick: () => setShowExitReminder(false), variant: 'ghost' },
          ]}
        />
      )}
    </div>
  )
}
