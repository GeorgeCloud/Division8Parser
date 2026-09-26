// Step 2: the hardware review. Left: source page with region highlights and
// click-to-locate. Right: set header + editable component table. Saving new
// regions re-extracts server-side, so the table blocks until fresh data lands.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ComponentField,
  HardwareComponent,
  HardwareSet,
  Project,
  RegionDraft,
  SetTextField,
  SpecDocument,
} from '../../types'
import { api } from '../../api'
import { ComponentTable } from '../../components/ComponentTable'
import { ConfidenceBadge } from '../../components/ConfidenceBadge'
import { EditableField } from '../../components/EditableField'
import { AlertDialog } from '../../components/Modal'
import { PdfPagePanel } from '../../components/PdfPagePanel'
import { RegionEditor } from '../../components/RegionEditor'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoorIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
  WarnIcon,
} from '../../components/icons'
import { collectFlagged, confidenceTone, plural, REVIEW_THRESHOLD } from '../../review'
import type { FlaggedField, SetFieldKey } from '../../review'

const toneClasses = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}

/** Bare confidence chip for places that carry a number, not a Field. */
function ConfChip({ confidence }: { confidence: number }) {
  return (
    <span
      title={`Extraction confidence ${confidence}/100`}
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${toneClasses[confidenceTone(confidence)]}`}
    >
      {confidence}
    </span>
  )
}

interface Props {
  project: Project
  /** incremented by the wizard when the user chooses "fix them first" */
  reviewFocusNonce?: number
  /** set to open on arrival, e.g. a card clicked in the project gallery */
  focusSetId?: string | null
  onFlaggedCount?: (count: number) => void
  /** fired after any data mutation so the wizard can refresh project status */
  onEdited?: () => void
}

export function HardwareStep({ project, reviewFocusNonce, focusSetId, onFlaggedCount, onEdited }: Props) {
  const [sets, setSets] = useState<HardwareSet[]>([])
  const [documents, setDocuments] = useState<SpecDocument[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingRegions, setEditingRegions] = useState(false)
  const [reextracting, setReextracting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [locatedComponent, setLocatedComponent] = useState<HardwareComponent | null>(null)
  const [bannerOpen, setBannerOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const fresh = await api.getSets(project.id)
    setSets(fresh)
    setLoading(false)
    setActiveId((current) => (current && fresh.some((s) => s.id === current) ? current : (fresh[0]?.id ?? null)))
  }, [project.id])

  useEffect(() => {
    refresh()
    api.getDocuments(project.id).then(setDocuments)
  }, [refresh, project.id])

  useEffect(() => {
    if (focusSetId) setActiveId(focusSetId)
  }, [focusSetId])

  // switching sets drops the located-component highlight
  useEffect(() => {
    setLocatedComponent(null)
  }, [activeId])

  const activeIndex = sets.findIndex((s) => s.id === activeId)
  const active = activeIndex === -1 ? null : sets[activeIndex]

  // suggestion lists come from this project's own extracted values — the UI
  // never carries a hardcoded manufacturer or finish list
  const { mfrOptions, finishOptions } = useMemo(() => {
    const mfrs = new Set<string>()
    const finishes = new Set<string>()
    for (const set of sets) {
      for (const c of set.components) {
        if (c.mfr.value) mfrs.add(c.mfr.value)
        if (c.finish.value) finishes.add(c.finish.value)
      }
    }
    return { mfrOptions: [...mfrs].sort(), finishOptions: [...finishes].sort() }
  }, [sets])

  function replaceSet(updated: HardwareSet) {
    setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    onEdited?.()
  }

  async function editSetField(field: SetTextField, value: string | null) {
    if (!active) return
    replaceSet(await api.patchSetField(active.id, field, value))
  }

  function replaceComponent(updated: HardwareComponent) {
    setSets((prev) =>
      prev.map((s) =>
        s.id === updated.setId ? { ...s, components: s.components.map((c) => (c.id === updated.id ? updated : c)) } : s,
      ),
    )
    onEdited?.()
  }

  async function editComponent(componentId: string, field: ComponentField, value: string | null) {
    replaceComponent(await api.patchComponentField(componentId, field, value))
  }

  async function confirmComponent(componentId: string, field: ComponentField) {
    replaceComponent(await api.confirmComponentField(componentId, field))
  }

  async function confirmFlagged(f: FlaggedField) {
    if (f.componentId) {
      replaceComponent(await api.confirmComponentField(f.componentId, f.fieldKey as ComponentField))
    } else {
      replaceSet(await api.confirmSetField(f.setId, f.fieldKey as SetFieldKey))
    }
  }

  async function splitActive(atIndex: number) {
    if (!active) return
    const [, created] = await api.splitSet(active.id, atIndex)
    await refresh()
    setActiveId(created.id)
    onEdited?.()
  }

  async function deleteActive() {
    if (!active) return
    setConfirmingDelete(false)
    await api.deleteSet(active.id)
    await refresh()
    onEdited?.()
  }

  async function addSet() {
    const created = await api.addSet(project.id)
    await refresh()
    setActiveId(created.id)
    onEdited?.()
  }

  async function toggleNotUsed() {
    if (!active) return
    replaceSet(await api.setNotUsed(active.id, !active.notUsed))
  }

  async function saveRegions(drafts: RegionDraft[]) {
    if (!active) return
    // Saving regions may trigger an instant server-side re-extraction over the
    // newly covered page area; the table blocks until fresh components land.
    setEditingRegions(false)
    setReextracting(true)
    try {
      const { set } = await api.setRegions(active.id, drafts)
      replaceSet(set)
    } finally {
      setReextracting(false)
    }
  }

  async function editDoors() {
    if (!active) return
    const current = active.doors.value?.join(', ') ?? ''
    const input = window.prompt('Door numbers (comma-separated):', current)
    if (input === null) return
    replaceSet(await api.setDoors(active.id, input.split(',').map((d) => d.trim()).filter(Boolean)))
  }

  const flagged = collectFlagged(sets)
  const flaggedSetIds = new Set(flagged.map((f) => f.setId))

  useEffect(() => {
    if (!loading) onFlaggedCount?.(flagged.length)
  }, [flagged.length, loading, onFlaggedCount])

  useEffect(() => {
    if (reviewFocusNonce) {
      setBannerOpen(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [reviewFocusNonce])

  if (loading) return <p className="py-20 text-center text-muted">Loading sets…</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {flagged.length > 0 && (
        <details
          open={bannerOpen}
          onToggle={(e) => setBannerOpen(e.currentTarget.open)}
          className="mb-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
            <WarnIcon size={18} className="shrink-0 text-warn" />
            <span className="text-sm font-bold text-warn">{plural(flagged.length, 'field')} need{flagged.length === 1 ? 's' : ''} review</span>
            <span className="text-xs text-warn/80">
              extraction confidence under {REVIEW_THRESHOLD} — click to see them
            </span>
          </summary>
          <ul className="mt-2.5 max-h-44 space-y-0.5 overflow-auto">
            {flagged.map((f, i) => (
              <li key={i} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveId(f.setId)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-white/70 ${
                    f.setId === activeId ? 'bg-white/60' : ''
                  }`}
                >
                  <ConfChip confidence={f.confidence} />
                  <span className="font-semibold">Set {f.setNumber}</span>
                  {f.component && <span className="text-muted">{f.component}</span>}
                  <span className="text-muted">{f.fieldName}:</span>
                  <span className="min-w-0 flex-1 truncate">{f.value}</span>
                </button>
                <button
                  type="button"
                  onClick={() => confirmFlagged(f)}
                  title="Confirm this value is correct as-is (blanks included)"
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ok hover:bg-white/70"
                >
                  <CheckIcon size={12} /> Looks right
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            We pulled {plural(sets.filter((s) => !s.missing).length, 'hardware set')} from your specs
          </h1>
          <p className="mt-1 text-sm text-muted">
            Review each set, fix anything the extractor got wrong, and split sets that need separation.
            {sets.some((s) => s.missing) && (
              <span className="font-semibold text-danger">
                {' '}
                {plural(sets.filter((s) => s.missing).length, 'set')} from the numbering sequence wasn't found —
                see the red tabs.
              </span>
            )}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 ${reextracting ? 'pointer-events-none opacity-50' : ''}`}>
          <button
            type="button"
            onClick={() => setActiveId(sets[Math.max(0, activeIndex - 1)]?.id ?? null)}
            disabled={activeIndex <= 0}
            className="icon-btn bg-white"
            aria-label="Previous set"
          >
            <ChevronLeftIcon size={16} />
          </button>
          {sets.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => setActiveId(set.id)}
              title={flaggedSetIds.has(set.id) ? 'Has fields needing review' : undefined}
              className={`relative rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ${
                set.id === activeId
                  ? set.missing
                    ? 'bg-danger text-white'
                    : 'bg-accent text-white'
                  : set.missing
                    ? 'border border-danger bg-danger-soft text-danger'
                    : set.notUsed
                      ? 'border border-line bg-white text-muted line-through'
                      : 'border border-line bg-white hover:border-accent'
              }`}
            >
              {set.setNumber.value ?? '?'}
              {set.missing ? (
                <span className="absolute -right-1 -top-1 size-2.5 rounded-full border border-white bg-danger" />
              ) : (
                flaggedSetIds.has(set.id) && (
                  <span className="absolute -right-1 -top-1 size-2.5 rounded-full border border-white bg-warn" />
                )
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActiveId(sets[Math.min(sets.length - 1, activeIndex + 1)]?.id ?? null)}
            disabled={activeIndex >= sets.length - 1}
            className="icon-btn bg-white"
            aria-label="Next set"
          >
            <ChevronRightIcon size={16} />
          </button>
          <button type="button" onClick={addSet} className="btn-outline ml-2 flex items-center gap-1.5 px-3 py-1.5">
            <PlusIcon size={15} /> Add set
          </button>
        </div>
      </div>

      {active && active.missing && (
        <div className="card mx-auto mt-8 flex w-full max-w-xl flex-col items-center gap-3 p-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
            <WarnIcon size={20} />
          </span>
          <h2 className="text-xl font-bold">Set {active.setNumber.value} wasn't found</h2>
          <p className="text-sm text-muted">
            The schedule's numbering references set {active.setNumber.value} between its neighbors, but
            extraction couldn't find its contents. If you can see it in the source document, draw a box
            around it and we'll extract it. If the document genuinely skips this number, accept the gap
            and this tab disappears.
          </p>
          {reextracting ? (
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-accent">
              <SpinnerIcon size={18} /> Extracting from your box…
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => setEditingRegions(true)} className="btn-primary">
                Set the location
              </button>
              <button
                type="button"
                onClick={async () => {
                  await api.deleteSet(active.id)
                  await refresh()
                  onEdited?.()
                }}
                className="btn-outline"
              >
                Accept as missing
              </button>
            </div>
          )}
        </div>
      )}

      {active && !active.missing && (
        <div className="relative mt-5 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,1fr)_minmax(480px,1.8fr)]">
          {reextracting && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/75 backdrop-blur-[1px]">
              <SpinnerIcon size={30} className="text-accent" />
              <p className="text-sm font-semibold">Re-extracting from the new location…</p>
              <p className="text-xs text-muted">The table is locked until fresh components come back.</p>
            </div>
          )}
          <PdfPagePanel
            set={active}
            locatedComponent={locatedComponent}
            onCorrectLocation={() => setEditingRegions(true)}
          />

          <section className="card min-w-0 p-4">
            <header className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
              <span className={`size-2.5 rounded-full ${active.notUsed ? 'bg-line' : 'bg-ok'}`} />
              <h2 className="text-lg font-bold">Hardware Set</h2>
              <span className="w-20">
                <EditableField field={active.setNumber} onSave={(v) => editSetField('setNumber', v)} />
              </span>
              <span className="text-sm text-muted">{plural(active.components.length, 'component')}</span>
              <span className="ml-auto flex items-center gap-2">
                <ConfChip confidence={active.setConfidence} />
                <button
                  type="button"
                  onClick={toggleNotUsed}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                    active.notUsed
                      ? 'border-warn bg-warn-soft text-warn'
                      : 'border-line text-muted hover:border-warn hover:text-warn'
                  }`}
                >
                  {active.notUsed ? 'Marked NOT USED' : 'Mark NOT USED'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  title="Delete this set"
                  className="icon-btn hover:border-danger hover:text-danger"
                >
                  <TrashIcon size={15} />
                </button>
              </span>
            </header>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="text-xs text-muted">
                Found as “{active.headingRaw}” on page {active.regions[0]?.pdfPage ?? '—'}
              </p>
              <span className="flex items-center gap-1.5">
                <DoorIcon size={14} className="text-muted" />
                <span className="text-xs font-semibold text-muted">Doors:</span>
                {(active.doors.value ?? []).map((door) => (
                  <span key={door} className="chip-ok px-1.5 py-0.5">
                    {door}
                  </span>
                ))}
                {(active.doors.value ?? []).length === 0 && <span className="text-xs text-muted">none listed</span>}
                <ConfidenceBadge field={active.doors} />
                <button type="button" onClick={editDoors} className="link-accent text-xs">
                  Edit
                </button>
              </span>
            </div>

            {active.notUsed && (
              <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                Marked NOT USED in the specbook — kept in the schedule and still editable below.
              </div>
            )}
            <div className="mt-2">
              <ComponentTable
                components={active.components}
                mfrOptions={mfrOptions}
                finishOptions={finishOptions}
                onEdit={editComponent}
                onConfirm={confirmComponent}
                onLocate={setLocatedComponent}
                onSplitAt={splitActive}
              />
            </div>

            <div className="mt-4 border-t border-line pt-3">
              <h3 className="text-xs font-bold tracking-wide text-muted">Set notes</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {active.notes.value ?? 'No operating notes for this set.'}
              </p>
            </div>
          </section>
        </div>
      )}

      {editingRegions && active && (
        <RegionEditor
          set={active}
          documents={documents}
          onSave={saveRegions}
          onCancel={() => setEditingRegions(false)}
        />
      )}

      {confirmingDelete && active && (
        <AlertDialog
          icon={<WarnIcon size={18} />}
          title={`Delete set ${active.setNumber.value ?? ''}?`}
          body="The set and all its components come out of the schedule. This can't be undone."
          onClose={() => setConfirmingDelete(false)}
          actions={[
            { label: 'Delete set', onClick: deleteActive, variant: 'primary' },
            { label: 'Keep it', onClick: () => setConfirmingDelete(false), variant: 'ghost' },
          ]}
        />
      )}
    </div>
  )
}
