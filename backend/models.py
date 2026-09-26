"""Fresco backend — data models only (attributes + relations, no logic).

Mirrors the frontend contract in frontend/src/types.ts under the region
architecture:

  Project -> SpecDocument[] -> (pages served on demand)
          -> ExtractionRun[]
          -> HardwareSet[] -> Region[] -> HardwareComponent[]
          -> Correction[]   (append-only audit log)

Conventions carried over from the frontend contract:
- Every extracted value is a "Field": value + confidence (0-100) +
  raw_text (verbatim source) + verified (a human confirmed/edited it).
  Stored as wide columns (<name>, <name>_confidence, <name>_raw, <name>_verified)
  by design — decided over EAV earlier.
- A Region is one user-visible box drawn on one page of one document; a set
  may span many regions across pages/documents. Components remember which
  region they were read from plus their own row bbox, which is what makes
  incremental re-extraction diffs possible.
- Wire format is camelCase (matching types.ts); models stay snake_case and
  serialization happens in the logic phase.
"""

from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Allowed enum-ish values (kept as strings to match the TS unions).
PROJECT_STATUSES = ("draft", "processing", "extracted", "reviewed", "edited")
DOCUMENT_STATUSES = ("uploaded", "processing", "extracted", "failed")
RUN_STATUSES = ("queued", "running", "complete", "failed")
CORRECTION_ACTIONS = ("edit", "confirm", "add", "delete", "split", "relocate")


class Project(db.Model):
    __tablename__ = "projects"

    id = db.Column(db.String(36), primary_key=True)
    name = db.Column(db.Text, nullable=False)
    # single-user app: the uploader owns the project
    owner_id = db.Column(db.String(36), nullable=False, default="user-default")
    status = db.Column(db.String(16), nullable=False, default="draft")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    documents = db.relationship(
        "SpecDocument", back_populates="project", cascade="all, delete-orphan"
    )
    runs = db.relationship(
        "ExtractionRun", back_populates="project", cascade="all, delete-orphan"
    )
    sets = db.relationship(
        "HardwareSet", back_populates="project", cascade="all, delete-orphan"
    )
    corrections = db.relationship(
        "Correction", back_populates="project", cascade="all, delete-orphan"
    )


class SpecDocument(db.Model):
    __tablename__ = "documents"

    id = db.Column(db.String(36), primary_key=True)
    project_id = db.Column(
        db.String(36), db.ForeignKey("projects.id"), nullable=False, index=True
    )
    # filename is the only identity key for the re-upload conflict check
    filename = db.Column(db.Text, nullable=False)
    stored_path = db.Column(db.Text, nullable=True)
    page_count = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(16), nullable=False, default="uploaded")
    uploaded_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    project = db.relationship("Project", back_populates="documents")
    regions = db.relationship("Region", back_populates="document")


class DocumentPage(db.Model):
    """The parsed text layer of one page: every line with its exact bbox.

    Built once at upload. This is what makes coordinates deterministic — the
    LLM references line ids from here and never emits geometry — and what
    makes user-drawn boxes extractable later without reopening the PDF.
    """

    __tablename__ = "document_pages"

    id = db.Column(db.String(48), primary_key=True)  # f"{document_id}:{pdf_page}"
    document_id = db.Column(
        db.String(36), db.ForeignKey("documents.id"), nullable=False, index=True
    )
    pdf_page = db.Column(db.Integer, nullable=False)  # 1-based
    width = db.Column(db.Float, nullable=False)
    height = db.Column(db.Float, nullable=False)
    has_text_layer = db.Column(db.Boolean, nullable=False, default=True)
    # [{"id": "L14", "text": "...", "x0": .., "y0": .., "x1": .., "y1": ..}, ...]
    lines = db.Column(db.JSON, nullable=False, default=list)
    # one primary label ('unclassified' | 'sets' | 'context' | 'none') plus
    # tags — assigned by the LLM classifier (classifier.py), never by
    # pattern matching
    classification = db.Column(db.String(16), nullable=False, default="unclassified")
    signals = db.Column(db.JSON, nullable=False, default=list)


