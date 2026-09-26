"""PDF text-layer indexing and page rendering.

The PDF is opened exactly once in its life — at upload — to build the line
index (every line of text with its exact coordinates, from the file's own
drawing instructions). Everything downstream works from the stored index.
Page images are rendered on demand and cached.
"""

import os

import pdfplumber
import pypdfium2 as pdfium

from config import PAGE_CACHE_DIR
from models import DocumentPage, db

# group words into a line when their tops are within this many points
LINE_TOLERANCE = 3.0
RENDER_SCALE = 150 / 72  # 150 DPI


def index_document(document, stored_path: str) -> int:
    """Parse every page into DocumentPage rows. Returns the page count."""
    with pdfplumber.open(stored_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            words = page.extract_words()
            lines = _group_into_lines(words)
            db.session.add(
                DocumentPage(
                    id=f"{document.id}:{page_number}",
                    document_id=document.id,
                    pdf_page=page_number,
                    width=float(page.width),
                    height=float(page.height),
                    has_text_layer=bool(lines),
                    lines=lines,
                    # classification happens in the extraction run — by the
                    # LLM, always (see classifier.py)
                    classification="unclassified",
                )
            )
        page_count = len(pdf.pages)
    document.page_count = page_count
    return page_count


def _group_into_lines(words: list[dict]) -> list[dict]:
    """Cluster word boxes into text lines, top-to-bottom, left-to-right."""
    buckets: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for bucket in buckets:
            if abs(bucket[0]["top"] - word["top"]) <= LINE_TOLERANCE:
                bucket.append(word)
                break
        else:
            buckets.append([word])

    lines = []
    for index, bucket in enumerate(sorted(buckets, key=lambda b: b[0]["top"])):
        bucket.sort(key=lambda w: w["x0"])
        lines.append(
            {
                "id": f"L{index}",
                "text": " ".join(w["text"] for w in bucket),
                "x0": round(min(w["x0"] for w in bucket), 1),
                "y0": round(min(w["top"] for w in bucket), 1),
                "x1": round(max(w["x1"] for w in bucket), 1),
                "y1": round(max(w["bottom"] for w in bucket), 1),
            }
        )
    return lines


def render_page(stored_path: str, document_id: str, pdf_page: int) -> str:
    """Render one page to PNG (cached). Returns the file path."""
    os.makedirs(PAGE_CACHE_DIR, exist_ok=True)
    out_path = os.path.join(PAGE_CACHE_DIR, f"{document_id}-{pdf_page}.png")
    if not os.path.exists(out_path):
        pdf = pdfium.PdfDocument(stored_path)
        try:
            page = pdf[pdf_page - 1]
            page.render(scale=RENDER_SCALE).to_pil().save(out_path)
        finally:
            pdf.close()
    return out_path
