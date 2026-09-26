"""Extraction orchestration: candidate pages → windows → LLM assignment →
validation + geometry join → persistence.

Validation is the anti-hallucination layer: a component citing a line id
that doesn't exist is dropped; a line claimed by two sets stays with the
first. Geometry never comes from the model — component boxes are their
lines' boxes, region boxes are the per-page union of a set's claimed lines.
"""

import logging
import threading
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from classifier import candidate_pages, classify_document
from config import MAX_LLM_CALLS_PER_RUN
from llm import ExtractionOut, extract_assignments, segment_sets
from models import (
    DocumentPage,
    ExtractionRun,
    HardwareComponent,
    HardwareSet,
    Project,
    Region,
    SpecDocument,
    db,
)

log = logging.getLogger("fresco.extraction")

# small windows: dense schedule pages produce a lot of structured output per
# page, and models under-extract when one response must carry too much
MAX_WINDOW_PAGES = 3
WINDOW_OVERLAP = 1


def new_id() -> str:
    return uuid.uuid4().hex[:24]


class CallBudget:
    """Thread-safe per-run request ceiling. When exhausted, remaining
    segments are skipped and the run completes with what it has."""

    def __init__(self, limit: int):
        self.limit = limit
        self.used = 0
        self._lock = threading.Lock()

    def take(self) -> bool:
        with self._lock:
            if self.used >= self.limit:
                return False
            self.used += 1
            return True


def start_extraction(app, project_id: str, run_id: str) -> None:
    """Spawn the extraction in a background thread (single-user scale; a
    real deployment would use a work queue)."""
    thread = threading.Thread(
        target=_run, args=(app, project_id, run_id), daemon=True
    )
    thread.start()


def _run(app, project_id: str, run_id: str) -> None:
    with app.app_context():
        run = db.session.get(ExtractionRun, run_id)
        project = db.session.get(Project, project_id)
        run.status = "running"
        db.session.commit()
        try:
            budget = CallBudget(MAX_LLM_CALLS_PER_RUN)
            sets = _extract_project(project, budget)
            log.info("run %s used %d LLM calls", run_id, budget.used)
            _persist(project, run, sets)
            run.status = "complete"
            project.status = "extracted"
        except Exception:
            log.exception("extraction failed for project %s", project_id)
            db.session.rollback()
            run = db.session.get(ExtractionRun, run_id)
            project = db.session.get(Project, project_id)
            run.status = "failed"
            # documents remain; the project returns to awaiting-upload state
            project.status = "draft"
        db.session.commit()


def _extract_project(project: Project, budget: CallBudget) -> list[dict]:
    """Classify pages (LLM), then extract from the 'sets' pages only."""
    merged: list[dict] = []
    for document in project.documents:
        pages = (
            DocumentPage.query.filter_by(document_id=document.id)
            .order_by(DocumentPage.pdf_page)
            .all()
        )
        classify_document(pages, budget)
        for window in _windows(candidate_pages(pages)):
            result = _extract_window(document, window, budget)
            for extracted in result:
                _merge(merged, extracted)
    return merged


def _windows(pages: list) -> list[list]:
    """Group consecutive candidate pages; cap window size with a one-page
    overlap so sets spanning a window boundary appear whole in one of them."""
    if not pages:
        return []
    runs: list[list] = [[pages[0]]]
    for page in pages[1:]:
        if page.pdf_page - runs[-1][-1].pdf_page <= 1:
            runs[-1].append(page)
        else:
            runs.append([page])

    windows = []
    for run_pages in runs:
        start = 0
        while start < len(run_pages):
            windows.append(run_pages[start : start + MAX_WINDOW_PAGES])
            if start + MAX_WINDOW_PAGES >= len(run_pages):
                break
            start += MAX_WINDOW_PAGES - WINDOW_OVERLAP
    return windows


MAX_SEGMENT_LINES = 80
SEGMENT_WORKERS = 4


