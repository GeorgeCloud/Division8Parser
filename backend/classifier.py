"""LLM page classification — the model decides, always.

Every page is classified by the LLM (no regex, no keyword search): does this
page contain or reference hardware set information — door hardware groupings,
finishes, manufacturers, or a schedule/cross-reference that points to that
data? Pages are batched per call and each page's text is truncated, so cost
is bounded and configurable (see config: CLASSIFY_BATCH_PAGES,
CLASSIFY_MAX_LINES).

Results persist on DocumentPage: one primary classification + tags.
"""

import logging
import os
from typing import Literal

from pydantic import BaseModel

from config import (
    CLASSIFY_BATCH_PAGES,
    CLASSIFY_MAX_LINES,
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MAX_TOKENS,
    LLM_MODEL,
    LLM_PROVIDER,
)
from models import db

log = logging.getLogger("fresco.classifier")


class PageClass(BaseModel):
    pdf_page: int
    classification: Literal["sets", "context", "none"]
    tags: list[str]


class ClassifyOut(BaseModel):
    pages: list[PageClass]


CLASSIFY_PROMPT = """You classify pages of construction specification documents for a door hardware extraction system.

For EACH page given, answer: does this page contain or reference hardware set information — door hardware groupings, finishes, manufacturers, or a schedule or cross-reference that points to that data?

Classify each page as exactly one of:
- "sets" — the page CONTAINS actual hardware set content: hardware set/group headings with component listings, or hardware schedule table rows assigning components to sets. These pages are extraction targets.
- "context" — the page does not contain sets but DEFINES or REFERENCES related data useful for interpreting them: finish codes or finish schedules, manufacturer lists or abbreviations, keying/cylinder requirements, legends, door schedules, or cross-references pointing to the hardware schedule or Division 08 sections.
- "none" — nothing on the page helps understand hardware sets (unrelated trades, general conditions, other divisions).

Also give each page short lowercase tags describing WHAT it carries, chosen from: door_groupings, schedule, finishes, manufacturers, keying, legend, cross_reference, door_schedule, spec_prose. Use only tags that apply; a page can have several.

Return one entry per input page, same pdf_page numbers. Judge by meaning, not keywords — numbered spec prose (e.g. "2.3 HINGES" paragraphs describing requirements) is "context" if it defines hardware-relevant data, never "sets" unless actual set groupings/schedule rows are present."""


def _page_text(page) -> str:
    lines = page.lines[:CLASSIFY_MAX_LINES]
    return "\n".join(line["text"] for line in lines)


def _classify_batch(batch: list) -> ClassifyOut:
    payload = "\n\n".join(
        f"=== PDF page {page.pdf_page} ===\n{_page_text(page)}" for page in batch
    )
    if LLM_PROVIDER in ("xai", "custom"):
        from openai import OpenAI

        client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
        completion = client.beta.chat.completions.parse(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            messages=[
                {"role": "system", "content": CLASSIFY_PROMPT},
                {"role": "user", "content": payload},
            ],
            response_format=ClassifyOut,
        )
        parsed = completion.choices[0].message.parsed
        return parsed if parsed else ClassifyOut(pages=[])

    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=LLM_MODEL,
        max_tokens=LLM_MAX_TOKENS,
        system=CLASSIFY_PROMPT,
        messages=[{"role": "user", "content": payload}],
        output_format=ClassifyOut,
    )
    return response.parsed_output if response.parsed_output else ClassifyOut(pages=[])


def classify_document(pages: list, budget) -> None:
    """Classify every not-yet-classified page of one document, in batches.
    Each batch is one LLM call, taken from the run's call budget."""
    pending = [p for p in pages if p.has_text_layer and p.classification == "unclassified"]
    for start in range(0, len(pending), CLASSIFY_BATCH_PAGES):
        batch = pending[start : start + CLASSIFY_BATCH_PAGES]
        if not budget.take():
            log.warning("call budget exhausted; %d pages left unclassified", len(pending) - start)
            return
        try:
            result = _classify_batch(batch)
        except Exception:
            log.exception("classification batch failed")
            continue
        by_page = {entry.pdf_page: entry for entry in result.pages}
        for page in batch:
            entry = by_page.get(page.pdf_page)
            if entry is None:
                log.warning("page %d missing from classification response", page.pdf_page)
                continue
            page.classification = entry.classification
            page.signals = entry.tags
        db.session.commit()


def candidate_pages(pages: list) -> list:
    """Pages the extraction stage pays to process."""
    return [
        page
        for page in sorted(pages, key=lambda p: p.pdf_page)
        if page.has_text_layer and page.classification == "sets"
    ]


def context_reference_lines(pages: list, cap: int = 40) -> list[str]:
    """Bounded cross-reference block from LLM-tagged context pages —
    prioritizes pages tagged with definitional content."""
    priority = ("legend", "manufacturers", "finishes")
    ranked = sorted(
        (p for p in pages if p.classification == "context"),
        key=lambda p: (0 if any(t in (p.signals or []) for t in priority) else 1, p.pdf_page),
    )
    collected: list[str] = []
    for page in ranked:
        for line in page.lines:
            collected.append(line["text"])
            if len(collected) >= cap:
                return collected
    return collected
