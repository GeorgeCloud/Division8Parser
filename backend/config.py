"""Environment-driven configuration."""

import os

from dotenv import load_dotenv

load_dotenv()


def _resolve_provider() -> str:
    explicit = os.environ.get("FRESCO_LLM_PROVIDER")
    if explicit:
        return explicit
    if os.environ.get("FRESCO_LLM_BASE_URL"):
        return "custom"  # any OpenAI-compatible endpoint: Ollama, Gemini, Groq...
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    if os.environ.get("XAI_API_KEY"):
        return "xai"
    return "claude"


# The LLM only ever assigns line IDs; geometry is always computed locally.
LLM_PROVIDER = _resolve_provider()
DEFAULT_MODELS = {"claude": "claude-opus-5", "xai": "grok-4-fast", "custom": "qwen2.5:14b"}
LLM_MODEL = os.environ.get("FRESCO_LLM_MODEL", DEFAULT_MODELS.get(LLM_PROVIDER, "grok-4-fast"))
# per-call output ceiling (billed only for tokens actually generated; this
# caps the worst case). Per-set calls produce ~500-2500 output tokens, and
# reasoning models count their thinking against this too.
LLM_MAX_TOKENS = int(os.environ.get("FRESCO_LLM_MAX_TOKENS", "8000"))

# OpenAI-compatible endpoint config ('xai' and 'custom' providers)
LLM_BASE_URL = os.environ.get(
    "FRESCO_LLM_BASE_URL", os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1")
)
LLM_API_KEY = (
    os.environ.get("FRESCO_LLM_API_KEY")
    or os.environ.get("XAI_API_KEY")
    or "not-needed"  # local endpoints like Ollama ignore the key
)

UPLOAD_DIR = os.environ.get("FRESCO_UPLOAD_DIR", "instance/uploads")
PAGE_CACHE_DIR = os.environ.get("FRESCO_PAGE_CACHE_DIR", "instance/pages")

# hard ceiling on LLM requests per extraction run — the run stops cleanly
# (keeping what it extracted) rather than overspending
MAX_LLM_CALLS_PER_RUN = int(os.environ.get("FRESCO_MAX_LLM_CALLS", "80"))

# page classification batching (one LLM call classifies this many pages,
# each truncated to this many lines) — cost knobs, change only with approval
CLASSIFY_BATCH_PAGES = int(os.environ.get("FRESCO_CLASSIFY_BATCH_PAGES", "20"))
CLASSIFY_MAX_LINES = int(os.environ.get("FRESCO_CLASSIFY_MAX_LINES", "40"))
