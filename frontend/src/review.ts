// Single definition of "needs review" plus the confidence-tone helpers —
// the banner, the cell highlights, and the review list all derive from here.

import type { ComponentField, Field, HardwareComponent, HardwareSet, SetTextField } from './types'

export const REVIEW_THRESHOLD = 80

export type Tone = 'ok' | 'warn' | 'danger'

export function confidenceTone(confidence: number): Tone {
  if (confidence >= REVIEW_THRESHOLD) return 'ok'
  if (confidence >= 70) return 'warn'
  return 'danger'
}

/** A field needs attention when no human has verified it and the model
 *  wasn't confident. */
export function isFlagged(field: Field<unknown>): boolean {
  return !field.verified && field.confidence < REVIEW_THRESHOLD
}

export function fieldTone(field: Field<unknown>): Tone {
  return field.verified ? 'ok' : confidenceTone(field.confidence)
}

/** One descriptor per component field: key, display label, accessor. */
export const COMPONENT_FIELDS: {
  key: ComponentField
  label: string
  get: (c: HardwareComponent) => Field<unknown>
}[] = [
  { key: 'qty', label: 'Qty', get: (c) => c.qty },
  { key: 'unit', label: 'Unit', get: (c) => c.unit },
  { key: 'description', label: 'Description', get: (c) => c.description },
  { key: 'catalogNumber', label: 'Catalog #', get: (c) => c.catalogNumber },
  { key: 'mfr', label: 'Mfr', get: (c) => c.mfr },
  { key: 'finish', label: 'Finish', get: (c) => c.finish },
  { key: 'notes', label: 'Notes', get: (c) => c.notes },
]

export type SetFieldKey = SetTextField | 'doors'

export const SET_FIELDS: {
  key: SetFieldKey
  label: string
  get: (s: HardwareSet) => Field<unknown>
}[] = [
  { key: 'setNumber', label: 'set number', get: (s) => s.setNumber },
  { key: 'description', label: 'description', get: (s) => s.description },
  { key: 'doors', label: 'doors', get: (s) => s.doors },
]

export interface FlaggedField {
  setId: string
  setNumber: string
  componentId: string | null
  component: string | null
  fieldName: string
  fieldKey: ComponentField | SetFieldKey
  value: string
  confidence: number
}

/** Every field under the threshold, worst first. */
export function collectFlagged(sets: HardwareSet[]): FlaggedField[] {
  const out: FlaggedField[] = []
  const push = (
    set: HardwareSet,
    componentId: string | null,
    component: string | null,
    fieldName: string,
    fieldKey: ComponentField | SetFieldKey,
    field: Field<unknown>,
  ) => {
    if (!isFlagged(field)) return
    out.push({
      setId: set.id,
      setNumber: set.setNumber.value ?? '?',
      componentId,
      component,
      fieldName,
      fieldKey,
      value: field.value === null ? `— (raw: "${field.rawText ?? ''}")` : String(field.value),
      confidence: field.confidence,
    })
  }
  for (const set of sets) {
    // missing-set placeholders carry no extracted fields; the set itself is
    // the flag (red pill + its own panel), not its empty values
    if (set.missing) continue
    for (const descriptor of SET_FIELDS) {
      push(set, null, null, descriptor.label, descriptor.key, descriptor.get(set))
    }
    for (const component of set.components) {
      for (const descriptor of COMPONENT_FIELDS) {
        push(
          set,
          component.id,
          component.description.value ?? '(unnamed)',
          descriptor.label.toLowerCase(),
          descriptor.key,
          descriptor.get(component),
        )
      }
    }
  }
  return out.sort((a, b) => a.confidence - b.confidence)
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