class ExtractionRun(db.Model):
    __tablename__ = "extraction_runs"

    id = db.Column(db.String(36), primary_key=True)
    project_id = db.Column(
        db.String(36), db.ForeignKey("projects.id"), nullable=False, index=True
    )
    provider = db.Column(db.String(32), nullable=False)  # claude | openai | grok
    model = db.Column(db.Text, nullable=False)
    prompt_version = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="queued")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    project = db.relationship("Project", back_populates="runs")
    sets = db.relationship("HardwareSet", back_populates="run")


class HardwareSet(db.Model):
    __tablename__ = "hardware_sets"

    id = db.Column(db.String(36), primary_key=True)
    project_id = db.Column(
        db.String(36), db.ForeignKey("projects.id"), nullable=False, index=True
    )
    run_id = db.Column(
        db.String(36), db.ForeignKey("extraction_runs.id"), nullable=True, index=True
    )
    order_index = db.Column(db.Integer, nullable=False, default=0)
    # verbatim heading, e.g. "Hardware Group No. 01"
    heading_raw = db.Column(db.Text, nullable=False, default="")
    not_used = db.Column(db.Boolean, nullable=False, default=False)
    # placeholder for a numbering gap: the schedule references this set number
    # but extraction found nothing — the user locates it or accepts the gap
    missing = db.Column(db.Boolean, nullable=False, default=False)
    set_confidence = db.Column(db.Integer, nullable=False, default=0)

    # Field: set_number
    set_number = db.Column(db.Text, nullable=True)
    set_number_confidence = db.Column(db.Integer, nullable=False, default=0)
    set_number_raw = db.Column(db.Text, nullable=True)
    set_number_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: description (optional heading, e.g. "ENTRANCE DOORS")
    description = db.Column(db.Text, nullable=True)
    description_confidence = db.Column(db.Integer, nullable=False, default=0)
    description_raw = db.Column(db.Text, nullable=True)
    description_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: doors (JSON list of door ids, e.g. ["D1", "D2"])
    doors = db.Column(db.JSON, nullable=True)
    doors_confidence = db.Column(db.Integer, nullable=False, default=0)
    doors_raw = db.Column(db.Text, nullable=True)
    doors_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: notes (mode-of-operation text under the component list)
    notes = db.Column(db.Text, nullable=True)
    notes_confidence = db.Column(db.Integer, nullable=False, default=0)
    notes_raw = db.Column(db.Text, nullable=True)
    notes_verified = db.Column(db.Boolean, nullable=False, default=False)

    project = db.relationship("Project", back_populates="sets")
    run = db.relationship("ExtractionRun", back_populates="sets")
    regions = db.relationship(
        "Region",
        back_populates="set",
        cascade="all, delete-orphan",
        order_by="Region.order_index",
    )
    components = db.relationship(
        "HardwareComponent",
        back_populates="set",
        cascade="all, delete-orphan",
        order_by="HardwareComponent.order_index",
    )


class Region(db.Model):
    """One drawn box on one page of one document, owned by a hardware set.

    The unit of location editing and of incremental re-extraction: deleting a
    region drops exactly its components; a new region only pays for page area
    no prior region covered.
    """

    __tablename__ = "regions"

    id = db.Column(db.String(36), primary_key=True)
    set_id = db.Column(
        db.String(36), db.ForeignKey("hardware_sets.id"), nullable=False, index=True
    )
    document_id = db.Column(
        db.String(36), db.ForeignKey("documents.id"), nullable=False, index=True
    )
    pdf_page = db.Column(db.Integer, nullable=False)  # absolute, 1-based
    printed_page = db.Column(db.Text, nullable=True)  # display label, e.g. "Page 6"
    # bbox in PDF points, origin top-left — required: a region IS a box
    x0 = db.Column(db.Float, nullable=False)
    y0 = db.Column(db.Float, nullable=False)
    x1 = db.Column(db.Float, nullable=False)
    y1 = db.Column(db.Float, nullable=False)
    page_width = db.Column(db.Float, nullable=False, default=612.0)
    page_height = db.Column(db.Float, nullable=False, default=792.0)
    order_index = db.Column(db.Integer, nullable=False, default=0)

    set = db.relationship("HardwareSet", back_populates="regions")
    document = db.relationship("SpecDocument", back_populates="regions")
    components = db.relationship("HardwareComponent", back_populates="region")


