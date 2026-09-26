// HTTP implementation of the ApiClient contract against the Flask backend.
// The Vite dev server proxies /api to Flask (vite.config.ts).

import type {
  ComponentField,
  ConflictStrategy,
  HardwareComponent,
  HardwareSet,
  PageInfo,
  Project,
  RegionDraft,
  SetTextField,
  SpecDocument,
  UploadResult,
} from '../types'
import type { ApiClient } from './client'

const BASE = '/api'

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init)
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok && response.status !== 409) {
    throw new ApiError(response.status, body?.error ?? response.statusText)
  }
  return body as T
}

function json(method: string, payload?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }
}

export class HttpApiClient implements ApiClient {
  listProjects() {
    return request<Project[]>('/projects')
  }

  createProject(name: string) {
    return request<Project>('/project', json('POST', { name }))
  }

  getProject(id: string) {
    return request<Project>(`/project/${id}`)
  }

  renameProject(id: string, name: string) {
    return request<Project>(`/project/${id}`, json('PATCH', { name }))
  }

  markReviewed(id: string) {
    return request<Project>(`/project/${id}`, json('PATCH', { status: 'reviewed' }))
  }

  deleteProject(id: string) {
    return request<void>(`/project/${id}`, { method: 'DELETE' })
  }

  getDocuments(projectId: string) {
    return request<SpecDocument[]>(`/project/${projectId}/documents`)
  }

  getDocumentPages(documentId: string) {
    return request<PageInfo[]>(`/document/${documentId}/pages`)
  }

  async upload(projectId: string, files: File[], strategy?: ConflictStrategy): Promise<UploadResult> {
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    if (strategy) form.append('conflictStrategy', strategy)
    return request<UploadResult>(`/project/${projectId}/upload`, { method: 'POST', body: form })
  }

  pageImageUrl(documentId: string, pdfPage: number) {
    return `${BASE}/document/${documentId}/page/${pdfPage}.png`
  }

  getSets(projectId: string) {
    return request<HardwareSet[]>(`/project/${projectId}/sets`)
  }

  addSet(projectId: string) {
    return request<HardwareSet>(`/project/${projectId}/sets`, json('POST'))
  }

  patchSetField(setId: string, field: SetTextField, value: string | null) {
    return request<HardwareSet>(`/set/${setId}`, json('PATCH', { field, value }))
  }

  setDoors(setId: string, doors: string[]) {
    return request<HardwareSet>(`/set/${setId}`, json('PATCH', { doors }))
  }

  setNotUsed(setId: string, notUsed: boolean) {
    return request<HardwareSet>(`/set/${setId}`, json('PATCH', { notUsed }))
  }

  confirmSetField(setId: string, field: SetTextField | 'doors') {
    return request<HardwareSet>(`/set/${setId}/confirm`, json('POST', { field }))
  }

  async setRegions(setId: string, regions: RegionDraft[]) {
    const response = await fetch(`${BASE}/set/${setId}/regions`, json('POST', { regions }))
    const body = await response.json()
    if (!response.ok) throw new ApiError(response.status, body?.error ?? response.statusText)
    return {
      set: body as HardwareSet,
      reextracted: response.headers.get('X-Reextracted') === 'true',
    }
  }

  splitSet(setId: string, atIndex: number) {
    return request<[HardwareSet, HardwareSet]>(`/set/${setId}/split`, json('POST', { atIndex }))
  }

  deleteSet(setId: string) {
    return request<void>(`/set/${setId}`, { method: 'DELETE' })
  }

  patchComponentField(componentId: string, field: ComponentField, value: string | number | null) {
    return request<HardwareComponent>(`/component/${componentId}`, json('PATCH', { field, value }))
  }

  confirmComponentField(componentId: string, field: ComponentField) {
    return request<HardwareComponent>(`/component/${componentId}/confirm`, json('POST', { field }))
  }

  exportUrl(projectId: string, format: 'json' | 'csv' | 'flat') {
    return `${BASE}/project/${projectId}/export?format=${format}`
  }
}
