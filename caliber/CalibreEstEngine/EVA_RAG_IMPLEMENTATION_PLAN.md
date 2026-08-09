# EVA RAG Chatbot Backend — Implementation Plan

## Context

EVA (the Calibre chatbot) currently exists only as frontend scaffolding: a fully-written system prompt (`eva-system-prompt.js`, v2.0, rules R1–R8 covering grounding/citation/abstention/role-gating/provenance), a fully-written retrieval planner (`eva-retrieval-planner.js`), and a chat hook (`useEVA.js`) that fakes all of it with keyword matching and a `setTimeout`. The code comments in `useEVA.js` explicitly say what's missing: a real `/api/eva` (and `/api/eva/plan`) backend.

The user wants that backend built with LangChain, using OpenAI (corporate key, behind an SSL-intercepting proxy) or Groq (home network) as the LLM, SQLite + FAISS for storage, and — the core ask — an ingestion/retrieval design that avoids embedding the entire `KnowledgeHub` corpus upfront. Instead: convert docs to Markdown + JSON metadata at ingest time, extract query intent first, use that to metadata-filter candidate documents in SQLite, and only embed those candidates (lazily, cached thereafter). On top of that, a semantic cache of past Q&A should short-circuit repeat questions, and proven cache entries should get promoted back into the retrievable knowledge base ("RAG learns from cache").

