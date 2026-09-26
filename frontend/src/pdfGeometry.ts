// Shared geometry: converting PDF-point boxes to CSS-percent overlays, and
// small predicates the viewers and the region editor both use.

import type { CSSProperties } from 'react'
import type { BBox, Region } from './types'

export function bboxPercentStyle(bbox: BBox, pageWidth: number, pageHeight: number): CSSProperties {
  return {
    left: `${(bbox.x0 / pageWidth) * 100}%`,
    top: `${(bbox.y0 / pageHeight) * 100}%`,
    width: `${((bbox.x1 - bbox.x0) / pageWidth) * 100}%`,
    height: `${((bbox.y1 - bbox.y0) / pageHeight) * 100}%`,
  }
}

/** Strict interior intersection — boxes sharing only an edge don't overlap. */
export function overlaps(a: BBox, b: BBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

export function regionsOnPage(regions: Region[], documentId: string, pdfPage: number): Region[] {
  return regions.filter((r) => r.documentId === documentId && r.pdfPage === pdfPage)
}

/** Distinct (document, page) pairs a set spans, in reading order. */
export function pagesOf(regions: Region[]): { documentId: string; pdfPage: number }[] {
  const seen = new Set<string>()
  const out: { documentId: string; pdfPage: number }[] = []
  for (const region of regions) {
    const key = `${region.documentId}:${region.pdfPage}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ documentId: region.documentId, pdfPage: region.pdfPage })
    }
  }
  return out
}
