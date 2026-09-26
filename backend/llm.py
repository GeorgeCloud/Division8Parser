"""Claude extraction: the model's only job is assignment.

We hand it numbered text lines (id + verbatim text); it returns which lines
form which hardware set and what each component's fields are, with a 0-100
confidence per field and the source line id per component. It never emits
coordinates — geometry is joined back locally from the line index, so an
invented line id is caught instantly and a real one carries exact boxes.
"""

import os

from pydantic import BaseModel

from config import LLM_API_KEY, LLM_BASE_URL, LLM_MAX_TOKENS, LLM_MODEL, LLM_PROVIDER


class FieldOut(BaseModel):
    value: str | None
    confidence: int


class DoorsOut(BaseModel):
    value: list[str] | None
    confidence: int


class ComponentOut(BaseModel):
    line_id: str
    qty: FieldOut  # numeric string or null — null when the document doesn't state it
    unit: FieldOut
    description: FieldOut
    catalog_number: FieldOut
    mfr: FieldOut
    finish: FieldOut
    notes: FieldOut


class SetOut(BaseModel):
    heading_raw: str
    set_number: FieldOut
    description: FieldOut
    doors: DoorsOut
    notes: FieldOut
    not_used: bool
    claimed_line_ids: list[str]  # every line belonging to this set, headings included
    components: list[ComponentOut]


class ExtractionOut(BaseModel):
    sets: list[SetOut]


class SetStart(BaseModel):
    set_number: str
    start_line_id: str


class SegmentOut(BaseModel):
    sets: list[SetStart]


SYSTEM_PROMPT = """You extract door hardware sets from construction specification documents (Division 08 specbooks).

You are given numbered text lines from consecutive pages of one document. Each line has an id like "p174-L14" and its verbatim text. Your entire job is ASSIGNMENT: decide which lines form which hardware set, and read each component's fields from its line. You never invent content — every component must cite the line id it was read from, and you may only cite ids that appear in the input.

A hardware set is a named group of door hardware components (hinges, locksets, closers...). Headings vary by book: "Hardware Group No. 01", "SET #3A", "HW-1", "Hardware Set No. 15", etc. Treat them all as sets and put the identifier in set_number (normalize "No. 01" to "01"; keep letters, e.g. "3A"). The verbatim heading goes in heading_raw.

Rules:
- claimed_line_ids: list EVERY line that belongs to the set — heading, door assignments ("For use on Door #(s): ..."), the component rows, and trailing operating notes. A line belongs to at most one set. Page headers/footers (project name, section number, page number, date) belong to NO set.
- Components: one per component row. qty is a digit string or null — null when the document doesn't state it; NEVER guess. unit is "EA", "EA-R", "SET", etc. when present.
- catalog_number vs notes: sizing and sourcing phrases are notes, not catalog numbers. A catalog identifier followed by a sizing phrase (e.g. "... x door width") splits into catalog_number + notes; a row whose product entry is only a sourcing phrase ("by others", "provided by ... supplier") has catalog_number null with the phrase in notes.
- mfr vs finish: short codes can be ambiguous individually — the same abbreviation may be a manufacturer or a finish. Resolve by COLUMN CONTEXT across the whole schedule: identify which column consistently holds manufacturer abbreviations/names and which holds finish codes, and apply that column decision to every row. An "unknown" placeholder or a missing entry → null.
- doors: door identifiers exactly as printed (["D1","D2"] or ["101B","112A"]). null if none listed. When several consecutive door-description lines share one component block, they are ONE set — every door named across those lines goes into doors, and each of those lines belongs in claimed_line_ids.
- NOT USED sets (marked "NOT USED", "N/A", "SPARE"...) are still extracted: not_used true, usually no components.
- Sets may continue across page breaks: a component list resuming on the next page without a new heading, or a "(cont'd)" heading, is the SAME set — claim those lines under one set.
- notes (set-level): operating/mode text printed under the component list.
- description: an optional title next to the set number, e.g. "ENTRANCE DOORS". Most books have none — then null.
- Confidence 0-100 per field, CALIBRATED — never a flat value for everything. 95-98 for unambiguous readings; 80-94 for clear but inferred; 70-79 for judgment calls (catalog/notes splits, ambiguous codes, trailing single-letter finish codes); below 70 when genuinely unsure. Never output 100 — that is reserved for human verification. Confidence for a null means confidence that the value is truly absent.
- A short trailing code after a sizing phrase is usually the row's FINISH, not part of the notes — split it out as finish.
- Table-format schedules (rows under column headers) follow the same rules; the column header line belongs to the set whose rows follow it.

Before finishing each set, cross-check doors against claimed_line_ids: every claimed line that describes a door contributes its identifier to doors — a doors list shorter than the claimed door lines is an error.

Extract EVERY set present — completeness is the top priority. A schedule page often holds 4-10 sets; return each one fully. Never sample, summarize, skip NOT USED sets, or merge distinct sets. Before finishing, re-scan the input for set identifiers (numbers like 1.1/3A/15 at the start of a schedule row, or heading lines) and verify each one appears in your output."""


