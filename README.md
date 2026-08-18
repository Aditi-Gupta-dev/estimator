# Calibre — Oracle Fusion Estimation Engine

Calibre is an AI-assisted delivery estimation platform for Oracle Fusion ERP
engagements: a 67-component bottom-up estimator calibrated against 500
executed projects via ML (deviation % / overrun risk), a reviewer/approval
workflow, project tracking with AI-generated version-delta analysis, and
**EVA**, a RAG-grounded chat assistant over the Knowledge Hub document
corpus.

This README covers everything needed to get the whole application running
on a machine that has never seen this project before — cloning, environment
setup, and starting all four services.

---

## 1. Architecture

Calibre is four independently-run services plus a React frontend. All four
must be running for the full application to work end to end.

| # | Service | Tech | Default port | Purpose |
|---|---|---|---|---|
| 1 | `frontend/calibre-app` | React 19 + Vite | `5173` | The web app you open in a browser |
| 2 | `backend/upload-server` | Node.js + Express | `3001` | Gateway: auth, file uploads, estimates/projects/reviews API, proxies to the two Python services |
| 3 | `backend/estimator_agents` | Python + FastAPI | `8000` | ML scoring service (deviation %, overrun risk) — pre-trained models included |
| 4 | `backend/eva_service` | Python + FastAPI + LangChain | `8001` | EVA chat/RAG backend and AI delta-analysis |

```
Browser (5173)
     │
     ▼
upload-server (3001) ──► estimator_agents (8000)   [ML scoring]
     │                └─► eva_service (8001)        [EVA chat, RAG, AI delta analysis]
     ▼
SQLite (auth.db, estimates.db)
```

The frontend only ever talks to `upload-server` on port 3001. `upload-server`
is the only service that talks to the two Python services directly.

---

## 2. Prerequisites

Install these first:

