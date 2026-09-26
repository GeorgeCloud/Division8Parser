"""camelCase JSON serialization matching frontend/src/types.ts exactly."""

from models import HardwareComponent, HardwareSet, Project, Region, SpecDocument

SET_FIELDS = ("set_number", "description", "notes")
COMPONENT_FIELDS = ("unit", "description", "catalog_number", "mfr", "finish", "notes")


def _field(row, name: str) -> dict:
    return {
        "value": getattr(row, name),
        "confidence": getattr(row, f"{name}_confidence"),
        "rawText": getattr(row, f"{name}_raw"),
        "verified": getattr(row, f"{name}_verified"),
    }


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def project_to_dict(project: Project) -> dict:
    latest_run = max(project.runs, key=lambda r: r.created_at, default=None)
    return {
        "id": project.id,
        "name": project.name,
        "ownerId": project.owner_id,
        "status": project.status,
        "documentCount": len(project.documents),
        "setCount": len(project.sets),
        "latestRunId": latest_run.id if latest_run else None,
        "createdAt": project.created_at.isoformat(),
        "updatedAt": project.updated_at.isoformat(),
    }


def page_to_dict(page) -> dict:
    return {
        "pdfPage": page.pdf_page,
        "width": page.width,
        "height": page.height,
        "classification": page.classification,
        "signals": page.signals,
        "hasTextLayer": page.has_text_layer,
    }


def document_to_dict(document: SpecDocument) -> dict:
    return {
        "id": document.id,
        "projectId": document.project_id,
        "filename": document.filename,
        "pageCount": document.page_count,
        "status": document.status,
        "uploadedAt": document.uploaded_at.isoformat(),
    }


def region_to_dict(region: Region) -> dict:
    return {
        "id": region.id,
        "setId": region.set_id,
        "documentId": region.document_id,
        "pdfPage": region.pdf_page,
        "printedPage": region.printed_page,
        "bbox": {"x0": region.x0, "y0": region.y0, "x1": region.x1, "y1": region.y1},
        "pageWidth": region.page_width,
        "pageHeight": region.page_height,
        "orderIndex": region.order_index,
    }


def component_to_dict(component: HardwareComponent) -> dict:
    data = {
        "id": component.id,
        "setId": component.set_id,
        "regionId": component.region_id,
        "orderIndex": component.order_index,
        "qty": {
            "value": component.qty,
            "confidence": component.qty_confidence,
            "rawText": component.qty_raw,
            "verified": component.qty_verified,
        },
        "bbox": (
            {"x0": component.x0, "y0": component.y0, "x1": component.x1, "y1": component.y1}
            if component.x0 is not None
            else None
        ),
    }
    for name in COMPONENT_FIELDS:
        data[_camel(name)] = _field(component, name)
    return data


def set_to_dict(hardware_set: HardwareSet) -> dict:
    data = {
        "id": hardware_set.id,
        "projectId": hardware_set.project_id,
        "runId": hardware_set.run_id,
        "orderIndex": hardware_set.order_index,
        "headingRaw": hardware_set.heading_raw,
        "notUsed": hardware_set.not_used,
        "missing": hardware_set.missing,
        "setConfidence": hardware_set.set_confidence,
        "doors": {
            "value": hardware_set.doors,
            "confidence": hardware_set.doors_confidence,
            "rawText": hardware_set.doors_raw,
            "verified": hardware_set.doors_verified,
        },
        "regions": [region_to_dict(r) for r in hardware_set.regions],
        "components": [component_to_dict(c) for c in hardware_set.components],
    }
    for name in SET_FIELDS:
        data[_camel(name)] = _field(hardware_set, name)
    return data
