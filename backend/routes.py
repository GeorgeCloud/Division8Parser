"""Fresco backend — route logic.

Wire format is camelCase JSON matching frontend/src/types.ts (serializers.py).
Every data mutation logs a Correction and drops a 'reviewed' project back to
'edited'. Geometry rules live here for region edits: deletions and box
adoption are pure database/geometry operations; only genuinely new page area
triggers a scoped LLM call.
"""

import os
import shutil
import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, send_file

from config import LLM_MODEL, LLM_PROVIDER, UPLOAD_DIR
from extraction import MAX_MODEL_CONFIDENCE, _apply_field, new_id, start_extraction
from models import (
    DocumentPage,
    Correction,
    ExtractionRun,
    HardwareComponent,
    HardwareSet,
    Project,
    Region,
    SpecDocument,
    db,
)
from pdf_index import index_document, render_page
from classifier import context_reference_lines
from serializers import (
    component_to_dict,
    document_to_dict,
    page_to_dict,
    project_to_dict,
    set_to_dict,
)

api = Blueprint("api", __name__, url_prefix="/api")

SET_TEXT_FIELDS = {"setNumber": "set_number", "description": "description", "notes": "notes"}
COMPONENT_TEXT_FIELDS = {
    "unit": "unit",
    "description": "description",
    "catalogNumber": "catalog_number",
    "mfr": "mfr",
    "finish": "finish",
    "notes": "notes",
}


def utcnow():
    return datetime.now(timezone.utc)


def _touch(project: Project) -> None:
    """Data changed: bump updated_at; a finished project needs re-completion."""
    project.updated_at = utcnow()
    if project.status == "reviewed":
        project.status = "edited"


def _log(project_id, action, field_name=None, old=None, new=None, set_id=None, component_id=None):
    db.session.add(
        Correction(
            id=new_id(),
            project_id=project_id,
            set_id=set_id,
            component_id=component_id,
            action=action,
            field_name=field_name,
            old_value=None if old is None else str(old),
            new_value=None if new is None else str(new),
        )
    )


def _get_or_404(model, object_id):
    row = db.session.get(model, object_id)
    if row is None:
        return None
    return row


# ---------------------------------------------------------------- projects


@api.post("/project")
def create_project():
    name = (request.get_json(silent=True) or {}).get("name", "").strip()
    if not name:
        return jsonify(error="name is required"), 400
    project = Project(id=new_id(), name=name)
    db.session.add(project)
    db.session.commit()
    return jsonify(project_to_dict(project)), 201


@api.get("/projects")
def list_projects():
    projects = Project.query.order_by(Project.updated_at.desc()).all()
    return jsonify([project_to_dict(p) for p in projects])


