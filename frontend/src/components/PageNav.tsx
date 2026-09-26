// Compact page pager: prev / number input / next / "of N". Used by the
// region editor and the documents browser.

import { ChevronLeftIcon, ChevronRightIcon } from './icons'

interface Props {
  page: number
  pageCount: number | null
  onChange: (page: number) => void
}

export function PageNav({ page, pageCount, onChange }: Props) {
  const max = pageCount ?? 9999

  function clamp(value: number): number {
    return Math.min(max, Math.max(1, value))
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(clamp(page - 1))}
        disabled={page <= 1}
        className="icon-btn"
        aria-label="Previous page"
      >
        <ChevronLeftIcon size={14} />
      </button>
      <input
        type="number"
        value={page}
        min={1}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 1))}
        className="input-page"
        aria-label="Page number"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(page + 1))}
        disabled={page >= max}
        className="icon-btn"
        aria-label="Next page"
      >
        <ChevronRightIcon size={14} />
      </button>
      {pageCount !== null && <span className="ml-1 text-xs text-muted">of {pageCount}</span>}
    </span>
  )
}
