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

/**
 * The API surface, implemented by HttpApiClient against Flask:
 *
 *   listProjects          GET    /api/projects
 *   createProject         POST   /api/project
 *   getProject            GET    /api/project/{id}
 *   renameProject         PATCH  /api/project/{id}
 *   markReviewed          PATCH  /api/project/{id}
 *   deleteProject         DELETE /api/project/{id}
 *   getDocuments          GET    /api/project/{id}/documents
 *   getDocumentPages      GET    /api/document/{id}/pages
 *   upload                POST   /api/project/{id}/upload   (triggers extraction)
 *   pageImageUrl          GET    /api/document/{id}/page/{n}.png
 *   getSets               GET    /api/project/{id}/sets
 *   addSet                POST   /api/project/{id}/sets
 *   patchSetField/doors/notUsed   PATCH /api/set/{id}
 *   confirmSetField       POST   /api/set/{id}/confirm
 *   setRegions            POST   /api/set/{id}/regions
 *   splitSet              POST   /api/set/{id}/split
 *   deleteSet             DELETE /api/set/{id}
 *   patchComponentField   PATCH  /api/component/{id}
 *   confirmComponentField POST   /api/component/{id}/confirm
 *   exportUrl             GET    /api/project/{id}/export?format=...
 */
export interface ApiClient {
  listProjects(): Promise<Project[]>
  createProject(name: string): Promise<Project>
  getProject(id: string): Promise<Project>
  renameProject(id: string, name: string): Promise<Project>
  markReviewed(id: string): Promise<Project>
  deleteProject(id: string): Promise<void>

  getDocuments(projectId: string): Promise<SpecDocument[]>
  getDocumentPages(documentId: string): Promise<PageInfo[]>
  /** Stores files, then starts extraction over the whole project. Without a
   *  strategy, a filename match returns a conflict result. */
  upload(projectId: string, files: File[], strategy?: ConflictStrategy): Promise<UploadResult>
  /** URL of the rendered page image (served by the backend). */
  pageImageUrl(documentId: string, pdfPage: number): string

  getSets(projectId: string): Promise<HardwareSet[]>
  addSet(projectId: string): Promise<HardwareSet>
  patchSetField(setId: string, field: SetTextField, value: string | null): Promise<HardwareSet>
  setDoors(setId: string, doors: string[]): Promise<HardwareSet>
  setNotUsed(setId: string, notUsed: boolean): Promise<HardwareSet>
  /** Confirm a set field is correct as extracted — blanks included. */
  confirmSetField(setId: string, field: SetTextField | 'doors'): Promise<HardwareSet>
  /** Replace the set's region list; the server diffs old vs new — deletions
   *  and adoptions are free, only new page area triggers re-extraction. */
  setRegions(setId: string, regions: RegionDraft[]): Promise<{ set: HardwareSet; reextracted: boolean }>
  splitSet(setId: string, atIndex: number): Promise<[HardwareSet, HardwareSet]>
  deleteSet(setId: string): Promise<void>

  patchComponentField(
    componentId: string,
    field: ComponentField,
    value: string | number | null,
  ): Promise<HardwareComponent>
  confirmComponentField(componentId: string, field: ComponentField): Promise<HardwareComponent>

  exportUrl(projectId: string, format: 'json' | 'csv' | 'flat'): string
}