@api.get("/project/<project_id>")
def get_project(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    return jsonify(project_to_dict(project))


@api.patch("/project/<project_id>")
def patch_project(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    data = request.get_json(silent=True) or {}
    if "name" in data and data["name"].strip():
        project.name = data["name"].strip()
        project.updated_at = utcnow()
    if data.get("status") == "reviewed":
        project.status = "reviewed"
        project.updated_at = utcnow()
    db.session.commit()
    return jsonify(project_to_dict(project))


@api.delete("/project/<project_id>")
def delete_project(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    document_ids = [d.id for d in project.documents]
    if document_ids:
        DocumentPage.query.filter(DocumentPage.document_id.in_(document_ids)).delete(
            synchronize_session=False
        )
    db.session.delete(project)
    db.session.commit()
    shutil.rmtree(os.path.join(UPLOAD_DIR, project_id), ignore_errors=True)
    return "", 204


# --------------------------------------------------------------- documents


@api.get("/project/<project_id>/documents")
def list_documents(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    return jsonify([document_to_dict(d) for d in project.documents])


@api.post("/project/<project_id>/upload")
def upload_documents(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404

    files = request.files.getlist("files")
    if not files:
        return jsonify(error="no files provided"), 400
    strategy = request.form.get("conflictStrategy")

    existing_by_name = {d.filename: d for d in project.documents}
    clash = next((f for f in files if os.path.basename(f.filename) in existing_by_name), None)
    if clash and strategy not in ("replace", "rename"):
        existing = existing_by_name[os.path.basename(clash.filename)]
        return jsonify(conflict=True, existing=document_to_dict(existing)), 409

    project_dir = os.path.join(UPLOAD_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)

    for upload in files:
        filename = os.path.basename(upload.filename)
        existing = existing_by_name.get(filename)
        if existing and strategy == "replace":
            DocumentPage.query.filter_by(document_id=existing.id).delete()
            if existing.stored_path and os.path.exists(existing.stored_path):
                os.remove(existing.stored_path)
            db.session.delete(existing)
            db.session.flush()
        elif existing and strategy == "rename":
            stem, dot, ext = filename.rpartition(".")
            counter = 2
            while f"{stem} ({counter}){dot}{ext}" in existing_by_name:
                counter += 1
            filename = f"{stem} ({counter}){dot}{ext}"

        stored_path = os.path.join(project_dir, f"{uuid.uuid4().hex[:8]}-{filename}")
        upload.save(stored_path)
        document = SpecDocument(
            id=new_id(),
            project_id=project_id,
            filename=filename,
            stored_path=stored_path,
        )
        db.session.add(document)
        db.session.flush()
        try:
            index_document(document, stored_path)
            document.status = "processing"
        except Exception:
            document.status = "failed"
        existing_by_name[filename] = document

    # a fresh extraction replaces all prior results for the project
    HardwareSet.query.filter_by(project_id=project_id).delete()
    run = ExtractionRun(
        id=new_id(),
        project_id=project_id,
        provider=LLM_PROVIDER,
        model=LLM_MODEL,
        prompt_version="v1",
    )
    db.session.add(run)
    project.status = "processing"
    project.updated_at = utcnow()
    db.session.commit()

    start_extraction(current_app._get_current_object(), project_id, run.id)
    return jsonify(conflict=False, runId=run.id), 202


@api.get("/document/<document_id>/pages")
def list_document_pages(document_id):
    """Per-page classification: which pages carry hardware sets, which are
    reference context, which are noise. Computed free at upload time."""
    document = _get_or_404(SpecDocument, document_id)
    if document is None:
        return jsonify(error="document not found"), 404
    pages = (
        DocumentPage.query.filter_by(document_id=document_id)
        .order_by(DocumentPage.pdf_page)
        .all()
    )
    return jsonify([page_to_dict(p) for p in pages])


@api.get("/document/<document_id>/page/<int:pdf_page>.png")
def page_image(document_id, pdf_page):
    document = _get_or_404(SpecDocument, document_id)
    if document is None or not document.stored_path:
        return jsonify(error="document not found"), 404
    if document.page_count and not 1 <= pdf_page <= document.page_count:
        return jsonify(error="page out of range"), 404
    path = render_page(document.stored_path, document_id, pdf_page)
    return send_file(path, mimetype="image/png", max_age=3600)


# -------------------------------------------------------------------- sets


@api.get("/project/<project_id>/sets")
def get_sets(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    ordered = sorted(project.sets, key=lambda s: s.order_index)
    return jsonify([set_to_dict(s) for s in ordered])


@api.post("/project/<project_id>/sets")
def add_set(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    latest_run = max(project.runs, key=lambda r: r.created_at, default=None)
    number = str(len(project.sets) + 1).zfill(2)
    hardware_set = HardwareSet(
        id=new_id(),
        project_id=project_id,
        run_id=latest_run.id if latest_run else None,
        order_index=len(project.sets),
        heading_raw="Added manually",
        set_number=number,
        set_number_confidence=100,
        set_number_verified=True,
        set_confidence=100,
    )
    db.session.add(hardware_set)
    _log(project_id, "add", set_id=hardware_set.id, new=number)
    _touch(project)
    db.session.commit()
    return jsonify(set_to_dict(hardware_set)), 201


@api.patch("/set/<set_id>")
def patch_set(set_id):
    hardware_set = _get_or_404(HardwareSet, set_id)
    if hardware_set is None:
        return jsonify(error="set not found"), 404
    data = request.get_json(silent=True) or {}

    if "notUsed" in data:
        _log(hardware_set.project_id, "edit", "notUsed", hardware_set.not_used,
             data["notUsed"], set_id=set_id)
        hardware_set.not_used = bool(data["notUsed"])
    elif "doors" in data:
        doors = [d for d in (data["doors"] or []) if str(d).strip()]
        _log(hardware_set.project_id, "edit", "doors", hardware_set.doors,
             doors or None, set_id=set_id)
        hardware_set.doors = doors or None
        hardware_set.doors_confidence = 100
        hardware_set.doors_verified = True
    elif data.get("field") in SET_TEXT_FIELDS:
        column = SET_TEXT_FIELDS[data["field"]]
        value = data.get("value")
        value = value.strip() if isinstance(value, str) and value.strip() else None
        _log(hardware_set.project_id, "edit", data["field"],
             getattr(hardware_set, column), value, set_id=set_id)
        setattr(hardware_set, column, value)
        setattr(hardware_set, f"{column}_confidence", 100)
        setattr(hardware_set, f"{column}_verified", True)
    else:
        return jsonify(error="unrecognized patch"), 400

    _touch(hardware_set.project)
    db.session.commit()
    return jsonify(set_to_dict(hardware_set))


@api.post("/set/<set_id>/confirm")
def confirm_set_field(set_id):
    hardware_set = _get_or_404(HardwareSet, set_id)
    if hardware_set is None:
        return jsonify(error="set not found"), 404
    field = (request.get_json(silent=True) or {}).get("field")
    if field == "doors":
        hardware_set.doors_confidence = 100
        hardware_set.doors_verified = True
    elif field in SET_TEXT_FIELDS:
        column = SET_TEXT_FIELDS[field]
        setattr(hardware_set, f"{column}_confidence", 100)
        setattr(hardware_set, f"{column}_verified", True)
    else:
        return jsonify(error="unrecognized field"), 400
    _log(hardware_set.project_id, "confirm", field, set_id=set_id)
    _touch(hardware_set.project)
    db.session.commit()
    return jsonify(set_to_dict(hardware_set))


@api.delete("/set/<set_id>")
def delete_set(set_id):
    hardware_set = _get_or_404(HardwareSet, set_id)
    if hardware_set is None:
        return jsonify(error="set not found"), 404
    project = hardware_set.project
    _log(project.id, "delete", old=hardware_set.set_number, set_id=set_id)
    db.session.delete(hardware_set)
    _touch(project)
    db.session.commit()
    return "", 204


@api.post("/set/<set_id>/split")
def split_set(set_id):
    hardware_set = _get_or_404(HardwareSet, set_id)
    if hardware_set is None:
        return jsonify(error="set not found"), 404
    at_index = (request.get_json(silent=True) or {}).get("atIndex")
    components = sorted(hardware_set.components, key=lambda c: c.order_index)
    if not isinstance(at_index, int) or not 0 < at_index < len(components):
        return jsonify(error="atIndex out of range"), 400

    moved = components[at_index:]
    new_set = HardwareSet(
        id=new_id(),
        project_id=hardware_set.project_id,
        run_id=hardware_set.run_id,
        order_index=hardware_set.order_index + 1,
        heading_raw=f"{hardware_set.heading_raw} (split)",
        set_number=f"{hardware_set.set_number or '?'}B",
        set_number_confidence=100,
        set_number_verified=True,
        set_confidence=hardware_set.set_confidence,
    )
    db.session.add(new_set)
    db.session.flush()

    # clone the regions the moved components live in, one per source region
    clones: dict[str, Region] = {}
    for component in moved:
        source = component.region
        if source is not None and source.id not in clones:
            clone = Region(
                id=new_id(), set_id=new_set.id, document_id=source.document_id,
                pdf_page=source.pdf_page, printed_page=source.printed_page,
                x0=source.x0, y0=source.y0, x1=source.x1, y1=source.y1,
                page_width=source.page_width, page_height=source.page_height,
                order_index=len(clones),
            )
            db.session.add(clone)
            clones[source.id] = clone
        component.set_id = new_set.id
        if source is not None:
            component.region_id = clones[source.id].id
    for index, component in enumerate(moved):
        component.order_index = index

    for other in hardware_set.project.sets:
        if other.id not in (hardware_set.id, new_set.id) and other.order_index > hardware_set.order_index:
            other.order_index += 1

    _log(hardware_set.project_id, "split", old=hardware_set.set_number,
         new=new_set.set_number, set_id=set_id)
    _touch(hardware_set.project)
    db.session.commit()
    return jsonify([set_to_dict(hardware_set), set_to_dict(new_set)])


# -------------------------------------------------------------- components


@api.patch("/component/<component_id>")
def patch_component(component_id):
    component = _get_or_404(HardwareComponent, component_id)
    if component is None:
        return jsonify(error="component not found"), 404
    data = request.get_json(silent=True) or {}
    field = data.get("field")
    value = data.get("value")
    project_id = component.set.project_id

    if field == "qty":
        new_qty = int(value) if value is not None and str(value).strip().isdigit() else None
        _log(project_id, "edit", "qty", component.qty, new_qty, component_id=component_id)
        component.qty = new_qty
        component.qty_confidence = 100
        component.qty_verified = True
    elif field in COMPONENT_TEXT_FIELDS:
        column = COMPONENT_TEXT_FIELDS[field]
        clean = value.strip() if isinstance(value, str) and value.strip() else None
        _log(project_id, "edit", field, getattr(component, column), clean,
             component_id=component_id)
        setattr(component, column, clean)
        setattr(component, f"{column}_confidence", 100)
        setattr(component, f"{column}_verified", True)
    else:
        return jsonify(error="unrecognized field"), 400

    _touch(component.set.project)
    db.session.commit()
    return jsonify(component_to_dict(component))


@api.post("/component/<component_id>/confirm")
def confirm_component_field(component_id):
    component = _get_or_404(HardwareComponent, component_id)
    if component is None:
        return jsonify(error="component not found"), 404
    field = (request.get_json(silent=True) or {}).get("field")
    if field == "qty":
        component.qty_confidence = 100
        component.qty_verified = True
    elif field in COMPONENT_TEXT_FIELDS:
        column = COMPONENT_TEXT_FIELDS[field]
        setattr(component, f"{column}_confidence", 100)
        setattr(component, f"{column}_verified", True)
    else:
        return jsonify(error="unrecognized field"), 400
    _log(component.set.project_id, "confirm", field, component_id=component_id)
    _touch(component.set.project)
    db.session.commit()
    return jsonify(component_to_dict(component))


# ----------------------------------------------------------------- regions


def _overlap_area(a, b) -> float:
    width = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    height = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    return max(0.0, width) * max(0.0, height)


@api.post("/set/<set_id>/regions")
def set_regions(set_id):
    """Replace the set's region list; diff old vs new by the cost rules:
    deletions and adoptions are free geometry, only new page area no old
    box covered triggers a scoped extraction call."""
    hardware_set = _get_or_404(HardwareSet, set_id)
    if hardware_set is None:
        return jsonify(error="set not found"), 404
    drafts = (request.get_json(silent=True) or {}).get("regions")
    if not isinstance(drafts, list) or not drafts:
        return jsonify(error="at least one region is required"), 400

    # validate: pages exist, boxes inside page bounds, no overlaps among drafts
    normalized = []
    for draft in drafts:
        page = db.session.get(DocumentPage, f'{draft.get("documentId")}:{draft.get("pdfPage")}')
        if page is None:
            return jsonify(error=f'unknown page {draft.get("pdfPage")}'), 400
        bbox = draft.get("bbox") or {}
        box = {k: float(bbox.get(k, -1)) for k in ("x0", "y0", "x1", "y1")}
        if not (0 <= box["x0"] < box["x1"] <= page.width and 0 <= box["y0"] < box["y1"] <= page.height):
            return jsonify(error="bbox outside page bounds"), 400
        normalized.append({"draft": draft, "page": page, "box": box})
    for i, a in enumerate(normalized):
        for b in normalized[i + 1:]:
            same_page = (
                a["draft"]["documentId"] == b["draft"]["documentId"]
                and a["draft"]["pdfPage"] == b["draft"]["pdfPage"]
            )
            if same_page and _overlap_area(a["box"], b["box"]) > 0:
                return jsonify(error="regions cannot overlap"), 400

    old_regions = {r.id: r for r in hardware_set.regions}
    old_boxes = [
        {"document_id": r.document_id, "pdf_page": r.pdf_page,
         "x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1}
        for r in hardware_set.regions
    ]
    kept_ids = {n["draft"].get("id") for n in normalized if n["draft"].get("id") in old_regions}
    deleted_ids = set(old_regions) - kept_ids

    # apply: update kept rows, create new rows
    final_regions: list[Region] = []
    new_rows: list[tuple[Region, dict]] = []
    for order_index, item in enumerate(normalized):
        draft, page, box = item["draft"], item["page"], item["box"]
        if draft.get("id") in kept_ids:
            row = old_regions[draft["id"]]
        else:
            row = Region(id=new_id(), set_id=set_id)
            db.session.add(row)
            new_rows.append((row, item))
        row.document_id = draft["documentId"]
        row.pdf_page = draft["pdfPage"]
        row.x0, row.y0, row.x1, row.y1 = box["x0"], box["y0"], box["x1"], box["y1"]
        row.page_width, row.page_height = page.width, page.height
        row.order_index = order_index
        final_regions.append(row)

    # cull: every mapped component is pure geometry — it survives iff its bbox
    # center lands inside a final box on its own document+page. Components with
    # no region or no bbox can't be placed on any page, so they are dropped.
    for component in list(hardware_set.components):
        source = old_regions.get(component.region_id)
        adopted = None
        if source is not None and component.x0 is not None:
            center_x = (component.x0 + component.x1) / 2
            center_y = (component.y0 + component.y1) / 2
            for row in final_regions:
                if (row.document_id == source.document_id
                        and row.pdf_page == source.pdf_page
                        and row.x0 <= center_x <= row.x1
                        and row.y0 <= center_y <= row.y1):
                    adopted = row
                    break
        if adopted is not None:
            # relationship write, not the FK column, so the old region's
            # backref lets go of the component before that region is deleted
            component.region = adopted
        else:
            db.session.delete(component)
    # adoptions must hit the database before the old regions are deleted;
    # deleting first makes SQLAlchemy null the re-pointed FKs mid-cascade
    db.session.flush()
    for region_id in deleted_ids:
        db.session.delete(old_regions[region_id])
    db.session.flush()
    db.session.expire(hardware_set, ["components"])

    # extraction only for new boxes whose area old boxes didn't cover
    reextracted = False
    for row, item in new_rows:
        box = item["box"]
        area = (box["x1"] - box["x0"]) * (box["y1"] - box["y0"])
        covered = sum(
            _overlap_area(box, old) for old in old_boxes
            if old["document_id"] == row.document_id and old["pdf_page"] == row.pdf_page
        )
        if area <= 0 or covered / area >= 0.9:
            continue
        if _extract_into_region(hardware_set, row, item["page"]):
            reextracted = True

    # a missing-set placeholder stops being missing once the user places it
    hardware_set.missing = False

    ordered = sorted(hardware_set.components,
                     key=lambda c: (c.region.pdf_page if c.region else 0, c.y0 or 0))
    for index, component in enumerate(ordered):
        component.order_index = index

    _log(hardware_set.project_id, "relocate", old=f"{len(old_boxes)} region(s)",
         new=f"{len(final_regions)} region(s)", set_id=set_id)
    _touch(hardware_set.project)
    db.session.commit()

    response = jsonify(set_to_dict(hardware_set))
    response.headers["X-Reextracted"] = "true" if reextracted else "false"
    return response


def _extract_into_region(hardware_set: HardwareSet, region: Region, page: DocumentPage) -> bool:
    """Scoped extraction: only the lines inside this one box, skipping lines
    that already back a surviving component of this set."""
    existing_centers = {
        round((component.y0 + component.y1) / 2)
        for component in hardware_set.components
        if component.y0 is not None and component.region is not None
        and component.region.document_id == region.document_id
        and component.region.pdf_page == region.pdf_page
    }
    lines = []
    for line in page.lines:
        center_y = (line["y0"] + line["y1"]) / 2
        center_x = (line["x0"] + line["x1"]) / 2
        inside = region.x0 <= center_x <= region.x1 and region.y0 <= center_y <= region.y1
        if inside and round(center_y) not in existing_centers:
            lines.append(line)
    if not lines:
        return False

    try:
        from llm import extract_assignments

        prefixed = [
            {"id": f"p{page.pdf_page}-{line['id']}", "text": line["text"]}
            for line in lines
        ]
        # attach bounded cross-reference context (legend/mfr/finish lines from
        # this document's 'context' pages) — same single call, extra context
        context_pages = DocumentPage.query.filter_by(
            document_id=region.document_id, classification="context"
        ).all()
        reference_lines = context_reference_lines(context_pages)
        result = extract_assignments(
            [{"pdf_page": page.pdf_page, "lines": prefixed}],
            # locating a flagged gap: tell the model which set it is looking at
            expected_set=hardware_set.set_number if hardware_set.missing else None,
            reference="\n".join(reference_lines) if reference_lines else None,
        )
    except Exception:
        current_app.logger.exception("region re-extraction failed")
        return False

    line_by_id = {f"p{page.pdf_page}-{line['id']}": line for line in lines}
    added = False
    for set_out in result.sets:
        for comp in set_out.components:
            line = line_by_id.get(comp.line_id)
            if line is None:
                continue
            component = HardwareComponent(
                id=new_id(), set_id=hardware_set.id, region_id=region.id,
                x0=line["x0"], y0=line["y0"], x1=line["x1"], y1=line["y1"],
            )
            qty_value = comp.qty.value
            component.qty = int(qty_value) if qty_value and qty_value.isdigit() else None
            component.qty_confidence = min(comp.qty.confidence, MAX_MODEL_CONFIDENCE)
            component.qty_raw = line["text"]
            for name in ("unit", "description", "catalog_number", "mfr", "finish", "notes"):
                _apply_field(component, name, getattr(comp, name), raw=line["text"])
            db.session.add(component)
            added = True
    return added


# ------------------------------------------------------------------ export


@api.get("/project/<project_id>/export")
def export_project(project_id):
    project = _get_or_404(Project, project_id)
    if project is None:
        return jsonify(error="project not found"), 404
    export_format = request.args.get("format", "json")
    # unresolved missing-set placeholders carry no data — exports skip them
    ordered = sorted(
        (s for s in project.sets if not s.missing), key=lambda s: s.order_index
    )
    slug = project.name.replace(" ", "_")

    if export_format == "flat":
        documents = {d.id: d.filename for d in project.documents}
        payload = [
            {
                "set_number": s.set_number,
                "description": s.description,
                "location": [
                    {
                        "document": documents.get(r.document_id),
                        "page": r.pdf_page,
                        "bbox": {"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1},
                    }
                    for r in s.regions
                ],
                "components": [
                    {
                        "qty": c.qty,
                        "description": c.description,
                        "catalog_number": c.catalog_number,
                        "mfr": c.mfr,
                        "finish": c.finish,
                        "notes": c.notes,
                    }
                    for c in s.components
                ],
            }
            for s in ordered
        ]
        response = jsonify(payload)
        response.headers["Content-Disposition"] = f'attachment; filename="{slug}_flat.json"'
        return response

    if export_format == "csv":
        rows = ["set_number,not_used,doors,qty,unit,description,catalog_number,mfr,finish,notes,page"]

        def quote(value):
            if value is None:
                return ""
            return '"' + str(value).replace('"', '""') + '"'

        for s in ordered:
            doors = " ".join(s.doors) if s.doors else None
            page = s.regions[0].pdf_page if s.regions else ""
            if not s.components:
                rows.append(",".join([quote(s.set_number), str(s.not_used), quote(doors),
                                      "", "", "", "", "", "", "", str(page)]))
            for c in s.components:
                rows.append(",".join([
                    quote(s.set_number), str(s.not_used), quote(doors),
                    "" if c.qty is None else str(c.qty), quote(c.unit),
                    quote(c.description), quote(c.catalog_number),
                    quote(c.mfr), quote(c.finish), quote(c.notes), str(page),
                ]))
        return current_app.response_class(
            "\n".join(rows), mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{slug}_components.csv"'},
        )

    payload = {
        "project": {"id": project.id, "name": project.name},
        "exportedAt": utcnow().isoformat(),
        "sets": [set_to_dict(s) for s in ordered],
    }
    response = jsonify(payload)
    response.headers["Content-Disposition"] = f'attachment; filename="{slug}_hardware_sets.json"'
    return response
