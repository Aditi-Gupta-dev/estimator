# EVA RAG Service

Backend for the Calibre EVA chatbot. FastAPI + LangChain, proxied through
`upload-server` at `/api/eva` and `/api/eva/plan`, the same way
`estimator_agents` is proxied at `/api/score`. See
`../../EVA_RAG_IMPLEMENTATION_PLAN.md` for the full design.

## Setup

```bash
cd backend/eva_service
pip install -r requirements.txt
cp .env.example .env
# fill in OPENAI_API_KEY or GROQ_API_KEY in .env
```

## Run

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8001
```

## One-time backfill of the existing KnowledgeHub corpus

New uploads are ingested automatically via a webhook from `upload-server`.
Files that predate that webhook need a one-time backfill:

```bash
python scripts/bulk_ingest.py
```

Idempotent — safe to re-run; unchanged documents are skipped via content
hash.

## Tests

```bash
pytest tests/
```

## Endpoints

- `GET /health` — service status, document/embedded-chunk counts.
- `POST /internal/ingest` — internal only, called by `upload-server`'s
  `/api/upload` handler after a new file lands on disk. Not proxied to the
  frontend.
- `POST /api/eva/plan` — retrieval planner (Phase 2).
- `POST /api/eva` — chat (Phase 3+).

## Design notes

- **No upfront embedding.** Ingestion (webhook or `bulk_ingest.py`) converts
  documents to Markdown and registers metadata + chunks in SQLite —
  `chunk_embeddings` stays empty until a real query's intent selects a
  document as a candidate. See `src/retrieval/embed_on_demand.py`.
- **Dual embedding spaces.** OpenAI (corporate network) and local
  sentence-transformers (home network / Groq) embeddings are namespaced
  separately in both SQLite (`chunk_embeddings.embedding_provider`) and on
  disk (`data/faiss_indexes/{provider}__{model}/`) — switching networks
  never corrupts or forces a full re-embed of the other space.
- **`OPENAI_SSL_INSECURE`** disables TLS certificate verification for the
  OpenAI client to work around a corporate proxy's TLS interception. This is
  an explicit, insecure, user-acknowledged choice — off by default, logged
  loudly at startup when on, never silently active.
