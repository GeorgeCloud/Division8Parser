// Confidence chip, shown only when a value needs attention (< threshold);
// a human-verified field shows a green check instead.

import type { Field } from '../types'
import { fieldTone, isFlagged } from '../review'

const toneClasses = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}

export function ConfidenceBadge({ field }: { field: Field<unknown> }) {
  if (!field.verified && !isFlagged(field)) return null
  const tone = fieldTone(field)
  return (
    <span
      title={field.verified ? 'Confirmed by you' : `Extraction confidence ${field.confidence}/100`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${toneClasses[tone]}`}
    >
      {field.verified ? '✓' : field.confidence}
    </span>
  )
}