def _extract_window(document: SpecDocument, window: list, budget: CallBudget) -> list[dict]:
    """Two-stage window extraction.

    Stage 1 (boundary pass): the model + a regex scan find every set-start
    line — a tiny output that never triggers lazy truncation. Segmentation
    between starts is then deterministic. Stage 2: each segment is extracted
    in its own small call (parallelized), so per-response output stays well
    inside what models produce reliably.
    """
    line_index: dict[str, dict] = {}
    payload = []
    ordered_ids: list[str] = []
    for page in window:
        rows = []
        for line in page.lines:
            line_id = f"p{page.pdf_page}-{line['id']}"
            line_index[line_id] = {
                "line": line,
                "pdf_page": page.pdf_page,
                "page": page,
            }
            rows.append({"id": line_id, "text": line["text"]})
            ordered_ids.append(line_id)
        payload.append({"pdf_page": page.pdf_page, "lines": rows})

    # boundary pass: the LLM identifies every set-start line (tiny output —
    # never triggers lazy truncation). No pattern matching anywhere.
    starts: dict[str, object] = {}
    if budget.take():
        try:
            for start in segment_sets(payload):
                starts.setdefault(start.start_line_id, start)
        except Exception:
            log.exception("boundary pass failed for window")
    position = {line_id: index for index, line_id in enumerate(ordered_ids)}
    ordered_starts = sorted(
        (s for s in starts.values() if s.start_line_id in position),
        key=lambda s: position[s.start_line_id],
    )
    if not ordered_starts:
        return []

    segments = []
    for index, start in enumerate(ordered_starts):
        begin = position[start.start_line_id]
        end = (
            position[ordered_starts[index + 1].start_line_id]
            if index + 1 < len(ordered_starts)
            else len(ordered_ids)
        )
        segment_ids = ordered_ids[begin : min(end, begin + MAX_SEGMENT_LINES)]
        by_page: dict[int, list[dict]] = defaultdict(list)
        for line_id in segment_ids:
            entry = line_index[line_id]
            by_page[entry["pdf_page"]].append(
                {"id": line_id, "text": entry["line"]["text"]}
            )
        segments.append(
            (
                start.set_number,
                [{"pdf_page": page, "lines": by_page[page]} for page in sorted(by_page)],
            )
        )

    def run_segment(segment):
        set_number, segment_pages = segment
        if not budget.take():
            log.warning("LLM call budget exhausted; skipping segment %s", set_number)
            return ExtractionOut(sets=[])
        try:
            result = extract_assignments(segment_pages, expected_set=set_number)
            if not result.sets:
                log.warning("segment %s returned no sets", set_number)
            return result
        except Exception:
            log.exception("segment %s extraction failed", set_number)
            return ExtractionOut(sets=[])

    with ThreadPoolExecutor(max_workers=SEGMENT_WORKERS) as pool:
        results = list(pool.map(run_segment, segments))

    combined = ExtractionOut(sets=[s for result in results for s in result.sets])
    return normalize_sets(combined, document, line_index)


def normalize_sets(
    result: ExtractionOut, document: SpecDocument, line_index: dict
) -> list[dict]:
    """Validate assignments against the line index and derive all geometry."""
    claimed: set[str] = set()
    sets = []
    for set_out in result.sets:
        lines = [
            lid for lid in set_out.claimed_line_ids
            if lid in line_index and lid not in claimed
        ]
        dropped = len(set_out.claimed_line_ids) - len(lines)
        if dropped:
            log.warning(
                "set %s: %d invalid/duplicate line ids dropped",
                set_out.set_number.value, dropped,
            )
        claimed.update(lines)

        components = []
        for comp in set_out.components:
            entry = line_index.get(comp.line_id)
            if entry is None or comp.line_id not in lines:
                log.warning(
                    "component cites unknown/unclaimed line %s — dropped",
                    comp.line_id,
                )
                continue
            line = entry["line"]
            components.append(
                {
                    "out": comp,
                    "pdf_page": entry["pdf_page"],
                    "raw": line["text"],
                    "bbox": (line["x0"], line["y0"], line["x1"], line["y1"]),
                }
            )

        # region per page: union of the set's claimed line boxes on that page
        by_page: dict[int, list[dict]] = defaultdict(list)
        for lid in lines:
            entry = line_index[lid]
            by_page[entry["pdf_page"]].append(entry)
        regions = []
        for pdf_page in sorted(by_page):
            entries = by_page[pdf_page]
            page = entries[0]["page"]
            boxes = [e["line"] for e in entries]
            regions.append(
                {
                    "document_id": document.id,
                    "pdf_page": pdf_page,
                    "x0": min(b["x0"] for b in boxes) - 4,
                    "y0": min(b["y0"] for b in boxes) - 4,
                    "x1": max(b["x1"] for b in boxes) + 4,
                    "y1": max(b["y1"] for b in boxes) + 4,
                    "page_width": page.width,
                    "page_height": page.height,
                }
            )
        if not regions:
            continue  # a set with no valid lines is a hallucination — drop

        sets.append(
            {
                "out": set_out,
                "document_id": document.id,
                "lines": set(lines),
                "pages": sorted(by_page),
                "regions": regions,
                "components": components,
            }
        )
    return sets


