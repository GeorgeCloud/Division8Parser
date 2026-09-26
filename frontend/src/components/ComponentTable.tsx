// Component table: every cell is a correction control (click-to-edit with
// project-sourced suggestions for mfr/finish — nothing hardcoded), rows
// expand to full text + source line, columns resize, and each row has
// locate (jump the page viewer to its box) and split actions.

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ComponentField, HardwareComponent } from '../types'
import { COMPONENT_FIELDS } from '../review'
import { EditableField } from './EditableField'
import { ChevronRightIcon, CrosshairIcon, SplitIcon } from './icons'

type ColKey = 'expander' | 'qty' | 'description' | 'finish' | 'catalog' | 'mfr' | 'notes' | 'actions'

const COLUMNS: { key: ColKey; label: string; width: number; resizable: boolean }[] = [
  { key: 'expander', label: '', width: 30, resizable: false },
  { key: 'qty', label: 'Qty', width: 58, resizable: true },
  { key: 'description', label: 'Description', width: 195, resizable: true },
  { key: 'finish', label: 'Finish', width: 105, resizable: true },
  { key: 'catalog', label: 'Catalog #', width: 165, resizable: true },
  { key: 'mfr', label: 'Mfr', width: 105, resizable: true },
  { key: 'notes', label: 'Notes', width: 145, resizable: true },
  { key: 'actions', label: '', width: 64, resizable: false },
]

const MIN_COL_WIDTH = 48

interface Props {
  components: HardwareComponent[]
  /** values already present across this project — feeds suggestion lists */
  mfrOptions: string[]
  finishOptions: string[]
  onEdit: (componentId: string, field: ComponentField, value: string | null) => void
  onConfirm: (componentId: string, field: ComponentField) => void
  onLocate: (component: HardwareComponent) => void
  onSplitAt: (index: number) => void
}

export function ComponentTable({
  components,
  mfrOptions,
  finishOptions,
  onEdit,
  onConfirm,
  onLocate,
  onSplitAt,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<ColKey, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])) as Record<ColKey, number>,
  )
  const dragRef = useRef<{ key: ColKey; startX: number; startWidth: number } | null>(null)

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startResize(key: ColKey, e: ReactPointerEvent) {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { key, startX: e.clientX, startWidth: widths[key] }
  }

  function moveResize(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const width = Math.max(MIN_COL_WIDTH, drag.startWidth + e.clientX - drag.startX)
    setWidths((prev) => ({ ...prev, [drag.key]: width }))
  }

  function endResize() {
    dragRef.current = null
  }

  if (components.length === 0) {
    return <div className="empty-state py-8 text-sm">No components in this set.</div>
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + widths[c.key], 0)

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-left" style={{ tableLayout: 'fixed', width: totalWidth }}>
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: widths[c.key] }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold tracking-wide text-muted">
            {COLUMNS.map((c) => (
              <th key={c.key} className="relative px-1.5 py-2 font-semibold" aria-label={c.label || c.key}>
                {c.label}
                {c.resizable && (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    title="Drag to resize column"
                    onPointerDown={(e) => startResize(c.key, e)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none border-r border-line hover:border-accent active:border-accent"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {components.map((component, index) => (
            <Row
              key={component.id}
              component={component}
              index={index}
              isExpanded={expanded.has(component.id)}
              onToggle={() => toggle(component.id)}
              mfrOptions={mfrOptions}
              finishOptions={finishOptions}
              onEdit={onEdit}
              onConfirm={onConfirm}
              onLocate={onLocate}
              onSplitAt={onSplitAt}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExpandedDetails({ component }: { component: HardwareComponent }) {
  const populated = COMPONENT_FIELDS.filter((d) => d.get(component).value !== null)
  const sources = [
    ...new Set(
      COMPONENT_FIELDS.map((d) => d.get(component).rawText).filter(
        (raw): raw is string => raw !== null,
      ),
    ),
  ]
  return (
    <div className="grid gap-x-6 gap-y-2 rounded-lg bg-black/[0.03] px-4 py-3 sm:grid-cols-2">
      {populated.map((descriptor) => (
        <div key={descriptor.key} className="text-xs">
          <span className="font-semibold text-muted">{descriptor.label}: </span>
          <span className="whitespace-pre-wrap break-words">{String(descriptor.get(component).value)}</span>
        </div>
      ))}
      {sources.length > 0 && (
        <div className="text-xs sm:col-span-2">
          <span className="font-semibold text-muted">Extracted from: </span>
          {sources.map((raw) => (
            <span key={raw} className="mr-1.5 inline-block rounded bg-white px-1.5 py-0.5 font-mono text-[11px]">
              “{raw}”
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface RowProps extends Pick<Props, 'mfrOptions' | 'finishOptions' | 'onEdit' | 'onConfirm' | 'onLocate' | 'onSplitAt'> {
  component: HardwareComponent
  index: number
  isExpanded: boolean
  onToggle: () => void
}

function Row({
  component,
  index,
  isExpanded,
  onToggle,
  mfrOptions,
  finishOptions,
  onEdit,
  onConfirm,
  onLocate,
  onSplitAt,
}: RowProps) {
  const cell = (field: ComponentField, options?: { mono?: boolean; numeric?: boolean; suggestions?: string[] }) => {
    const descriptor = COMPONENT_FIELDS.find((d) => d.key === field)!
    return (
      <EditableField
        field={descriptor.get(component) as HardwareComponent['description']}
        mono={options?.mono}
        numeric={options?.numeric}
        suggestions={options?.suggestions}
        onSave={(value) => onEdit(component.id, field, value)}
        onConfirm={() => onConfirm(component.id, field)}
      />
    )
  }

  return (
    <>
      <tr className="group border-b border-line/60 align-middle hover:bg-black/[0.02]">
        <td className="px-1 py-1">
          <button
            type="button"
            onClick={onToggle}
            title={isExpanded ? 'Collapse row' : 'Expand row to see full text'}
            aria-expanded={isExpanded}
            className="icon-btn-plain"
          >
            <ChevronRightIcon size={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        </td>
        <td className="px-0.5 py-1">{cell('qty', { numeric: true })}</td>
        <td className="px-0.5 py-1 font-medium">{cell('description')}</td>
        <td className="px-0.5 py-1">{cell('finish', { suggestions: finishOptions })}</td>
        <td className="px-0.5 py-1">{cell('catalogNumber', { mono: true })}</td>
        <td className="px-0.5 py-1">{cell('mfr', { suggestions: mfrOptions })}</td>
        <td className="px-0.5 py-1 text-muted">{cell('notes')}</td>
        <td className="px-0.5 py-1">
          <span className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {component.bbox && (
              <button
                type="button"
                title="Show this component on the page"
                onClick={() => onLocate(component)}
                className="icon-btn-plain"
              >
                <CrosshairIcon size={15} />
              </button>
            )}
            {index > 0 && (
              <button
                type="button"
                title="Split set before this row"
                onClick={() => onSplitAt(index)}
                className="icon-btn-plain"
              >
                <SplitIcon size={15} />
              </button>
            )}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-line/60 bg-black/[0.01]">
          <td colSpan={COLUMNS.length} className="px-2 pb-2 pt-1">
            <ExpandedDetails component={component} />
          </td>
        </tr>
      )}
    </>
  )
}
