// Renders an extracted Field<T>: value + confidence chip, click to edit.
// Null shows as "—" (absent, never guessed). `suggestions` (values already
// present in this project — nothing hardcoded) render as a datalist while
// still allowing free text. Flagged fields get a ✓ to confirm as-is.

import { useEffect, useId, useRef, useState } from 'react'
import type { Field } from '../types'
import { fieldTone, isFlagged } from '../review'
import { ConfidenceBadge } from './ConfidenceBadge'
import { CheckIcon } from './icons'

interface Props {
  field: Field<string> | Field<number>
  onSave: (value: string | null) => void
  /** flagged fields get a ✓ confirming the current value — blanks included */
  onConfirm?: () => void
  /** datalist options sourced from the project's own extracted values */
  suggestions?: string[]
  mono?: boolean
  numeric?: boolean
}

export function EditableField({ field, onSave, onConfirm, suggestions, mono, numeric }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const display = field.value === null ? '' : String(field.value)

  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next === display) return
    onSave(next === '' ? null : next)
  }

  if (editing) {
    return (
      <>
        <input
          ref={inputRef}
          value={draft}
          list={suggestions?.length ? listId : undefined}
          inputMode={numeric ? 'numeric' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className={`w-full min-w-14 rounded-md border border-accent bg-white px-1.5 py-0.5 text-[13px] outline-none ring-2 ring-accent/20 ${mono ? 'font-mono text-xs' : ''}`}
        />
        {suggestions?.length ? (
          <datalist id={listId}>
            {suggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ) : null}
      </>
    )
  }

  const tone = fieldTone(field)
  const highlight = field.verified ? '' : tone === 'warn' ? 'field-warn' : tone === 'danger' ? 'field-danger' : ''

  const cell = (
    <button
      type="button"
      onClick={() => {
        setDraft(display)
        setEditing(true)
      }}
      title={field.rawText ? `Extracted from: "${field.rawText}"` : 'Click to edit'}
      className={`field-cell justify-between ${highlight}`}
    >
      <span className={`truncate ${mono ? 'font-mono text-xs' : ''} ${field.value === null ? 'text-muted' : ''}`}>
        {field.value === null ? '—' : display}
      </span>
      <ConfidenceBadge field={field} />
    </button>
  )

  if (!onConfirm || !isFlagged(field)) return cell

  return (
    <span className="flex w-full items-center gap-0.5">
      {cell}
      <button
        type="button"
        onClick={onConfirm}
        title="Confirm this value is correct as-is"
        className="confirm-check"
      >
        <CheckIcon size={13} />
      </button>
    </span>
  )
}