def _merge(merged: list[dict], extracted: dict) -> None:
    """Fold a set from one window into the accumulated list. Windows overlap
    by one page, so the same set can appear twice; sets can also continue
    across windows."""
    for existing in merged:
        same_doc = existing["document_id"] == extracted["document_id"]
        same_number = (
            existing["out"].set_number.value == extracted["out"].set_number.value
        )
        overlapping = bool(existing["lines"] & extracted["lines"])
        adjacent = (
            extracted["pages"][0] - existing["pages"][-1] <= 1
            and extracted["pages"][0] >= existing["pages"][0]
        )
        if same_doc and same_number and (overlapping or adjacent):
            known = {c["out"].line_id for c in existing["components"]}
            existing["components"] += [
                c for c in extracted["components"] if c["out"].line_id not in known
            ]
            new_lines = extracted["lines"] - existing["lines"]
            existing["lines"] |= extracted["lines"]
            known_pages = set(existing["pages"])
            for region in extracted["regions"]:
                if region["pdf_page"] not in known_pages:
                    existing["regions"].append(region)
            existing["pages"] = sorted(known_pages | set(extracted["pages"]))
            if new_lines:
                existing["regions"].sort(key=lambda r: r["pdf_page"])
            return
    merged.append(extracted)


def _persist(project: Project, run: ExtractionRun, sets: list[dict]) -> None:
    """Replace the project's sets with this run's results, in document order."""
    HardwareSet.query.filter_by(project_id=project.id).delete()
    db.session.flush()

    sets.sort(
        key=lambda e: (e["document_id"], e["pages"][0], e["regions"][0]["y0"])
    )
    rows_with_doc: list[tuple[str, HardwareSet]] = []
    for entry in sets:
        out = entry["out"]
        set_row = HardwareSet(
            id=new_id(),
            project_id=project.id,
            run_id=run.id,
            heading_raw=out.heading_raw,
            not_used=out.not_used,
        )
        rows_with_doc.append((entry["document_id"], set_row))
        _apply_field(set_row, "set_number", out.set_number, raw=out.heading_raw)
        _apply_field(set_row, "description", out.description)
        _apply_field(set_row, "notes", out.notes)
        set_row.doors = out.doors.value
        set_row.doors_confidence = min(out.doors.confidence, MAX_MODEL_CONFIDENCE)

        confidences = [out.set_number.confidence]
        db.session.add(set_row)

        region_rows = []
        for region_index, region in enumerate(entry["regions"]):
            region_row = Region(
                id=new_id(),
                set_id=set_row.id,
                document_id=region["document_id"],
                pdf_page=region["pdf_page"],
                x0=region["x0"], y0=region["y0"],
                x1=region["x1"], y1=region["y1"],
                page_width=region["page_width"],
                page_height=region["page_height"],
                order_index=region_index,
            )
            db.session.add(region_row)
            region_rows.append(region_row)

        entry["components"].sort(key=lambda c: (c["pdf_page"], c["bbox"][1]))
        for comp_index, comp in enumerate(entry["components"]):
            comp_out = comp["out"]
            region_row = next(
                (r for r in region_rows if r.pdf_page == comp["pdf_page"]), None
            )
            comp_row = HardwareComponent(
                id=new_id(),
                set_id=set_row.id,
                region_id=region_row.id if region_row else None,
                order_index=comp_index,
                x0=comp["bbox"][0], y0=comp["bbox"][1],
                x1=comp["bbox"][2], y1=comp["bbox"][3],
            )
            qty_value = comp_out.qty.value
            comp_row.qty = int(qty_value) if qty_value and qty_value.isdigit() else None
            comp_row.qty_confidence = min(comp_out.qty.confidence, MAX_MODEL_CONFIDENCE)
            comp_row.qty_raw = comp["raw"]
            for name in ("unit", "description", "catalog_number", "mfr", "finish", "notes"):
                _apply_field(comp_row, name, getattr(comp_out, name), raw=comp["raw"])
                confidences.append(getattr(comp_out, name).confidence)
            confidences.append(comp_out.qty.confidence)
            db.session.add(comp_row)

        set_row.set_confidence = round(sum(confidences) / len(confidences))

    _flag_numbering_gaps(project, run, rows_with_doc)


