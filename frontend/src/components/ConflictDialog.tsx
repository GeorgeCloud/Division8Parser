// Shown when an upload's filename matches an existing document in the
// project (filename is the only identity check, per spec).

import type { SpecDocument } from '../types'
import { AlertDialog } from './Modal'
import { WarnIcon } from './icons'

interface Props {
  existing: SpecDocument
  onReplace: () => void
  onRename: () => void
  onCancel: () => void
}

export function ConflictDialog({ existing, onReplace, onRename, onCancel }: Props) {
  return (
    <AlertDialog
      icon={<WarnIcon size={18} />}
      title="This file is already in the project"
      body={`${existing.filename} was uploaded ${new Date(existing.uploadedAt).toLocaleDateString()}. Replace it if this version has pages the old one was missing, or keep both under a new name.`}
      onClose={onCancel}
      actions={[
        { label: 'Replace the old file and re-extract', onClick: onReplace, variant: 'primary' },
        { label: 'Keep both — rename the new upload', onClick: onRename },
        { label: 'Cancel upload', onClick: onCancel, variant: 'ghost' },
      ]}
    />
  )
}
