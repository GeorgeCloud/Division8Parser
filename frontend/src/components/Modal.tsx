// Shared modal shell: backdrop, dialog semantics, Escape to close.

import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  onClose?: () => void
  className?: string
  children: ReactNode
}

export function Modal({ onClose, className = 'max-w-md p-6', children }: ModalProps) {
  useEffect(() => {
    if (!onClose) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className={`modal ${className}`}>{children}</div>
    </div>
  )
}

export interface AlertAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
}

interface AlertDialogProps {
  icon?: ReactNode
  title: string
  body: string
  actions: AlertAction[]
  onClose?: () => void
}

const actionClasses = {
  primary: 'btn-primary py-2.5',
  secondary: 'btn-outline py-2.5',
  ghost: 'btn-ghost',
}

export function AlertDialog({ icon, title, body, actions, onClose }: AlertDialogProps) {
  return (
    <Modal onClose={onClose}>
      <div className="flex items-start gap-3">
        {icon && <span className="medallion-warn">{icon}</span>}
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={actionClasses[action.variant ?? 'secondary']}
          >
            {action.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}