def _leading_int(value) -> int | None:
    digits = ""
    for ch in str(value or "").strip():
        if not ch.isdigit():
            break
        digits += ch
    return int(digits) if digits else None


def _flag_numbering_gaps(
    project: Project, run: ExtractionRun, rows_with_doc: list[tuple[str, HardwareSet]]
) -> None:
    """Schedules number their sets; a hole in the sequence usually means an
    extraction miss. Create a red-flagged placeholder per hole so the user can
    locate the set (drawing its box) or accept that it is genuinely absent.
    Suffixed numbers ("3A") cover their integer; non-numeric numbers are
    ignored. Only holes strictly between a document's lowest and highest
    number are flagged — nothing is invented beyond the ends."""
    by_doc: dict[str, list[tuple[int, int]]] = {}
    for index, (document_id, row) in enumerate(rows_with_doc):
        number = _leading_int(row.set_number)
        if number is not None:
            by_doc.setdefault(document_id, []).append((number, index))

    inserts: list[tuple[int, HardwareSet]] = []
    for document_id, numbered in by_doc.items():
        covered = {n for n, _ in numbered}
        gaps = [n for n in range(min(covered) + 1, max(covered)) if n not in covered]
        # more holes than found sets means the numbering isn't a sequence
        # (e.g. one stray "999") — flagging would flood the UI with phantoms
        if not gaps or len(gaps) > len(covered):
            continue
        for gap in gaps:
            placeholder = HardwareSet(
                id=new_id(),
                project_id=project.id,
                run_id=run.id,
                heading_raw="",
                missing=True,
                set_number=str(gap),
            )
            db.session.add(placeholder)
            after = max(i for n, i in numbered if n < gap)
            inserts.append((after, placeholder))

    ordered = [row for _, row in rows_with_doc]
    for after, placeholder in sorted(
        inserts, key=lambda item: (item[0], _leading_int(item[1].set_number)),
        reverse=True,
    ):
        ordered.insert(after + 1, placeholder)
    for order_index, row in enumerate(ordered):
        row.order_index = order_index


# values models sometimes emit instead of null, despite instructions
UNKNOWN_SENTINELS = {"UNK", "UNKNOWN", "N/A", "NA", "-", "--", "TBD"}
# 100 is reserved for human verification; model output is capped below it
MAX_MODEL_CONFIDENCE = 98
UNKNOWN_CONFIDENCE = 72


def _apply_field(row, name: str, field_out, raw: str | None = None) -> None:
    value = field_out.value
    confidence = min(field_out.confidence, MAX_MODEL_CONFIDENCE)
    if isinstance(value, str) and value.strip().upper() in UNKNOWN_SENTINELS:
        value = None
        confidence = min(confidence, UNKNOWN_CONFIDENCE)
    setattr(row, name, value)
    setattr(row, f"{name}_confidence", confidence)
    setattr(row, f"{name}_raw", raw if raw is not None else field_out.value)