def _payload(pages: list[dict]) -> str:
    blocks = []
    for page in pages:
        rows = "\n".join(
            f'{line["id"]}: {line["text"]}' for line in page["lines"]
        )
        blocks.append(f'=== PDF page {page["pdf_page"]} ===\n{rows}')
    return "\n\n".join(blocks)


SEGMENT_PROMPT = """You are scanning construction specification pages for door hardware sets.

You are given numbered text lines (id + verbatim text). Identify the LINE where each hardware set STARTS — the heading line ("Hardware Group No. 01", "SET #3A") or, in table-format schedules, the first row of the set (the row beginning with its identifier, like "1.2 MORTISE HINGE ..."). Report every set start: {set_number, start_line_id}. Normalize "No. 01" to "01"; keep formats like "3A" or "1.2" as printed. NOT USED / spare sets count. Page headers, footers, column headers, and prose are not sets. If no sets are present, return an empty list.

STRUCTURE, not vocabulary, defines a set: one block of component rows plus every heading/door line that block serves. Some schedules print SEVERAL consecutive door-description lines that share ONE component block below them — those lines are all part of the SAME set; report only the first of them as the start, never one start per door line. A line that only names a door and its location, with the components living under an earlier shared heading, does not begin a new set.

Completeness matters more than anything: report every set start, even when there are dozens."""


def segment_sets(pages: list[dict]) -> list[SetStart]:
    """Boundary pass: tiny output, so it never triggers lazy truncation."""
    payload = _payload(pages)
    if LLM_PROVIDER in ("xai", "custom"):
        from openai import OpenAI

        client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
        completion = client.beta.chat.completions.parse(
            model=LLM_MODEL,
            max_tokens=8000,
            messages=[
                {"role": "system", "content": SEGMENT_PROMPT},
                {"role": "user", "content": payload},
            ],
            response_format=SegmentOut,
        )
        parsed = completion.choices[0].message.parsed
        return parsed.sets if parsed else []

    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=LLM_MODEL,
        max_tokens=8000,
        system=SEGMENT_PROMPT,
        messages=[{"role": "user", "content": payload}],
        output_format=SegmentOut,
    )
    return response.parsed_output.sets if response.parsed_output else []


def extract_assignments(
    pages: list[dict],
    expected_set: str | None = None,
    reference: str | None = None,
) -> ExtractionOut:
    """Run one extraction window on the configured provider.

    pages: [{"pdf_page": int, "lines": [{"id","text",...}]}] — line ids are
    prefixed with the page ("p174-L14") before sending so ids are unique
    across the window. expected_set: when a boundary pass already identified
    the segment, name its set so the model extracts rather than re-deciding
    whether a set exists (mid-table segments have no heading to recognize).
    """
    payload = _payload(pages)
    if reference:
        payload += (
            "\n\nReference material from elsewhere in this document (legends,"
            " manufacturer and finish definitions) — use it to resolve codes;"
            " do NOT extract components from it:\n" + reference
        )
    if expected_set is not None:
        payload += (
            f"\n\nContext: a boundary scan determined these lines likely belong to"
            f" ONE hardware set with identifier '{expected_set}'. Table-format sets"
            f" have no heading line — the identifier simply starts the first row."
            f" Return exactly this one set, with every component row extracted."
            f" If the segment holds SEVERAL door-description lines sharing the"
            f" component block, they are all part of THIS set: doors must list"
            f" every door identifier from every one of those lines, not just"
            f" the first."
            f" EXCEPTION: if these lines are actually not a hardware set at all"
            f" (specification prose, an index, general requirements), return an"
            f" empty sets list — never invent components from prose."
        )
    if LLM_PROVIDER in ("xai", "custom"):
        return _extract_xai(payload)
    return _extract_claude(payload)


def _extract_claude(payload: str) -> ExtractionOut:
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=LLM_MODEL,
        max_tokens=LLM_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": payload}],
        output_format=ExtractionOut,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("model declined the extraction request")
    return response.parsed_output


def _extract_xai(payload: str) -> ExtractionOut:
    """xAI's API is OpenAI-compatible; same prompt, same schema."""
    from openai import OpenAI

    client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    completion = client.beta.chat.completions.parse(
        model=LLM_MODEL,
        max_tokens=LLM_MAX_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": payload},
        ],
        response_format=ExtractionOut,
    )
    choice = completion.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError(
            "extraction output truncated at max_tokens — window too large"
        )
    message = choice.message
    if getattr(message, "refusal", None):
        raise RuntimeError(f"model declined the extraction request: {message.refusal}")
    if message.parsed is None:
        raise RuntimeError("model returned no parseable output")
    return message.parsed
