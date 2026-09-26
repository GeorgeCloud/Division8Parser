// Simple finder for the project's documents: file list on the left, real
// rendered pages on the right, with the LLM's page classification badged so
// the user can jump straight to relevant pages.

import { useEffect, useState } from 'react'
import type { PageInfo, SpecDocument } from '../types'
import { api } from '../api'
import { Modal } from './Modal'
import { PageNav } from './PageNav'
import { FileIcon } from './icons'

interface Props {
  documents: SpecDocument[]
  onClose: () => void
}

const badgeClasses: Record<string, string> = {
  sets: 'pill-ok',
  context: 'pill-accent',
  none: 'pill-muted',
  unclassified: 'pill-muted',
}

export function DocumentsBrowser({ documents, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(documents[0]?.id ?? '')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState<PageInfo[]>([])

  useEffect(() => {
    if (selectedId) api.getDocumentPages(selectedId).then(setPages)
  }, [selectedId])

  const document = documents.find((d) => d.id === selectedId)
  const pageInfo = pages.find((p) => p.pdfPage === page)
  const relevant = pages.filter((p) => p.classification === 'sets')

  return (
    <Modal onClose={onClose} className="h-[92vh] max-w-4xl">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">Project documents</h2>
        <span className="text-sm text-muted">
          {documents.length} file{documents.length === 1 ? '' : 's'}
        </span>
        <button type="button" onClick={onClose} className="btn-outline ml-auto px-3 py-1.5 text-sm">
          Close
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-r border-line p-2">
          <ul className="space-y-1">
            {documents.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(d.id)
                    setPage(1)
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent-soft ${
                    d.id === selectedId ? 'bg-accent-soft' : ''
                  }`}
                >
                  <FileIcon size={17} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.filename}</span>
                    <span className="block text-xs text-muted">
                      {d.pageCount !== null ? `${d.pageCount} pages · ` : ''}
                      uploaded {new Date(d.uploadedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <PageNav page={page} pageCount={document?.pageCount ?? null} onChange={setPage} />
            {pageInfo && (
              <span className={badgeClasses[pageInfo.classification]}>
                {pageInfo.classification}
              </span>
            )}
            {relevant.length > 0 && (
              <span className="text-xs text-muted">
                hardware pages:{' '}
                {relevant.slice(0, 8).map((p, i) => (
                  <button
                    key={p.pdfPage}
                    type="button"
                    onClick={() => setPage(p.pdfPage)}
                    className="text-accent hover:underline"
                  >
                    {i > 0 ? ', ' : ''}
                    {p.pdfPage}
                  </button>
                ))}
                {relevant.length > 8 ? '…' : ''}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <img
              src={api.pageImageUrl(selectedId, page)}
              alt={`Page ${page}`}
              className="mx-auto max-h-full rounded border border-line"
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
