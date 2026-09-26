// Bottom wizard stepper matching the Fresco screenshots: circular icon
// buttons joined by connector dashes, green when complete, blue when active.

import type { ReactNode } from 'react'
import { CheckIcon } from './icons'

export interface Step {
  key: string
  label: string
  icon: ReactNode
}

interface Props {
  steps: Step[]
  currentIndex: number
  completedThrough: number // steps with index < this render as complete
  onSelect: (index: number) => void
  maxReachable: number // indexes above this are disabled
}

export function Stepper({ steps, currentIndex, completedThrough, onSelect, maxReachable }: Props) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const complete = i < completedThrough
        const active = i === currentIndex
        const reachable = i <= maxReachable
        return (
          <div key={step.key} className="flex items-center gap-2">
            {i > 0 && <span className={`h-0.5 w-6 rounded ${complete || active ? 'bg-ok' : 'bg-line'}`} />}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(i)}
              className="group flex flex-col items-center gap-1 disabled:cursor-not-allowed"
            >
              <span
                className={`flex size-11 items-center justify-center rounded-full transition-colors ${
                  active
                    ? 'bg-accent text-white ring-4 ring-accent/20'
                    : complete
                      ? 'bg-ok text-white'
                      : 'bg-line/70 text-muted group-hover:bg-line'
                } ${!reachable ? 'opacity-50' : ''}`}
              >
                {complete && !active ? <CheckIcon size={20} /> : step.icon}
              </span>
              <span
                className={`text-xs font-medium ${
                  active ? 'text-accent' : complete ? 'text-ok' : 'text-muted'
                } ${!reachable ? 'opacity-50' : ''}`}
              >
                {step.label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function StepPill({ step, total }: { step: number; total: number }) {
  return (
    <span className="inline-block rounded-full bg-ok-soft px-3 py-1 text-xs font-bold tracking-wide text-ok">
      STEP {step} OF {total}
    </span>
  )
}
