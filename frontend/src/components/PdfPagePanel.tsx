// Left panel of the review screen: the real rendered page (served by the
// backend) with the active set's region boxes drawn over it, and — when a
// component is located from the table — that component's own row box pulsing.

import { useEffect, useMemo, useState } from 'react'
import type { HardwareComponent, HardwareSet } from '../types'
import { api } from '../api'
import { bboxPercentStyle, pagesOf, regionsOnPage } from '../pdfGeometry'
import { FileIcon, PencilIcon } from './icons'

interface Props {
  set: HardwareSet
  /** component to highlight (from the table's locate button) */
  locatedComponent: HardwareComponent | null
  onCorrectLocation: () => void
}

export function PdfPagePanel({ set, locatedComponent, onCorrectLocation }: Props) {
  const pages = useMemo(() => pagesOf(set.regions), [set.regions])
  const [pageIndex, setPageIndex] = useState(0)

  // jump to the located component's page when the locate button is used
  useEffect(() => {
    if (!locatedComponent?.regionId) return
    const region = set.regions.find((r) => r.id === locatedComponent.regionId)
    if (!region) return
    const index = pages.findIndex(
      (p) => p.documentId === region.documentId && p.pdfPage === region.pdfPage,
    )
    if (index >= 0) setPageIndex(index)
  }, [locatedComponent, set.regions, pages])

  const current = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))]
  const regions = current ? regionsOnPage(set.regions, current.documentId, current.pdfPage) : []
  const pageSize = regions[0] ?? null

  const locatedRegion = locatedComponent?.regionId
    ? set.regions.find((r) => r.id === locatedComponent.regionId)
    : null
  const showLocated =
    locatedComponent?.bbox &&
    locatedRegion &&
    current &&
    locatedRegion.documentId === current.documentId &&
    locatedRegion.pdfPage === current.pdfPage

  return (
    <section className="card flex min-w-0 flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <FileIcon size={18} className="shrink-0 text-muted" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">Source page</h3>
          <button type="button" onClick={onCorrectLocation} className="btn-outline whitespace-nowrap px-2.5 py-1 text-xs">
            <PencilIcon size={13} className="mr-1 inline" />
            Correct location
          </button>
        </div>
        {current && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pages.length > 1 ? (
              <select
                value={pageIndex}
                onChange={(e) => setPageIndex(Number(e.target.value))}
                className="input cursor-pointer py-1 text-xs font-semibold tabular-nums"
                aria-label="Page of this set"
              >
                {pages.map((p, i) => (
                  <option key={`${p.documentId}:${p.pdfPage}`} value={i}>
                    Page {p.pdfPage}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-muted">Page {current.pdfPage}</span>
            )}
            {pages.length > 1 && (
              <span className="text-xs text-muted">
                {pageIndex + 1} of {pages.length}
              </span>
            )}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {current && pageSize ? (
          <div className="relative">
            <img
              src={api.pageImageUrl(current.documentId, current.pdfPage)}
              alt={`Specbook page ${current.pdfPage}`}
              className="w-full rounded border border-line"
            />
            {regions.map((region, i) => (
              <div
                key={region.id}
                className="region-box"
                style={bboxPercentStyle(region.bbox, region.pageWidth, region.pageHeight)}
              >
                <span className="absolute -top-3 -left-0.5 rounded bg-ok px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {regions.length > 1
                    ? `Set ${set.setNumber.value ?? '?'} · ${i + 1}`
                    : `Set ${set.setNumber.value ?? '?'}`}
                </span>
              </div>
            ))}
            {showLocated && locatedComponent.bbox && locatedRegion && (
              <div
                className="component-box"
                style={bboxPercentStyle(
                  locatedComponent.bbox,
                  locatedRegion.pageWidth,
                  locatedRegion.pageHeight,
                )}
              />
            )}
          </div>
        ) : (
          <div className="empty-state flex h-full min-h-64 flex-col items-center justify-center gap-2">
            <FileIcon size={28} />
            <p className="text-sm">No location for this set yet — use Correct location.</p>
          </div>
        )}
      </div>
    </section>
  )
}
