# Fresco — Hardware Set Extraction

Upload Division 08 specbook PDFs, and Fresco extracts every hardware set — components, doors, page locations, and a confidence score on each field — into a reviewable UI with JSON/CSV export.

## Prerequisites

- **Python 3.12+**
- **Node 20+**
- **Database: nothing to install.** Fresco uses SQLite, which ships with Python. The database file is created automatically at `backend/instance/fresco.db` the first time the backend starts.
- An **xAI API key** (extraction runs on grok-4-fast by default). Other providers work too — see the table below.

## 1. Backend (Flask, port 5001)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Create `backend/.env` with the key for whichever provider you're using — the
backend auto-detects it:

```
# xAI (default — grok-4-fast)
XAI_API_KEY=xai-...

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# any OpenAI-compatible endpoint (Ollama, Groq, Gemini, LM Studio, ...)
FRESCO_LLM_BASE_URL=http://localhost:11434/v1
FRESCO_LLM_API_KEY=...        # omit for local endpoints like Ollama
FRESCO_LLM_MODEL=...          # that endpoint's model name
```

Only one is needed. If more than one is set, precedence is: `FRESCO_LLM_BASE_URL`
(custom endpoint), then `ANTHROPIC_API_KEY`, then `XAI_API_KEY` — or pin it
explicitly with `FRESCO_LLM_PROVIDER=xai|claude|custom`.

Start it:

```bash
.venv/bin/python app.py
```

## 2. Frontend (React + Vite, port 5173)

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to the Flask backend automatically.

## 3. Use it

Open **http://localhost:5173**, create a project, and upload one or more spec PDFs. Uploading triggers extraction; when it finishes, review the sets, fix anything flagged (confidence under 80 gets a chip), and export from the final step.

> Note: extraction makes LLM API calls — a typical schedule costs a few cents on the default model.

## Optional configuration

Set these in `backend/.env` only if you want to change the defaults:

| Variable | Purpose |
| --- | --- |
| `FRESCO_LLM_MODEL` | Model name (default `grok-4-fast`) |
| `FRESCO_LLM_PROVIDER` | Force `xai`, `claude`, or `custom` (otherwise inferred from which key is set) |
| `FRESCO_LLM_BASE_URL` + `FRESCO_LLM_API_KEY` | Any OpenAI-compatible endpoint (Ollama, Groq, Gemini, ...) |
| `ANTHROPIC_API_KEY` | Use Claude instead of xAI |
| `FRESCO_MAX_LLM_CALLS` | Per-run LLM call ceiling (default 80) |
