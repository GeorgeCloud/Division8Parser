// Drag & drop upload area: dashed border, centered icon, staged file rows.
// Holds real File objects for multipart upload.

import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { CheckIcon, FileIcon, UploadIcon } from './icons'

interface Props {
  staged: File[]
  onFiles: (files: File[]) => void
}

export function FileDropzone({ staged, onFiles }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith('.pdf'),
    )
    if (files.length) onFiles(files)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`dropzone ${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-black/[0.02]'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-col items-center gap-2 py-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-line/60 text-muted">
          <UploadIcon size={22} />
        </span>
        <p className="text-lg font-semibold">Drag &amp; drop files or folders</p>
        <p className="text-sm text-muted">or click to browse</p>
      </div>

      {staged.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {staged.map((file) => (
            <li key={file.name} className="card flex items-center gap-3 px-4 py-3.5">
              <FileIcon size={20} className="text-accent" />
              <span className="flex-1 truncate text-[15px]">{file.name}</span>
              <span className="flex size-6 items-center justify-center rounded-full bg-ok text-white">
                <CheckIcon size={14} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