Two research agents mapped the existing frontend contract and backend conventions before this plan was drafted, and surfaced two real inconsistencies in the existing code worth fixing along the way (see below). The user was also asked and made two explicit calls: **SSL verification will be fully disabled (`verify=False`)** for the OpenAI path (acknowledged insecure, user's choice — gated behind an explicit env flag, not a silent default), and **embeddings follow the active provider** (OpenAI embeddings when OpenAI is active, local `sentence-transformers` when Groq is active) rather than always being local.

This repo also contains `backend/Oracle_Fusion_Local_AI_Strategy_1.docx`, which mandates a fully on-prem/local AI stack ("no external LLM APIs without DPO/Legal sign-off"). This plan uses OpenAI/Groq cloud APIs per the user's explicit, informed instruction — flagged here for awareness, not blocking implementation.

### Two existing bugs to fix while porting (small, additive)
1. `eva-retrieval-planner.js` `UNIT_IDS` (line 50) is missing `cyber`, `ai`, `datacloud` — real BU folders that exist on disk and in `business-units.js`. Fix in both the JS source and the Python port.
2. `eva-system-prompt.js` `RESTRICTED_ROLES = ['estimator', 'senior_management']` (line 44) uses `senior_management`, but the canonical role id everywhere else (`roles.js`, `RoleContext`) is `senior_mgmt` — so R5's rate-card restriction currently never matches Senior Management. Worse, `roles.js`'s `PERMISSIONS['eva.ratecards']` (line 149) grants **all five roles**, directly contradicting R5's own prose. **Decision: the backend treats R5/`RESTRICTED_ROLES` (normalized to `senior_mgmt`) as authoritative and more restrictive than `eva.ratecards`**, which is reinterpreted as "may use EVA at all," not "may see rate figures." Also fix the JS constant's typo as a one-line change.

---

## Architecture

New standalone Python 3.10 FastAPI + LangChain service at **`backend/eva_service/`**, mirroring the existing `estimator_agents` pattern exactly (own `requirements.txt`, own `src/`, run via `uvicorn src.main:app --host 0.0.0.0 --port 8001`), proxied through `backend/upload-server/index.js` the same way `/api/score` proxies to `estimator_agents`. This keeps Node as the single frontend-facing gateway (zero new concepts for the frontend/proxy layer) and keeps this service's very different dependency stack (langchain/faiss/sentence-transformers) isolated from `estimator_agents`' (xgboost/shap/sklearn).

```
backend/eva_service/
  requirements.txt  .env.example  README.md
  src/
    main.py                        # FastAPI app, CORS, router registration, startup hooks, APScheduler
    config.py                      # Settings: env var reads (mirrors JS process.env.X || default)
    providers/
      llm_factory.py               # get_llm() -> OpenAI (verify=False gated) | Groq
      embedding_factory.py         # get_embeddings() -> (Embeddings, provider_key)
    ingestion/
      converters.py                # docx/pdf/pptx -> markdown (markitdown); xlsx/csv -> custom sheet-aware converter
      chunker.py                   # heading-based (docx) / sheet-based (xlsx) chunking, per RAG_Architecture_Guide.docx
      registrar.py                 # upsert into `documents`, content_hash diffing (idempotent)
      pipeline.py                  # ingest_document(original_path, sidecar_path) -> document_id
      access_roles.py              # derive_access_roles(document_class, subdivision) -> list[str]
    storage/
      db.py                        # SQLAlchemy engine/session (SQLite file)
      models.py                    # Document, Chunk, ChunkEmbedding, CacheLog, ChatSession, ChatMessage
      faiss_manager.py             # FaissIndexManager — per (provider, model) namespace, IndexIDMap2
    retrieval/
      planner.py                   # ported EVA_PLANNER_PROMPT + validate/parse/fallback (1:1 from JS)
      candidate_selector.py        # SQLite metadata pre-filter — pure SQL, no vector math
      embed_on_demand.py           # ensure_embedded() — lazy embed + content_hash cache check
      retriever.py                 # cosine top-k over the (small) candidate matrix only
      role_gate.py                 # ported R5 second-line filter
    generation/
      system_prompt.py             # ported EVA_SYSTEM_PROMPT + buildEVAContext/buildEVAPrompt (1:1 from JS)
      chain.py                     # LangChain LCEL: prompt | llm | parser
      citation.py                  # extract/validate [C1] tags, injection_suspected flag
    cache/
      semantic_cache.py            # SemanticCache.lookup() / .write() — role+filter scoped
      promotion.py                 # APScheduler job: proven cache entries -> synthetic FAISS docs
    routes/
      health.py  plan_route.py  chat_route.py  ingest_route.py   # ingest_route is internal-only, not frontend-proxied
    scripts/
      bulk_ingest.py                # one-time backfill of the existing KnowledgeHub corpus
      debug_retrieve.py             # CLI: plan -> candidates -> lazy-embed -> results, for manual verification
  data/                              # gitignored
    eva.db
    markdown_cache/{BU}/{templates|data}/...
    faiss_indexes/{provider}__{model}/index.faiss, ids.json
  tests/
    test_ingestion.py  test_planner.py  test_retrieval.py  test_chat_route.py
    test_semantic_cache.py  test_promotion.py
```

### `upload-server/index.js` changes
- `const EVA_URL = process.env.EVA_URL || 'http://localhost:8001';` (same pattern as `ESTIMATOR_URL`).
- `POST /api/eva` and `POST /api/eva/plan` — dumb proxies to `eva_service`, same try/catch/502 pattern as the existing `/api/score` proxy.
- Inside the existing `/api/upload` handler, right after the sidecar `fs.writeFileSync`, add a **fire-and-forget** (not awaited) call to `POST ${EVA_URL}/internal/ingest` with `{filePath, metadataPath}` — upload success/latency must never depend on `eva_service` being up.

### SQLite schema (`storage/models.py`)

- **`documents`** — the metadata pre-filter target, extends the existing sidecar JSON shape rather than inventing a parallel one: `id, bu_folder, unit_id, subdivision, title, document_class, program_type, file_type, original_path (UNIQUE), markdown_path, sidecar_path, status, access_roles (json), version, tags (json), content_hash, source (kh|cache-derived), revoked_at, ingested_at, updated_at`. **Drafts (`status='draft'`) are excluded from candidate selection entirely.**
- **`chunks`** — embedding-provider-agnostic: `id, document_id FK, chunk_index, section_path, text, token_count, content_hash, created_at`.
- **`chunk_embeddings`** — the key design decision for the dual-embedding-space requirement: `id, chunk_id FK, embedding_provider, embedding_model, content_hash (of chunk at embed time), faiss_id, embedded_at`, `UNIQUE(chunk_id, embedding_provider, embedding_model)`. A chunk can have **zero, one, or two** rows (OpenAI space + local space), since the same user's provider flips with their network. Lazy-embed check: row exists AND its `content_hash` matches the chunk's current `content_hash` → **reuse, skip the API call**; otherwise → embed. This is the literal "embed once, cache it" mechanism, keyed by provider so switching networks never corrupts or forces a full re-embed of the other space.
- **`cache_logs`** — semantic cache + promotion source: `id, query_text, query_normalized, query_embedding (blob), embedding_provider, embedding_model, answer_text, citations (json), caller_role, unit_id, subdivision, document_class, filters_hash, intent, hit_count, feedback, promoted_at, promoted_document_id FK, created_at, last_hit_at`.
- **`chat_sessions`** / **`chat_messages`** — audit trail, feeds the planner's `rolling_summary`.

No migrations framework at this scale — `Base.metadata.create_all()` on startup.

### Ingestion pipeline
**Trigger: webhook from `upload-server`, not a folder watcher.** Every new file already goes through exactly one code path (multer handler), which is also the only place `uploaderRole`/`status` are known — a watcher would have to re-derive that from disk with partial-write races and no role context. The one gap — the ~15–20 files that predate this — is covered by `scripts/bulk_ingest.py`, a one-time walk of `KH_ROOT` (same traversal `index.js`'s `walk()` already does) that uses the sidecar JSON when present, or falls back to the same heuristics `useKnowledgeHub.js` already uses client-side (ported to Python) when it's missing.

`pipeline.ingest_document()`: convert → markdown (write to `data/markdown_cache/{BU}/{sub}/`) → chunk → `registrar.register_document()` (upserts `documents`, content_hash-diffed so re-runs are idempotent and unchanged docs are skipped) → insert `chunks` rows. **No `chunk_embeddings` rows are created here** — this is the concrete proof that ingestion never embeds upfront.

Conversion: `.docx`/`.pdf`/`.pptx` → `markitdown`. `.xlsx`/`.csv` → a **custom `openpyxl`-based converter** (not markitdown), because `RAG_Architecture_Guide.docx` requires worksheet/table-aware chunking (sheet name + column headers prepended) that a generic converter would flatten away. Chunking then follows that guide precisely: docx via LangChain's `MarkdownHeaderTextSplitter` (by heading, 400–700 tokens, 10–15% overlap, title+breadcrumb prepended); xlsx by sheet boundary, sub-split into 400–600-token row blocks with the header row repeated per chunk.

### End-to-end query flow
1. **Frontend** (`useEVA.js`): user submits text; `classifyEVAFunction(text)` still runs client-side for an instant badge.
2. **Frontend → `upload-server`**: `POST /api/eva` with `{message, callerRole, unitId, sessionId, rollingSummary}`.
3. **Proxy** forwards to `eva_service`.
4. **Semantic cache check** (before any LLM call): SQL-prefilter `cache_logs` by `caller_role + filters_hash + embedding_provider` (cheap equality, not vector math) → embed the query once → cosine similarity against just that small set → **hit** (≥0.93 default threshold) returns the cached answer immediately, `hit_count++`, skips steps 5–11 entirely; **miss** proceeds.
5. **Planner** (ported `EVA_PLANNER_PROMPT`): LLM call → validated JSON plan; any validation failure falls back to the ported `build_fallback_plan()`, never hard-fails.
6. **SQLite metadata pre-filter**: pure SQL on `documents` (unit_id/subdivision/document_class/program_type from the plan, `status='published'` only) → candidate chunk set (typically tens–hundreds, not the whole corpus).
7. **Role-gate, first line**: drop any candidate whose `access_roles` excludes `caller_role` — before anything is embedded or sent to an LLM.
8. **Lazy embed-if-needed**: batch-embed only the `chunk_embeddings` misses for the surviving candidates; persist to SQLite + the per-provider FAISS index.
9. **Scoped retrieval**: cosine top-k (`plan.k`, capped 8) over just the candidate matrix — deliberately **not** a global FAISS ID-filtered search (`faiss-cpu`'s ID-restricted search API is version-fragile); since step 6 already bounds the pool to a small set, plain numpy top-k is simpler, version-stable, and structurally guarantees out-of-scope chunks can never leak into results. FAISS's real job here is the **persistent namespaced on-disk store** that makes "embed once, cache forever" durable across restarts.
10. **Role-gate, second line** (R5 defense-in-depth, per the prompt's own "even if it reaches you in error" language).
11. **Context assembly**: ported `buildEVAContext(chunks)` → `<context>[C1]...</context>`.
12. **LLM call** with the ported `EVA_SYSTEM_PROMPT`.
13. **Citation extraction**: parse `[C1]` tags → citation objects; detect `injection_suspected` per R4.
14. **Response** → `{answer, citations, evaFn, plan, intent, isRestricted, injectionSuspected, cacheHit: false}`.
15. **Cache write**: new `cache_logs` row (reusing the query embedding already computed at step 4).
16. **Async promotion** (not on the hot path): a periodic `APScheduler` job scans `cache_logs WHERE (hit_count >= 3 OR feedback='good') AND promoted_at IS NULL`, and for each promotes it into `documents(source='cache-derived', document_class='faq')` + a chunk + a FAISS vector — carrying forward the original `access_roles`/citations — so future differently-worded but related queries can retrieve it too. This is the concrete "RAG learns from cache" mechanism.

### Provider factories (`providers/`)
- `llm_factory.get_llm()`: OpenAI key present → `ChatOpenAI`; if `OPENAI_SSL_INSECURE=true` (default off), build it with `httpx.Client(verify=False)` and log a loud warning unconditionally at startup — never silently active. No OpenAI key → `ChatGroq`. No key at all → raise at startup, not at first request.
- `embedding_factory.get_embeddings()`: same OpenAI-else-Groq branch, returning `(embeddings, provider_key)` where `provider_key` is e.g. `"openai::text-embedding-3-small"` or `"local::all-MiniLM-L6-v2"` — this string is what namespaces both `chunk_embeddings` rows and the FAISS index directory (`data/faiss_indexes/{provider_key_sanitized}/`), so a network switch never touches or invalidates the other space's cache; it just sits unused until that provider is active again.

### Frontend wiring (additive, no rewrites)
- **`RoleContext.jsx`**: add `activeUnitId`/`setActiveUnitId` (default `null`) to the existing global context — the smallest viable fix for the `unitId: null // TODO` in `useEVA.js`, since there's currently no BU state outside the Knowledge Hub page.
- **`useKnowledgeHub.js`**: one line in `selectUnit(id)` to also call `setActiveUnitId(...)`, so browsing a BU there scopes EVA retrieval automatically.
- **`useEVA.js`**: replace the `setTimeout`/`matchResponse` mock in `sendMessage` with a real `fetch('http://localhost:3001/api/eva', {...})`, passing `callerRole, unitId: activeUnitId, sessionId, rollingSummary`. On failure, append an explicit `isError: true` message — **not** the silent fake-success fallback `useUpload.js` currently uses, which would mask real outages. Keep `buildFallbackPlan`/`buildPlannerPrompt` only as a last-resort client-side badge renderer if the fetch itself fails; the server's returned `data.plan` is authoritative. The old client-side `checkRoleGate` (substring match on the *question text*) is removed — R5 correctly applies to *retrieved chunks* server-side (flow steps 7 & 10), not the raw question.
- **Endpoints**: keep `/api/eva/plan` as a real, independently callable endpoint (useful for a future debug/admin tool), but `useEVA.js`'s hot path calls only `/api/eva`, which runs planning internally as its own step 5 — avoiding two sequential LLM round-trips per chat turn.
- **Streaming**: deferred to the last phase. Current chat UI renders one complete message per turn (no token-by-token rendering exists yet); ship non-streaming JSON first, add `/api/eva/stream` (SSE) + a minimal `EVAMessageBubble` incremental-append change once the pipeline itself is proven.

### New dependencies — `backend/eva_service/requirements.txt`
```
fastapi uvicorn
langchain langchain-openai langchain-groq langchain-community
faiss-cpu sentence-transformers
sqlalchemy pydantic pydantic-settings python-dotenv
markitdown openpyxl python-docx pypdf
numpy tiktoken httpx apscheduler
pytest pytest-asyncio
```

---

## Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Ingestion + storage skeleton** | `config.py`, `storage/db.py`+`models.py`, `ingestion/*`, `scripts/bulk_ingest.py`, `routes/health.py`+`ingest_route.py`, upload-server `EVA_URL`+webhook | `bulk_ingest.py` populates `documents`/`chunks` for the real existing files; idempotent re-run; new `/api/upload` produces a row within seconds; `chunk_embeddings` stays **empty** — proves no upfront embedding. |
| **2. Planner + metadata pre-filter + lazy retrieval** | `providers/*`, `retrieval/planner.py`+`candidate_selector`+`embed_on_demand`+`retriever`, `storage/faiss_manager.py`, `routes/plan_route.py` | `POST /api/eva/plan` returns schema-valid plans (incl. `cyber/ai/datacloud`); `debug_retrieve.py` shows SQL-shrunk candidates before any embedding call. |
| **3. LLM generation + citations + role-gating** | `generation/*`, `retrieval/role_gate.py`, `routes/chat_route.py`, chat audit tables | Full `/api/eva` round-trip returns a grounded, cited answer; a poisoned test doc trips `injection_suspected`; an `estimator` asking about rate cards gets the R5 restricted reply, not the data. |
| **4. Semantic cache** | `CacheLog` model, `cache/semantic_cache.py` wired into `chat_route.py` | Same question/same role served from cache; same question/**different role** does **not** hit cache. |
| **5. Cache-promotion learning loop** | `cache/promotion.py` + `APScheduler` in `main.py` | A seeded `hit_count>=3` row gets promoted into `documents`+chunk+FAISS vector; a differently-worded related query retrieves it. |
| **6. Frontend wiring + streaming** | `RoleContext.jsx`, `useKnowledgeHub.js`, `useEVA.js`, `/api/eva/stream` + proxy passthrough, `EVAMessageBubble` | Manual QA across all 5 roles: citations render, restricted replies fire correctly, BU-scoped retrieval works after selecting a unit. |

---

## Verification

- **Phase 1**: `pytest tests/test_ingestion.py` — doc/chunk counts against a fixture copy of `KnowledgeHub/`; re-running `bulk_ingest` twice produces no duplicate rows.
- **Phase 2**: `pytest tests/test_planner.py` (schema validation, all 12 unit ids) and `test_retrieval.py` (candidate shrinkage, `chunk_embeddings` populated only for touched chunks).
- **Phase 3**: `pytest tests/test_chat_route.py` via FastAPI `TestClient` with a stubbed LLM (`FakeListLLM`/monkeypatched `get_llm`, no real API calls in CI); plus `backend/upload-server/test-eva.mjs`, styled identically to the existing `test-routing.mjs` (colored console output, health check first, scenario table), for manual smoke testing against a live `eva_service`.
- **Phase 4**: `pytest tests/test_semantic_cache.py` — same-role hits, cross-role misses, cross-provider misses.
- **Phase 5**: `pytest tests/test_promotion.py` — seed `cache_logs`, trigger one scheduler tick manually, assert the full promoted chain is retrievable.
- **Phase 6**: manual QA checklist in `eva_service/README.md` (no existing frontend test runner in this repo to extend).

### Critical files
- `backend/upload-server/index.js` — proxy routes + upload webhook
- `frontend/calibre-app/src/hooks/useEVA.js` — real fetch wiring
- `frontend/calibre-app/src/constants/eva-system-prompt.js` — source of truth to port, plus the `senior_mgmt` typo fix
- `frontend/calibre-app/src/constants/eva-retrieval-planner.js` — source of truth to port, plus the `UNIT_IDS` fix
- `frontend/calibre-app/src/contexts/RoleContext.jsx` — `activeUnitId` addition