class HardwareComponent(db.Model):
    __tablename__ = "components"

    id = db.Column(db.String(36), primary_key=True)
    set_id = db.Column(
        db.String(36), db.ForeignKey("hardware_sets.id"), nullable=False, index=True
    )
    # which drawn box this component was read from (null for manual additions)
    region_id = db.Column(
        db.String(36), db.ForeignKey("regions.id"), nullable=True, index=True
    )
    order_index = db.Column(db.Integer, nullable=False, default=0)

    # the component's own row box on the page (PDF points, top-left origin)
    x0 = db.Column(db.Float, nullable=True)
    y0 = db.Column(db.Float, nullable=True)
    x1 = db.Column(db.Float, nullable=True)
    y1 = db.Column(db.Float, nullable=True)

    # Field: qty (null = not stated in the document, never guessed)
    qty = db.Column(db.Integer, nullable=True)
    qty_confidence = db.Column(db.Integer, nullable=False, default=0)
    qty_raw = db.Column(db.Text, nullable=True)
    qty_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: unit ("EA", "EA-R", ...)
    unit = db.Column(db.Text, nullable=True)
    unit_confidence = db.Column(db.Integer, nullable=False, default=0)
    unit_raw = db.Column(db.Text, nullable=True)
    unit_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: description ("CONT. HINGE")
    description = db.Column(db.Text, nullable=True)
    description_confidence = db.Column(db.Integer, nullable=False, default=0)
    description_raw = db.Column(db.Text, nullable=True)
    description_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: catalog_number ("112XY")
    catalog_number = db.Column(db.Text, nullable=True)
    catalog_number_confidence = db.Column(db.Integer, nullable=False, default=0)
    catalog_number_raw = db.Column(db.Text, nullable=True)
    catalog_number_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: mfr ("IVE") — resolved against finish by column context
    mfr = db.Column(db.Text, nullable=True)
    mfr_confidence = db.Column(db.Integer, nullable=False, default=0)
    mfr_raw = db.Column(db.Text, nullable=True)
    mfr_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: finish ("711", "BLK", "US26D")
    finish = db.Column(db.Text, nullable=True)
    finish_confidence = db.Column(db.Integer, nullable=False, default=0)
    finish_raw = db.Column(db.Text, nullable=True)
    finish_verified = db.Column(db.Boolean, nullable=False, default=False)

    # Field: notes ("x door width", "BY OTHERS")
    notes = db.Column(db.Text, nullable=True)
    notes_confidence = db.Column(db.Integer, nullable=False, default=0)
    notes_raw = db.Column(db.Text, nullable=True)
    notes_verified = db.Column(db.Boolean, nullable=False, default=False)

    set = db.relationship("HardwareSet", back_populates="components")
    region = db.relationship("Region", back_populates="components")


class Correction(db.Model):
    """Append-only audit log of human review actions.

    Doubles as ground-truth labels for measuring and improving extraction.
    Exactly one of set_id / component_id is expected for field-level actions;
    structural actions (add/delete/split/relocate) reference the set.
    """

    __tablename__ = "corrections"

    id = db.Column(db.String(36), primary_key=True)
    project_id = db.Column(
        db.String(36), db.ForeignKey("projects.id"), nullable=False, index=True
    )
    set_id = db.Column(db.String(36), db.ForeignKey("hardware_sets.id"), nullable=True)
    component_id = db.Column(db.String(36), db.ForeignKey("components.id"), nullable=True)
    action = db.Column(db.String(16), nullable=False)  # one of CORRECTION_ACTIONS
    field_name = db.Column(db.String(32), nullable=True)  # null for structural actions
    old_value = db.Column(db.Text, nullable=True)
    new_value = db.Column(db.Text, nullable=True)
    corrected_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    project = db.relationship("Project", back_populates="corrections")
