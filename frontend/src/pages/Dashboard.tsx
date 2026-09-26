// Project list + create. The single user owns every project.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, ProjectStatus } from '../types'
import { api } from '../api'
import { AlertDialog } from '../components/Modal'
import { ClipboardIcon, PlusIcon, TrashIcon, WarnIcon } from '../components/icons'
import { plural } from '../review'

const statusLabel: Record<ProjectStatus, { text: string; classes: string }> = {
  draft: { text: 'Awaiting upload', classes: 'pill-muted' },
  processing: { text: 'Extracting…', classes: 'pill-accent' },
  extracted: { text: 'Ready for review', classes: 'pill-ok' },
  reviewed: { text: 'Finished', classes: 'pill-ok' },
  edited: { text: 'Edits pending review', classes: 'pill-warn' },
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<Project | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.listProjects().then(setProjects)
  }, [])

  async function create() {
    if (!name.trim()) return
    const project = await api.createProject(name.trim())
    navigate(`/project/${project.id}`)
  }

  async function confirmDelete() {
    if (!deleting) return
    await api.deleteProject(deleting.id)
    setDeleting(null)
    setProjects(await api.listProjects())
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header className="flex flex-col items-center text-center">
        <p className="text-sm font-semibold text-accent">Fresco</p>
        <h1 className="mt-1 text-3xl font-bold">Hardware set extraction</h1>
        <p className="mt-2 text-muted">Upload a specbook, we pull every hardware set out of Division 08.</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn-primary mt-6 flex items-center gap-2"
        >
          <PlusIcon size={16} /> New project
        </button>
      </header>

      {creating && (
        <div className="card mt-6 flex gap-2 p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder="Project name — e.g. Forest Park School"
            className="input flex-1"
          />
          <button type="button" onClick={create} disabled={!name.trim()} className="btn-primary">
            Create
          </button>
        </div>
      )}

      <ul className="mt-8 space-y-3">
        {projects.map((project) => {
          const status = statusLabel[project.status]
          return (
            <li key={project.id} className="group relative">
              <Link
                to={`/project/${project.id}`}
                className="card flex items-center gap-4 px-5 py-4 transition-colors hover:border-accent"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <ClipboardIcon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {plural(project.documentCount, 'document')}
                    {project.setCount > 0 && ` · ${project.setCount} hardware sets`}
                  </span>
                </span>
                <span className={status.classes}>{status.text}</span>
              </Link>
              <button
                type="button"
                onClick={() => setDeleting(project)}
                title={`Delete ${project.name}`}
                className="absolute -right-2 -top-2 hidden rounded-full border border-line bg-white p-1.5 text-muted shadow-sm hover:text-danger group-hover:block"
              >
                <TrashIcon size={14} />
              </button>
            </li>
          )
        })}
        {projects.length === 0 && (
          <li className="empty-state">No projects yet. Create one and upload a specbook to get started.</li>
        )}
      </ul>

      {deleting && (
        <AlertDialog
          icon={<WarnIcon size={18} />}
          title={`Delete "${deleting.name}"?`}
          body="This removes the project, its uploaded documents, and every extracted hardware set. It can't be undone."
          onClose={() => setDeleting(null)}
          actions={[
            { label: 'Delete project', onClick: confirmDelete, variant: 'primary' },
            { label: 'Keep it', onClick: () => setDeleting(null), variant: 'ghost' },
          ]}
        />
      )}
    </div>
  )
}