| Tool | Minimum version | Check with |
|---|---|---|
| [Git](https://git-scm.com/downloads) | any recent | `git --version` |
| [Node.js](https://nodejs.org/) | 18+ (tested on 22) | `node --version` |
| npm | bundled with Node | `npm --version` |
| [Python](https://www.python.org/downloads/) | 3.10+ | `python --version` |
| pip | bundled with Python | `pip --version` |

You'll also want an API key from **one** LLM provider for EVA's chat and AI
delta-analysis features to actually work (everything else in the app works
without one):
- [Groq](https://console.groq.com/keys) — has a free tier, easiest to start with, **or**
- [OpenAI](https://platform.openai.com/api-keys)

The app runs and is fully usable without either key — you just won't get
EVA chat responses or AI-generated delta analysis (those features fail
gracefully, with everything else on the platform unaffected).

---

## 3. Get the code

### Option A — clone with Git (recommended)

```bash
git clone https://github.com/Aditi-Gupta-dev/estimator.git
cd estimator
```

### Option B — download the ZIP

1. Go to the repository on GitHub.
2. Click the green **Code** button → **Download ZIP**.
3. Extract it anywhere on your machine.
4. Open a terminal in the extracted folder (the one containing the `caliber`
   folder).

Either way, you should now be sitting in a folder that contains a `caliber`
directory. All commands below assume you're starting from there.

### Project layout

```
estimator/                                  ← repo root (what you just cloned/extracted)
└── caliber/
    └── CalibreEstEngine/
        ├── backend/
        │   ├── upload-server/              ← Node gateway (port 3001)
        │   ├── estimator_agents/           ← Python ML service (port 8000)
        │   ├── eva_service/                ← Python EVA/RAG service (port 8001)
        │   └── KnowledgeHub/               ← document corpus EVA retrieves from
        └── frontend/
            └── calibre-app/                ← React app (port 5173)
```

Every `cd` path below is written **relative to `caliber/CalibreEstEngine/`**
— `cd` there first:

```bash
cd caliber/CalibreEstEngine
```

---

## 4. Set up and run each service

Open **four separate terminals** (one per service — they all need to stay
running at the same time). Start them roughly in this order: the two Python
services first, then the Node gateway, then the frontend.

### 4.1 `estimator_agents` (ML scoring — port 8000)

```bash
cd backend/estimator_agents
python -m venv venv

# Activate the virtual environment:
#   macOS/Linux:
source venv/bin/activate
#   Windows (PowerShell):
venv\Scripts\Activate.ps1
#   Windows (cmd.exe):
venv\Scripts\activate.bat

pip install -r requirements.txt
cd src
uvicorn api:app --host 0.0.0.0 --port 8000
```

Trained models are already committed to the repo (`models/*.joblib`) — no
training step needed. Leave this terminal running. Verify it's up:

```bash
curl http://localhost:8000/health
```

### 4.2 `eva_service` (EVA chat / RAG / AI delta-analysis — port 8001)

```bash
cd backend/eva_service
python -m venv venv
source venv/bin/activate        # or the Windows equivalent from step 4.1

pip install -r requirements.txt
cp .env.example .env
```

Now open `backend/eva_service/.env` in an editor and set **one** of:

```ini
GROQ_API_KEY=your-groq-key-here
# or
OPENAI_API_KEY=your-openai-key-here
```

Everything else in `.env` already has a working local-dev default — leave
the rest as-is unless you know you need to change it.

Then run it:

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8001
```

**One-time step** — the Knowledge Hub documents already in the repo need to
be indexed once so EVA can retrieve them (new uploads after this are indexed
automatically):

```bash
# in a new terminal, with the venv above still active
cd backend/eva_service
python scripts/bulk_ingest.py
```

This is idempotent — safe to re-run any time (already-indexed files are
skipped).

Verify it's up:

```bash
curl http://localhost:8001/health
```

### 4.3 `upload-server` (Node gateway — port 3001)

```bash
cd backend/upload-server
npm install
cp .env.example .env
```

The defaults in `.env.example` work out of the box for local development
(insecure dev secrets are used automatically, with a warning printed at
startup) — you don't have to fill anything in to get started locally. Set
real values before ever deploying this somewhere other than your own machine
(see the [environment variables reference](#6-environment-variables-reference)
below).

```bash
npm start
```

This creates `data/auth.db` and `data/estimates.db` automatically on first
run if they don't already exist. **Note:** this repository actually ships
with those two database files already populated (demo users, and estimates/
projects created during development) — see
[§9, resetting to a clean slate](#9-resetting-to-a-clean-slate-optional) if
you'd rather start empty.

If the databases are fresh/empty, seed the four demo accounts (safe to
re-run — skips accounts that already exist):

```bash
node scripts/seed_users.mjs
```

Verify it's up:

```bash
curl http://localhost:3001/api/health
```

### 4.4 `frontend/calibre-app` (React app — port 5173)

```bash
cd frontend/calibre-app
npm install
npm run dev
```

Open the URL it prints (**http://localhost:5173**) in a browser.

---

## 5. Log in

Use one of the seeded demo accounts (password is the same for all of them):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@calibre.demo` | `Calibre123!` |
| Super User / Reviewer | `super@calibre.demo` | `Calibre123!` |
| SME | `sme@calibre.demo` | `Calibre123!` |
| Estimator | `estimator@calibre.demo` | `Calibre123!` |

---

## 6. Environment variables reference

### `backend/upload-server/.env`

| Variable | Required? | Default (dev) | Notes |
|---|---|---|---|
| `JWT_SECRET` | Recommended | insecure built-in default | Signs login sessions. Set a real random value before any real deployment. |
| `JWT_EXPIRY` | No | `8h` | Session lifetime. |
| `INTERNAL_API_KEY` | Recommended | insecure built-in default | Shared secret for service-to-service calls. **Must match** `eva_service`'s `INTERNAL_API_KEY` and `estimator_agents`' `INTERNAL_API_KEY`. |
| `NODE_ENV` | No | unset (dev) | Set to `production` to require HTTPS cookies **and** to enforce that `JWT_SECRET`/`INTERNAL_API_KEY` aren't left at their defaults (the app refuses to start otherwise). |
| `PORT` | No | `3001` | |
| `ESTIMATOR_URL` | No | `http://localhost:8000` | Where `estimator_agents` is reachable. |
| `EVA_URL` | No | `http://localhost:8001` | Where `eva_service` is reachable. |

### `backend/eva_service/.env`

| Variable | Required? | Default (dev) | Notes |
|---|---|---|---|
| `GROQ_API_KEY` **or** `OPENAI_API_KEY` | **Yes**, one of them, for EVA/AI features to work | none | See §2. |
| `OPENAI_LLM_MODEL` | No | `gpt-4o-mini` | Only used if `OPENAI_API_KEY` is set. |
| `GROQ_LLM_MODEL` | No | `openai/gpt-oss-120b` | Only used if using Groq. Groq periodically retires models — if you get a `model_not_found` error, check `https://api.groq.com/openai/v1/models` for currently-available models and update this. |
| `INTERNAL_API_KEY` | Recommended | insecure built-in default | **Must match** `upload-server`'s value. |
| `EVA_SERVICE_PORT` | No | `8001` | |
| `UPLOAD_SERVER_URL` | No | `http://localhost:3001` | |
| `ESTIMATOR_SERVICE_URL` | No | `http://localhost:8000` | |

### `backend/estimator_agents`

No `.env` file — reads `INTERNAL_API_KEY` directly from the environment if
set (same insecure dev default otherwise). No key setup needed for local
development.

### Frontend

No `.env` file — the frontend is hardcoded to call `upload-server` at
`http://localhost:3001`. If you need it to point somewhere else, search for
`localhost:3001` under `frontend/calibre-app/src`.

**Never commit a real `.env` file** — every service's `.gitignore` already
excludes it; only the `.env.example` templates are tracked.

---

## 7. Running the test suites (optional)

All of these expect `upload-server` (and, where noted, `eva_service`) to
already be running. Their invocation conventions aren't uniform, so use the
exact command shown for each — from `backend/upload-server`:

```bash
# Python — from backend/eva_service, with its venv active
pytest

# Node — no argument needed, hardcoded to localhost:3001
node test-auth.mjs
node test-routing.mjs

# Node — reads a BASE env var (defaults to localhost:3001 if unset)
node test-rbac.mjs
node test-scenario.mjs

# Node — takes the URL as a plain argument (note the different default ports)
node test-estimates.mjs http://localhost:3001
node test-review-workflow.mjs http://localhost:3001
node test-projects.mjs http://localhost:3001

# Frontend
cd frontend/calibre-app
npm run build
npm run lint
```

`test-deltas.mjs` and `test-deltas-real-llm.mjs` are more involved
integration tests for the AI delta-analysis pipeline — they expect either a
mock LLM double or a real configured key, and in the case of
`test-deltas.mjs`, multiple upload-server instances pointed at different
things. Read the comment block at the top of each file before running
them; they're not a simple "point at your dev server" command like the
others above.

---

## 8. Troubleshooting

**`node-gyp` / native module build errors installing `upload-server`'s
dependencies** (`better-sqlite3`, `bcrypt`) — these compile native code on
install. On Windows, install the
["Desktop development with C++"](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
workload from Visual Studio Build Tools first, then re-run `npm install`. On
macOS, install Xcode Command Line Tools (`xcode-select --install`). On
Linux, install `build-essential` (Debian/Ubuntu) or the equivalent.

**"Estimator service returned 404" / "Estimator service unreachable" in the
UI** — `estimator_agents` (port 8000) or `upload-server` (port 3001) isn't
running, or was started and later stopped. Check both terminals are still
alive and re-check `curl http://localhost:8000/health`.

**EVA says "Offline" or chat requests fail** — `eva_service` (port 8001)
isn't running, or no `GROQ_API_KEY`/`OPENAI_API_KEY` is set in its `.env`.
Check the `eva_service` terminal's logs for the actual error.

**EVA responds but never cites any Knowledge Hub documents** — you likely
skipped the one-time `python scripts/bulk_ingest.py` step in §4.2.

**Port already in use** — something else on your machine is already using
`3001`/`8000`/`8001`/`5173`. Either stop that process or override the port
via the relevant `.env`/CLI flag (see §6).

**Login fails for the demo accounts** — the database may be empty (fresh
clone with the databases reset, see §9). Run
`node backend/upload-server/scripts/seed_users.mjs` with `upload-server`
running.

---

## 9. Resetting to a clean slate (optional)

This repository's `backend/upload-server/data/` folder is committed with a
working demo database (users, sample estimates/projects created during
development) rather than being empty. If you'd rather start from nothing:

```bash
cd backend/upload-server
rm data/auth.db data/auth.db-shm data/auth.db-wal
rm data/estimates.db data/estimates.db-shm data/estimates.db-wal
npm start                       # recreates empty databases automatically
node scripts/seed_users.mjs     # re-seed the four demo accounts
```

`eva_service`'s database is never committed (each environment starts empty
there regardless) — you always need the `bulk_ingest.py` step from §4.2 on
a fresh checkout.

---

## 10. Further reading

- `caliber/CalibreEstEngine/EVA_RAG_IMPLEMENTATION_PLAN.md` — EVA's RAG
  architecture design.
- `backend/estimator_agents/README.md` — the ML models: what they learned,
  honest accuracy numbers, how to retrain.
- `backend/eva_service/README.md` — EVA service internals, embedding spaces,
  ingestion pipeline.
- `backend/KnowledgeHub/README.md` — document corpus folder structure and
  conventions.
