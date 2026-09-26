// Step 3: the completion page — celebratory summary with big stats and
// export links, plus the "View project" gallery over every set. Exports are
// generated server-side; the buttons are plain download links.

import { useEffect, useMemo, useState } from 'react'
import type { HardwareSet, Project } from '../../types'
import { api } from '../../api'
import { SetsGallery } from '../../components/SetsGallery'
import { StepPill } from '../../components/Stepper'
import { DownloadIcon, FileIcon } from '../../components/icons'
import { collectFlagged, plural } from '../../review'

interface Props {
  project: Project
  onFixRemaining: () => void
  onOpenSet: (setId: string) => void
}

export function ReviewStep({ project, onFixRemaining, onOpenSet }: Props) {
  const [sets, setSets] = useState<HardwareSet[]>([])
  const [tab, setTab] = useState<'summary' | 'project'>('summary')

  useEffect(() => {
    api.getSets(project.id).then(setSets)
  }, [project.id])

  const extracted = sets.filter((s) => !s.missing)
  const componentCount = extracted.reduce((n, s) => n + s.components.length, 0)
  const doorCount = useMemo(() => new Set(sets.flatMap((s) => s.doors.value ?? [])).size, [sets])
  const flaggedCount = useMemo(() => collectFlagged(sets).length, [sets])
  const missingCount = sets.length - extracted.length

  const stats = [
    { value: doorCount, label: 'Doors' },
    { value: extracted.length, label: 'Hardware Sets' },
    { value: componentCount, label: 'Components' },
  ]

  const tabs = (
    <div className="inline-flex rounded-full border border-line bg-white p-1">
      {(
        [
          ['summary', 'Summary'],
          ['project', 'View project'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
            tab === key ? 'bg-accent text-white' : 'text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  if (tab === 'project') {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mb-5 flex justify-center">{tabs}</div>
        <SetsGallery sets={sets} onOpenSet={onOpenSet} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center text-center">
      <div className="mb-6">{tabs}</div>
      <StepPill step={3} total={3} />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        You're all set! {doorCount} doors, {extracted.length} hw sets, and {componentCount} components ready to export.
      </h1>
      {missingCount > 0 && (
        <p className="mt-2 text-sm font-semibold text-danger">
          {plural(missingCount, 'set')} from the numbering sequence still unresolved — locate or accept
          {missingCount === 1 ? ' it' : ' them'} in the Hardware step.
        </p>
      )}
      <p className="mt-2 text-base text-muted">Export to JSON or CSV, with confidence and source text on every field.</p>

      <div className="mt-12 flex items-start gap-12">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="stat-number">{stat.value}</p>
            <p className="mt-1 text-lg text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 flex items-center gap-4">
        <a href={api.exportUrl(project.id, 'json')} download className="btn-primary btn-big flex items-center gap-2.5">
          <FileIcon size={20} /> Download JSON
        </a>
        <a href={api.exportUrl(project.id, 'csv')} download className="btn-outline btn-big flex items-center gap-2.5">
          <DownloadIcon size={20} /> Export CSV
        </a>
      </div>
      <a href={api.exportUrl(project.id, 'flat')} download className="link-accent mt-4 text-sm">
        Export flat JSON (challenge format)
      </a>

      {flaggedCount > 0 && project.status !== 'reviewed' && (
        <button
          type="button"
          onClick={onFixRemaining}
          className="mt-8 text-sm font-medium text-warn hover:underline"
        >
          {plural(flaggedCount, 'field')} still flagged for review — go back to finish
        </button>
      )}
    </div>
  )
}
