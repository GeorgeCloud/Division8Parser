// Region editor: manage the set's boxes across any document/page. Draw to
// add, click a listed box to jump/select, delete + redraw to change (no
// resize, per design). Boxes may not overlap. Saving sends the full list;
// the backend diffs — deletions/adoptions are free, new page area triggers
// one scoped re-extraction.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { BBox, HardwareSet, PageInfo, RegionDraft, SpecDocument } from '../types'
import { api } from '../api'
import { bboxPercentStyle, overlaps } from '../pdfGeometry'
import { Modal } from './Modal'
import { PageNav } from './PageNav'
import { TrashIcon } from './icons'

interface Props {
  set: HardwareSet
  documents: SpecDocument[]
  onSave: (regions: RegionDraft[]) => void
  onCancel: () => void
}

interface DragRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function RegionEditor({ set, documents, onSave, onCancel }: Props) {
  const initial = set.regions[0]
  const [drafts, setDrafts] = useState<RegionDraft[]>(() =>
    set.regions.map((r) => ({ id: r.id, documentId: r.documentId, pdfPage: r.pdfPage, bbox: r.bbox })),
  )
  const [documentId, setDocumentId] = useState(initial?.documentId ?? documents[0]?.id ?? '')
  const [page, setPage] = useState(initial?.pdfPage ?? 1)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [rect, setRect] = useState<DragRect | null>(null)
  const [overlapError, setOverlapError] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (documentId) api.getDocumentPages(documentId).then(setPages)
  }, [documentId])

  const document = documents.find((d) => d.id === documentId)
  const pageInfo = pages.find((p) => p.pdfPage === page)
  const pageWidth = pageInfo?.width ?? 612
  const pageHeight = pageInfo?.height ?? 792

  const draftsOnPage = useMemo(
    () => drafts.filter((d) => d.documentId === documentId && d.pdfPage === page),
    [drafts, documentId, page],
  )

  function toBBox(r: DragRect): BBox {
    return {
      x0: Math.min(r.x0, r.x1) * pageWidth,
      y0: Math.min(r.y0, r.y1) * pageHeight,
      x1: Math.max(r.x0, r.x1) * pageWidth,
      y1: Math.max(r.y0, r.y1) * pageHeight,
    }
  }

  const liveConflict =
    rect !== null && draftsOnPage.some((d) => overlaps(toBBox(rect), d.bbox))

  function pointerFraction(e: PointerEvent): { x: number; y: number } {
    const bounds = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (e.clientY - bounds.top) / bounds.height)),
    }
  }

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    const p = pointerFraction(e)
    setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  function handlePointerMove(e: PointerEvent) {
    if (!rect) return
    const p = pointerFraction(e)
    setRect((r) => (r ? { ...r, x1: p.x, y1: p.y } : r))
  }

  function handlePointerUp() {
    if (!rect) return
    const bigEnough = Math.abs(rect.x1 - rect.x0) >= 0.01 && Math.abs(rect.y1 - rect.y0) >= 0.01
    if (bigEnough && liveConflict) {
      setOverlapError(true)
    } else if (bigEnough) {
      setOverlapError(false)
      setDrafts((prev) => [...prev, { documentId, pdfPage: page, bbox: toBBox(rect) }])
    }
    setRect(null)
  }

  function jumpTo(draft: RegionDraft) {
    setDocumentId(draft.documentId)
    setPage(draft.pdfPage)
    setOverlapError(false)
  }

  function filenameOf(id: string): string {
    return documents.find((d) => d.id === id)?.filename ?? id
  }

  return (
    <Modal onClose={onCancel} className="max-h-[92vh] max-w-4xl">
      <header className="border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">Correct location for Set {set.setNumber.value ?? '?'}</h2>
        <p className="mt-0.5 text-sm text-muted">
          Each drag adds a box. To change a box, delete it and draw again. Removing a box removes its
          components; drawing over new page area re-extracts just that area.
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-line">
          <h3 className="px-4 pt-3 pb-2 text-xs font-bold tracking-wide text-muted">
            Boxes ({drafts.length})
          </h3>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {drafts.length === 0 ? (
              <p className="px-2 text-xs text-muted">None yet — drag on the page to add one.</p>
            ) : (
              <ul className="space-y-1">
                {drafts.map((draft, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => jumpTo(draft)}
                      className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent-soft ${
                        draft.documentId === documentId && draft.pdfPage === page ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <span className="block truncate font-medium">{filenameOf(draft.documentId)}</span>
                      <span className="block text-muted">
                        p.{draft.pdfPage} · [{Math.round(draft.bbox.x0)}, {Math.round(draft.bbox.y0)}] →{' '}
                        [{Math.round(draft.bbox.x1)}, {Math.round(draft.bbox.y1)}]
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove box"
                      className="mt-1 rounded-md p-1 text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <select
              value={documentId}
              onChange={(e) => {
                setDocumentId(e.target.value)
                setPage(1)
                setOverlapError(false)
              }}
              className="input min-w-0 flex-1 cursor-pointer"
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
            <PageNav page={page} pageCount={document?.pageCount ?? null} onChange={(p) => { setPage(p); setOverlapError(false) }} />
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
            <div
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative w-full cursor-crosshair touch-none select-none rounded border border-line"
              style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}
            >
              <img
                src={api.pageImageUrl(documentId, page)}
                alt={`Page ${page}`}
                className="pointer-events-none h-full w-full"
                draggable={false}
              />
              {draftsOnPage.map((draft, i) => (
                <div key={i} className="region-box" style={bboxPercentStyle(draft.bbox, pageWidth, pageHeight)} />
              ))}
              {rect && (
                <div
                  className={liveConflict ? 'region-box-invalid' : 'region-box-draft'}
                  style={bboxPercentStyle(toBBox(rect), pageWidth, pageHeight)}
                />
              )}
            </div>
            {overlapError && (
              <p className="mt-2 text-xs font-medium text-danger">
                Boxes can't overlap — draw in a clear area.
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-5 py-4">
        <p className="flex-1 text-xs text-muted">
          {drafts.length === 0 ? 'At least one box is required to save.' : ''}
        </p>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(drafts)}
          disabled={drafts.length === 0}
          className="btn-primary"
        >
          Save {drafts.length} box{drafts.length === 1 ? '' : 'es'}
        </button>
      </footer>
    </Modal>
  )
}
