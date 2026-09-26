// Card-grid browser for every hardware set in the project. Built for scale:
// the search haystack is indexed once per data change, results render
// incrementally, and search covers sets, doors, and every component field.

import { useMemo, useState } from 'react'
import type { HardwareComponent, HardwareSet } from '../types'

const PAGE_SIZE = 60
const DOOR_CHIP_LIMIT = 4

interface Props {
  sets: HardwareSet[]
  onOpenSet: (setId: string) => void
}

interface IndexEntry {
  set: HardwareSet
  haystack: string
  components: { component: HardwareComponent; haystack: string }[]
}

function textOf(values: (string | null | undefined)[]): string {
  return values.filter(Boolean).join(' ').toLowerCase()
}

export function SetsGallery({ sets, onOpenSet }: Props) {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  // index built once per sets change; keystrokes only run .includes
  const index: IndexEntry[] = useMemo(
    () =>
      sets.map((set) => ({
        set,
        haystack: textOf([
          set.setNumber.value,
          set.headingRaw,
          set.description.value,
          ...(set.doors.value ?? []),
        ]),
        components: set.components.map((component) => ({
          component,
          haystack: textOf([
            component.description.value,
            component.catalogNumber.value,
            component.mfr.value,
            component.finish.value,
            component.notes.value,
          ]),
        })),
      })),
    [sets],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return index.map((entry) => ({ entry, component: null as HardwareComponent | null }))
    const out: { entry: IndexEntry; component: HardwareComponent | null }[] = []
    for (const entry of index) {
      if (entry.haystack.includes(q)) {
        out.push({ entry, component: null })
        continue
      }
      const hit = entry.components.find((c) => c.haystack.includes(q))
      if (hit) out.push({ entry, component: hit.component })
    }
    return out
  }, [index, query])

  const shown = matches.slice(0, visible)

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setVisible(PAGE_SIZE)
          }}
          placeholder="Search sets by number, door, or component…"
          className="input-lg w-full max-w-xl"
        />
        <span className="text-sm text-muted">
          {matches.length === sets.length
            ? `${sets.length} hardware set${sets.length === 1 ? '' : 's'}`
            : `${matches.length} of ${sets.length} sets match`}
        </span>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state mt-8">
          No sets match “{query}”. Try a door number, set number, catalog number, or manufacturer.
        </div>
      ) : (
        <div className="mt-5 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {shown.map(({ entry, component }) => {
            const set = entry.set
            return (
              <button
                key={set.id}
                type="button"
                onClick={() => onOpenSet(set.id)}
                className="card flex flex-col overflow-hidden text-left transition-colors hover:border-accent"
              >
                <div className="flex h-24 items-center justify-center bg-black/[0.02] text-4xl">
                  <span role="img" aria-label="door">
                    🚪
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold">Set {set.setNumber.value ?? '?'}</h3>
                    {set.notUsed && <span className="pill-warn text-[10px]">NOT USED</span>}
                    {set.missing && <span className="pill bg-danger-soft text-[10px] text-danger">MISSING</span>}
                  </div>
                  {set.description.value && (
                    <p className="truncate text-xs text-muted">{set.description.value}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {(set.doors.value ?? []).slice(0, DOOR_CHIP_LIMIT).map((door) => (
                      <span key={door} className="chip-accent">
                        {door}
                      </span>
                    ))}
                    {(set.doors.value?.length ?? 0) > DOOR_CHIP_LIMIT && (
                      <span className="text-xs text-muted">
                        +{set.doors.value!.length - DOOR_CHIP_LIMIT}
                      </span>
                    )}
                    {(set.doors.value?.length ?? 0) === 0 && (
                      <span className="text-xs text-muted">no doors listed</span>
                    )}
                  </div>
                  <p className="mt-auto text-xs text-muted">
                    {set.components.length} component{set.components.length === 1 ? '' : 's'}
                    {set.regions[0] ? ` · p.${set.regions[0].pdfPage}` : ''}
                  </p>
                  {component && (
                    <p className="truncate rounded-md bg-ok-soft px-2 py-1 text-[11px] text-ok">
                      matches: {component.description.value ?? component.catalogNumber.value ?? 'component'}
                      {component.catalogNumber.value ? ` · ${component.catalogNumber.value}` : ''}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {matches.length > visible && (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className="btn-outline px-5 py-2.5">
            Show {Math.min(PAGE_SIZE, matches.length - visible)} more of {matches.length - visible} remaining
          </button>
        </div>
      )}
    </div>
  )
}
