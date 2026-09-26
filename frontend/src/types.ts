// The shared contract, mirrored by the Flask backend (backend/serializers.py
// emits exactly these camelCase shapes). This file is the single source of
// truth for both sides.

/** Every extracted value carries confidence, source text, and provenance. */
export interface Field<T> {
  /** null = absent in the document, never guessed */
  value: T | null
  /** 0-100; model output is capped below 100 */
  confidence: number
  /** verbatim source line the value was read from */
  rawText: string | null
  /** true once a human edited or confirmed the field */
  verified: boolean
}

export type ProjectStatus = 'draft' | 'processing' | 'extracted' | 'reviewed' | 'edited'

export interface Project {
  id: string
  name: string
  ownerId: string
  status: ProjectStatus
  documentCount: number
  setCount: number
  latestRunId: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentStatus = 'uploaded' | 'processing' | 'extracted' | 'failed'

export interface SpecDocument {
  id: string
  projectId: string
  filename: string // identity key for the re-upload conflict check
  pageCount: number | null
  status: DocumentStatus
  uploadedAt: string
}

/** Per-page LLM classification: which pages carry sets, which are reference
 *  context, which are noise. */
export type PageClassification = 'unclassified' | 'sets' | 'context' | 'none'

export interface PageInfo {
  pdfPage: number
  width: number
  height: number
  classification: PageClassification
  signals: string[]
  hasTextLayer: boolean
}

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One drawn box on one page of one document, owned by a hardware set —
 *  the unit of location editing and incremental re-extraction. */
export interface Region {
  id: string
  setId: string
  documentId: string
  pdfPage: number // absolute, 1-based
  printedPage: string | null
  bbox: BBox // PDF points, origin top-left
  pageWidth: number
  pageHeight: number
  orderIndex: number
}

/** What the region editor sends: existing regions keep their id, new boxes
 *  have none. */
export interface RegionDraft {
  id?: string
  documentId: string
  pdfPage: number
  bbox: BBox
}

export interface HardwareComponent {
  id: string
  setId: string
  /** which drawn box this component was read from */
  regionId: string | null
  orderIndex: number
  /** the component's own row box on the page */
  bbox: BBox | null
  qty: Field<number>
  unit: Field<string>
  description: Field<string>
  catalogNumber: Field<string>
  mfr: Field<string>
  finish: Field<string>
  notes: Field<string>
}

export interface HardwareSet {
  id: string
  projectId: string
  runId: string | null
  orderIndex: number
  /** verbatim heading, e.g. "Hardware Group No. 01" */
  headingRaw: string
  setNumber: Field<string>
  description: Field<string>
  doors: Field<string[]>
  notes: Field<string>
  notUsed: boolean
  /** numbering-gap placeholder: the schedule's sequence references this set
   * but extraction found nothing — locate it (draw a box) or accept it */
  missing: boolean
  setConfidence: number
  regions: Region[]
  components: HardwareComponent[]
}

export type UploadResult =
  | { conflict: false; runId: string }
  | { conflict: true; existing: SpecDocument }

export type ConflictStrategy = 'replace' | 'rename'

export type SetTextField = 'setNumber' | 'description' | 'notes'
export type ComponentField =
  | 'qty'
  | 'unit'
  | 'description'
  | 'catalogNumber'
  | 'mfr'
  | 'finish'
  | 'notes'
