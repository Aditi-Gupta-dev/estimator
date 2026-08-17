/**
 * Calibre KnowledgeHub Upload Server
 * 
 * ROUTING RULE (simple & explicit):
 *   If the document type is 'template'  → KnowledgeHub/{BU}/templates/
 *   For every other document type       → KnowledgeHub/{BU}/data/
 *
 * POST /api/upload  → saves file to KnowledgeHub/{BU}/{templates|data}/{filename}
 * GET  /api/files   → lists all uploaded files
 * GET  /api/health  → health check
 */

import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors    from 'cors';
import express from 'express';
import fs      from 'fs';
import multer  from 'multer';
import path    from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './auth/routes.js';
import { requireAuth, requireCapability } from './auth/middleware.js';
import { runScenario, ScenarioValidationError } from './estimator/scenarioRunner.js';
import { calculateEstimate } from './estimator/authoritativeEstimate.js';
import { redactBottomUpForRole } from './estimator/rateCardRedaction.js';
import * as estimatesService from './estimator/estimatesService.js';
import * as reviewService from './estimator/reviewService.js';
import { CAPABILITIES, roleCan } from '../../frontend/calibre-app/src/constants/capabilities.js';
import { listUsers } from './auth/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
// Configurable so a second instance can be started alongside the running one
// (e.g. for smoke-testing a route) without a port clash. Defaults to the
// port the frontend and both Python services expect.
const PORT = Number(process.env.PORT) || 3001;

// ── Oracle Fusion Estimator service (Python/FastAPI) ──────────────────────────
// Configurable so prod can point at an internal service URL instead of localhost.
const ESTIMATOR_URL = process.env.ESTIMATOR_URL || 'http://localhost:8000';

// ── EVA RAG service (Python/FastAPI + LangChain) ───────────────────────────────
const EVA_URL = process.env.EVA_URL || 'http://localhost:8001';

// ── Internal service-to-service key ───────────────────────────────────────────
// Guards /internal/* routes, which are called by eva_service (which has no
// session cookie of its own) rather than by the browser, and is now also
// sent OUTBOUND to eva_service and estimator_agents so they can verify this
// process is really upload-server. Dev default matches the JWT_SECRET
// convention above — warned about loudly at startup, and fails startup
// outright in production (see below).
const DEV_INTERNAL_API_KEY = 'dev-internal-key-change-me';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || DEV_INTERNAL_API_KEY;

if (process.env.NODE_ENV === 'production' && INTERNAL_API_KEY === DEV_INTERNAL_API_KEY) {
  throw new Error(
    'INTERNAL_API_KEY is missing or still the insecure development default in a production ' +
    'environment (NODE_ENV=production). Set a real INTERNAL_API_KEY (matching the value ' +
    'configured for eva_service and estimator_agents) before starting this service.'
  );
}

// ── KnowledgeHub root ─────────────────────────────────────────────────────────
const KH_ROOT = path.resolve(__dirname, '..', 'KnowledgeHub');

// ── BU id → folder name ───────────────────────────────────────────────────────
// Each BU maps to its own dedicated KnowledgeHub folder.
// ⚠️  iae MUST map to 'IAE' — not 'ADM' — so uploads are scoped correctly.
const BU_MAP = {
  esu:       'ESU',
  adm:       'ADM',
  itis:      'ITIS',
  bps:       'BPS',
  ti:        'TI',
  ion:       'iON',
  bfsi:      'BFSI',
  iae:       'IAE',       // ← Integrated Application Engineering — own folder
  cyber:     'CYBER',     // Cyber Security dedicated folder
  ai:        'AI',        // AI Practice dedicated folder
  datacloud: 'DATACLOUD', // Data & Cloud dedicated folder
  _global:   '_global',
  global:    '_global',
};

// ── Core routing rule ─────────────────────────────────────────────────────────
// Estimation Template  → KnowledgeHub/{BU}/templates/
// ALL other artifacts  → KnowledgeHub/{BU}/data/
//
// Binary rule — POV, guideline, case study, playbook, rate card, benchmark,
// FAQ, white paper, proposal, video ALL route to data/.
function resolveSubFolder(docType) {
  const t = (docType ?? '').toLowerCase().trim();
  return (t === 'template' || t === 'templates') ? 'templates' : 'data';
}

function resolveBUFolder(unitId) {
  return BU_MAP[unitId?.toLowerCase()] || '_global';
}

// The document classes the ingest pipeline understands. `type` is
// client-supplied and DRIVES access_roles downstream (type 'ratecard' is
// withheld from estimator/senior_mgmt), so an unrecognised value must not be
// passed through — it would be stored verbatim and silently treated as
// unrestricted. Unknown values fall back to the most conservative sensible
// default rather than being trusted.
const KNOWN_DOCUMENT_TYPES = new Set([
  'template', 'guideline', 'pov', 'casestudy', 'playbook', 'ratecard',
  'benchmark', 'faq', 'whitepaper', 'proposal', 'video', 'data',
]);

function normalizeDocumentType(rawType) {
  const t = (rawType ?? '').toLowerCase().trim();
  return KNOWN_DOCUMENT_TYPES.has(t) ? t : 'guideline';
}

// Counts real KnowledgeHub artifacts for the admin overview. Mirrors the skip
// rules used by GET /api/files (sidecar .json and .gitkeep are not documents)
// so the two never report different totals.
function countKnowledgeHubFiles(dir = KH_ROOT) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name.endsWith('.json')) continue;
    count += entry.isDirectory()
      ? countKnowledgeHubFiles(path.join(dir, entry.name))
      : 1;
  }
  return count;
}

// ── Naming convention: {BU}_{folder}_{OriginalName}_{Version}_{YYYY-MM}.ext ──
function buildFileName({ buFolder, subFolder, originalName, version }) {
  const buCode   = buFolder.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ver      = version ? `_v${version.replace(/\./g, '-')}` : '_v1';
  const date     = new Date().toISOString().slice(0, 7); // YYYY-MM
  const ext      = path.extname(originalName);
  const baseName = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);

  return `${buCode}_${subFolder}_${baseName}${ver}_${date}${ext}`;
}

// ── Console routing log ───────────────────────────────────────────────────────
function logRouting({ buFolder, subFolder, savedName, role, status }) {
  console.log('\n📋 ROUTING DECISION');
  console.log('─'.repeat(60));
  console.log(`  BU Folder  : ${buFolder}`);
  console.log(`  Sub-Folder : ${subFolder}   ← ${subFolder === 'templates' ? '📋 TEMPLATE upload' : '📁 DATA upload'}`);
  console.log(`  Saved As   : ${savedName}`);
  console.log(`  Full Path  : KnowledgeHub/${buFolder}/${subFolder}/${savedName}`);
  console.log(`  Uploader   : ${role || 'Unknown'}`);
  console.log(`  Status     : ${status}`);
  console.log('─'.repeat(60));
}

// ── Middleware ─────────────────────────────────────────────────────────────────
// credentials:true is required for the browser to send/receive the httpOnly
// auth cookie across the 5173 (frontend) <-> 3001 (this server) origin split.
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(authRoutes);

// ── Multer — dynamic disk storage ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const buFolder  = resolveBUFolder(req.body.unitId);
    const subFolder = resolveSubFolder(req.body.type);
    const destDir   = path.join(KH_ROOT, buFolder, subFolder);
    fs.mkdirSync(destDir, { recursive: true });
    console.log(`\n📂 Routing → KnowledgeHub/${buFolder}/${subFolder}/`);
    cb(null, destDir);
  },

  filename: (req, file, cb) => {
    const buFolder  = resolveBUFolder(req.body.unitId);
    const subFolder = resolveSubFolder(req.body.type);
    const name      = buildFileName({
      buFolder,
      subFolder,
      originalName: file.originalname,
      version:      req.body.version,
    });
    console.log(`📄 Saving as: ${name}`);
    cb(null, name);
  },
});

// ── File type filter ──────────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/csv',
    'video/mp4',
    'application/zip',
    'application/octet-stream',
  ];
  const allowedExts = ['.pdf','.xlsx','.xls','.docx','.doc','.pptx','.ppt','.csv','.mp4','.zip'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type "${ext}". Accepted: PDF, XLSX, DOCX, PPTX, CSV, MP4, ZIP.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', khRoot: KH_ROOT, port: PORT, timestamp: new Date().toISOString() });
});

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file received.' });
    }

    const { unitId, type, title, version, description, tags, department, programType } = req.body;
    // uploaderRole/uploaderName come from the verified session, never from
    // the request body — a client can no longer claim "Admin / COE" to get
    // an upload auto-published.
    const uploaderRole = req.user.role;
    const uploaderName = req.user.name;

    const buFolder  = resolveBUFolder(unitId);
    const subFolder = resolveSubFolder(type);

    // RBAC: Admin/COE → published immediately; everyone else → draft
    const status = (uploaderRole === 'admin')
      ? 'published'
      : 'draft';

    logRouting({
      buFolder,
      subFolder,
      savedName: req.file.filename,
      role:      uploaderRole || 'Unknown',
      status,
    });

    // Write sidecar metadata JSON file next to the uploaded file
    const metadataPath = `${req.file.path}.json`;
    const parsedTags = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [];
    const metadataContent = {
      title: title || req.file.originalname,
      // Validated, not trusted — see normalizeDocumentType: this value decides
      // who may later retrieve the document through EVA.
      type: normalizeDocumentType(type),
      unitId: unitId || 'general',
      version: version || '1.0',
      description: description || 'No description provided.',
      tags: parsedTags,
      department: department || 'both',
      programType: programType || 'general',
      status,
      uploaderRole,
      uploaderName,
      uploadedAt: new Date().toISOString(),
      originalName: req.file.originalname,
      savedName: req.file.filename,
      size: req.file.size,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadataContent, null, 2));

    // ── Trigger EVA ingestion (fire-and-forget) ──────────────────────────────
    // Not awaited — upload success/latency must never depend on eva_service
    // being up. Converts the new file to Markdown + registers its metadata;
    // it does NOT embed anything (see EVA_RAG_IMPLEMENTATION_PLAN.md).
    fetch(`${EVA_URL}/internal/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({ filePath: req.file.path, metadataPath }),
    }).catch((err) => console.warn('EVA ingest trigger failed (non-fatal):', err.message));

    const savedPath = `KnowledgeHub/${buFolder}/${subFolder}/${req.file.filename}`;

    res.json({
      success: true,
      routing: {
        rule:       type?.toLowerCase() === 'template'
                      ? 'Template type → templates/ folder'
                      : 'Non-template type → data/ folder',
        buFolder,
        subFolder,
        fullPath:   `KnowledgeHub/${buFolder}/${subFolder}`,
        status,
        confidence: (unitId && type) ? 0.99 : 0.60,
      },
      file: {
        originalName: req.file.originalname,
        savedName:    req.file.filename,
        path:         savedPath,
        buFolder,
        subFolder,
        size:         req.file.size,
        mimetype:     req.file.mimetype,
      },
      metadata: metadataContent,
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── List files ────────────────────────────────────────────────────────────────
// Previously requireAuth only — ANY logged-in role, including estimator,
// could enumerate every Knowledge Hub file's metadata, rate cards included.
// The Knowledge Hub UI filtered rate cards client-side, but the API itself
// never did; now it does, so a devtools-level bypass gains nothing.
app.get('/api/files', requireAuth, requireCapability(CAPABILITIES.KNOWLEDGE_VIEW), (req, res) => {
  try {
    const files = [];
    const canSeeRateCards = roleCan(req.user.role, CAPABILITIES.RATE_CARD_VIEW);

    function walk(dir, rel) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.gitkeep' || entry.name.endsWith('.json')) continue;
        const full = path.join(dir, entry.name);
        const relP = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          walk(full, relP);
        } else {
          const stat = fs.statSync(full);
          const metaPath = `${full}.json`;
          let meta = null;
          if (fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            } catch (err) {
              console.error(`Failed to parse metadata for ${entry.name}:`, err.message);
            }
          }
          // Redact, don't just let the frontend hide — a rate card must
          // never appear in this response for a role that can't see rate
          // cards, regardless of what the UI does with it. `continue`, not
          // `return`: this sits inside walk()'s for-of loop, so `return`
          // would abort the whole directory walk on the first rate card.
          if (meta?.type === 'ratecard' && !canSeeRateCards) continue;
          files.push({
            name: entry.name,
            path: relP.replace(/\\/g, '/'),
            size: stat.size,
            modified: stat.mtime,
            metadata: meta,
          });
        }
      }
    }

    walk(KH_ROOT, 'KnowledgeHub');
    res.json({ success: true, count: files.length, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Oracle Fusion Estimator proxy ──────────────────────────────────────────────
// Forwards the UC-1/UC-2 risk-scoring request (complexity, industry, module/
// integration/report/DM counts, duration, team_size, integ/dm_coverage_ratio)
// to the Python FastAPI service (estimator_agents/src/api.py) and passes its
// response straight through. Kept as a dumb proxy (no schema validation here)
// — that's the Pydantic ScoreRequest model's job on the Python side.
app.post('/api/score', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_RUN), async (req, res) => {
  try {
    const upstream = await fetch(`${ESTIMATOR_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('Estimator service unreachable:', err.message);
    res.status(502).json({
      success: false,
      error: `Estimator service unreachable at ${ESTIMATOR_URL}. Is it running?`,
    });
  }
});

// ── Server-authoritative estimate calculation ──────────────────────────────────
// The browser has no rate card to compute cost with any more (RATE_CARD was
// removed from the frontend bundle entirely — see estimator/rateCard.js). This
// is what frontend/calibre-app/src/lib/estimatorEngine.js's scoreEstimate()
// calls instead of /api/score whenever it has no rate card of its own, i.e.
// every browser call site. Runs the exact same Layer 1 -> Layer 2 pipeline
// server-side, with the real rate card, and returns the same result shape
// /score's client-side assembly always has — so nothing downstream (estimator
// intelligence, EstimatorResultsView, estimatorContext) needs to change.
app.post('/api/estimate/calculate', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_RUN), async (req, res) => {
  const {
    overrides, sectionA, industry, overallComplexity,
  } = req.body || {};
  if (!overrides || !sectionA) {
    return res.status(400).json({ success: false, error: 'overrides and sectionA are required.' });
  }
  try {
    const result = await calculateEstimate({
      overrides, sectionA, industry, overallComplexity,
    }, ESTIMATOR_URL);
    // Redacted by the AUTHENTICATED session's role (req.user.role) — never
    // anything the request body could claim. See estimator/rateCardRedaction.js.
    result.bottomUp = redactBottomUpForRole(result.bottomUp, req.user.role);
    res.json({ success: true, result });
  } catch (err) {
    console.error('Authoritative estimate calculation failed:', err.message);
    res.status(502).json({
      success: false,
      error: `Estimator service unreachable at ${ESTIMATOR_URL}. Is it running?`,
    });
  }
});

// ── Admin control-center data ─────────────────────────────────────────────────
// One server-authored source for the admin dashboard, so the browser never
// talks to the Python services directly. Every number here is REAL — user
// counts from the auth DB, document counts from disk and from eva_service's
// index, model metadata from estimator_agents. Nothing is synthesised: if a
// service is down its section reports available:false rather than a zero that
// would read as "no documents" or "no model".
app.get('/api/system/overview', requireAuth, requireCapability(CAPABILITIES.PLATFORM_ANALYTICS_VIEW), async (req, res) => {
  const probe = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
      return { available: true, ...(await r.json()) };
    } catch (err) {
      return { available: false, error: err.message };
    }
  };

  const users = listUsers();
  const usersByRole = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  // Honest model accuracy, read from the training artefact rather than quoted
  // from memory — these are deliberately modest numbers and the UI says so.
  let modelMetrics = { available: false };
  try {
    const summaryPath = path.resolve(__dirname, '..', 'estimator_agents', 'models', 'training_summary.json');
    modelMetrics = { available: true, ...JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) };
  } catch (err) {
    modelMetrics = { available: false, error: err.message };
  }

  const [estimatorHealth, evaHealth] = await Promise.all([
    probe(`${ESTIMATOR_URL}/health`),
    probe(`${EVA_URL}/health`),
  ]);

  res.json({
    users: { total: users.length, byRole: usersByRole, active: users.filter((u) => u.status === 'active').length },
    knowledgeHub: { filesOnDisk: countKnowledgeHubFiles() },
    services: {
      gateway: { available: true, port: PORT },
      estimator: estimatorHealth,
      eva: evaHealth,
    },
    modelMetrics,
    generatedAt: new Date().toISOString(),
  });
});

// ── Knowledge Hub governance proxies ────────────────────────────────────────
// Forward to eva_service's /internal/documents* routes (the only place the
// document lifecycle/sensitivity/chunk-count data lives — this Node process
// never sees eva_service's SQLite directly). Same trust boundary as the EVA
// chat proxy below: eva_service has no auth of its own, so requireAuth +
// requireCapability here IS the real gate.
app.get('/api/documents', requireAuth, requireCapability(CAPABILITIES.KNOWLEDGE_REVIEW), async (req, res) => {
  try {
    const upstream = await fetch(`${EVA_URL}/internal/documents`, {
      headers: { 'x-internal-key': INTERNAL_API_KEY },
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ success: false, error: `Knowledge Hub service unreachable at ${EVA_URL}. Is it running?` });
  }
});

app.get('/api/knowledge/audit', requireAuth, requireCapability(CAPABILITIES.KNOWLEDGE_REVIEW), async (req, res) => {
  try {
    const upstream = await fetch(`${EVA_URL}/internal/knowledge/audit`, {
      headers: { 'x-internal-key': INTERNAL_API_KEY },
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ success: false, error: `Knowledge Hub service unreachable at ${EVA_URL}. Is it running?` });
  }
});

app.patch('/api/documents/:id', requireAuth, requireCapability(CAPABILITIES.KNOWLEDGE_REVIEW), async (req, res) => {
  try {
    const upstream = await fetch(`${EVA_URL}/internal/documents/${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      // Actor identity is ALWAYS the verified session, never the client body
      // — the same "spread body then overwrite the trusted fields" pattern
      // used for callerRole on the EVA proxy below. A forged actorRole in
      // the request cannot make it into the governance audit trail.
      body: JSON.stringify({
        ...req.body,
        actorUserId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ success: false, error: `Knowledge Hub service unreachable at ${EVA_URL}. Is it running?` });
  }
});

// ── Internal: what-if scenario execution (called by eva_service) ──────────────
// Runs the SAME estimator engine the browser runs (see estimator/scenarioRunner.js
// — it imports the frontend's own modules) so EVA can answer "what if I increase
// integration effort by 10%?" with a real calculation instead of a guess.
//
// Not browser-facing and not cookie-authenticated: eva_service has no session.
// It is guarded by the shared INTERNAL_API_KEY, and still applies the SAME role
// gate as /api/score so this cannot be used to score as a role that isn't
// allowed to (notably senior_mgmt). The role it receives was already
// overwritten with the verified session role by the /api/eva proxy below.
app.post('/internal/estimator/scenario', async (req, res) => {
  if (req.get('x-internal-key') !== INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid internal key.' });
  }

  const { callerRole, baseInputs, changes } = req.body || {};

  // Same capability the browser's /api/score path is gated on — EVA cannot be
  // used as a side door to score as a role that isn't allowed to.
  if (!roleCan(callerRole, CAPABILITIES.SCENARIO_RUN)) {
    return res.status(403).json({
      success: false,
      error: 'This role is not permitted to run estimator scenarios.',
      capability: CAPABILITIES.SCENARIO_RUN,
    });
  }
  if (!baseInputs?.sectionA || !baseInputs?.overrides) {
    return res.status(400).json({
      success: false,
      error: 'baseInputs.sectionA and baseInputs.overrides are required.',
    });
  }

  try {
    const result = await runScenario({
      baseInputs,
      changes: changes || {},
      scoreUrl: `${ESTIMATOR_URL}/score`,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ScenarioValidationError) {
      // Surfaced to the user as "that change is outside the supported range"
      // rather than being silently clamped into a different question.
      return res.status(422).json({ success: false, error: err.message, validation: true });
    }
    console.error('Scenario execution failed:', err.message);
    res.status(502).json({
      success: false,
      error: `Scenario scoring failed (estimator service at ${ESTIMATOR_URL}): ${err.message}`,
    });
  }
});

// ── Estimate persistence ────────────────────────────────────────────────────────
// Two entry points, one implementation (estimator/estimatesService.js) — same
// design as /api/score vs /internal/estimator/scenario. The browser calls
// /api/estimates* with its session cookie; EVA (no cookie of its own) calls
// /internal/estimates* with the shared INTERNAL_API_KEY and an actor identity
// that this layer re-validates against ESTIMATE_SAVE, exactly like the
// scenario endpoint already re-validates SCENARIO_RUN. Ownership (does THIS
// actor own THIS estimate) is enforced inside estimatesService itself, since
// ESTIMATE_SAVE only means "may work with persisted estimates in general".
function actorFromUser(user) {
  // unit is needed for reviewer scope enforcement (Phase 3 Part 6) — the
  // rest of the actor shape is unchanged from Phase 1.
  return {
    userId: user.id, name: user.name, role: user.role, unit: user.unit ?? null,
  };
}

function sendEstimateError(res, err) {
  const status = err.status || 502;
  if (status >= 500) console.error('Estimate operation failed:', err.message);
  res.status(status).json({ success: false, error: err.message });
}

app.post('/api/estimates', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), async (req, res) => {
  try {
    const { name, businessUnit, inputs } = req.body || {};
    const estimate = await estimatesService.createEstimate({
      name, businessUnit, inputs, actor: actorFromUser(req.user),
    }, ESTIMATOR_URL);
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    res.json({ success: true, estimates: estimatesService.listEstimates(actorFromUser(req.user)) });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    res.json({ success: true, estimate: estimatesService.getEstimate(req.params.id, actorFromUser(req.user)) });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id/history', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    res.json({ success: true, versions: estimatesService.getEstimateHistory(req.params.id, actorFromUser(req.user)) });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id/audit', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const events = estimatesService.getEstimateAuditEvents(req.params.id, actorFromUser(req.user));
    res.json({ success: true, events });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id/compare', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ success: false, error: 'Query params a and b (version numbers) are required.' });
    res.json({
      success: true,
      comparison: estimatesService.compareEstimateVersions(req.params.id, a, b, actorFromUser(req.user)),
    });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// PATCH body: { changes, persist }. persist:false (default) computes and
// returns a proposal without writing — the "show impact" step. persist:true
// writes a new version — only meant to be sent once the caller has already
// shown the proposal and the user confirmed it.
app.patch('/api/estimates/:id', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), async (req, res) => {
  try {
    const { changes, persist } = req.body || {};
    const actor = actorFromUser(req.user);
    const result = persist
      ? await estimatesService.saveEstimate({ estimateId: req.params.id, changes, actor }, ESTIMATOR_URL)
      : await estimatesService.updateEstimate({ estimateId: req.params.id, changes, actor }, ESTIMATOR_URL);
    res.json({ success: true, persisted: !!persist, result });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/clone', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), async (req, res) => {
  try {
    const estimate = await estimatesService.cloneEstimate(req.params.id, actorFromUser(req.user), ESTIMATOR_URL);
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// Workflow transitions — separate capability (ESTIMATE_APPROVE), since
// approving/rejecting someone else's submitted estimate is the whole point
// of a review workflow and must not require owning the estimate. No EVA tool
// calls this yet in this pass (API-only, ready for a future tool).
app.patch('/api/estimates/:id/status', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_APPROVE), (req, res) => {
  try {
    const { status, reason } = req.body || {};
    const estimate = estimatesService.setEstimateStatus({
      estimateId: req.params.id, targetStatus: status, reason, actor: actorFromUser(req.user),
    });
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// ── Estimate review / approval lifecycle (Phase 3) ──────────────────────────
// Owner-triggered transitions (submit/resubmit/ping) are gated on
// ESTIMATE_SAVE, same as every other estimate-mutating route — ownership
// itself is enforced inside reviewService.js (requireEstimate), not here.
// Reviewer-triggered actions (assign/start/decide) are gated on
// REVIEWER_ASSIGN / ESTIMATE_APPROVE — only admin and super hold the
// latter, matching "SUPER = REVIEWER" (no separate reviewer role exists).
app.post('/api/estimates/:id/submit', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const estimate = reviewService.submitEstimate({ estimateId: req.params.id, actor: actorFromUser(req.user) });
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/resubmit', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), async (req, res) => {
  try {
    const { changes, changeReason } = req.body || {};
    const estimate = await reviewService.resubmitEstimate({
      estimateId: req.params.id, changes, changeReason, actor: actorFromUser(req.user),
    }, ESTIMATOR_URL);
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/ping-reviewer', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const result = reviewService.pingReviewer({ estimateId: req.params.id, actor: actorFromUser(req.user) });
    res.json({ success: true, ...result });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/assign-reviewer', requireAuth, requireCapability(CAPABILITIES.REVIEWER_ASSIGN), (req, res) => {
  try {
    const { reviewerUserId } = req.body || {};
    const assignment = reviewService.assignReviewer({
      estimateId: req.params.id, reviewerUserId, actor: actorFromUser(req.user),
    });
    res.json({ success: true, assignment });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id/assignment', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const assignment = reviewService.getAssignment(req.params.id, actorFromUser(req.user));
    res.json({ success: true, assignment });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.get('/api/estimates/:id/reviews', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_SAVE), (req, res) => {
  try {
    const reviews = reviewService.listReviews(req.params.id, actorFromUser(req.user));
    res.json({ success: true, reviews });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/review/start', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_APPROVE), (req, res) => {
  try {
    const estimate = reviewService.startReview({ estimateId: req.params.id, actor: actorFromUser(req.user) });
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/api/estimates/:id/review/decision', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_APPROVE), (req, res) => {
  try {
    const {
      decision, comments, reviewedVersion,
    } = req.body || {};
    const estimate = reviewService.decideReview({
      estimateId: req.params.id, decision, comments, reviewedVersion, actor: actorFromUser(req.user),
    });
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// Top-level (not nested under /api/estimates/:id) — a cross-estimate query,
// not an action on one specific estimate.
app.get('/api/review-queue', requireAuth, requireCapability(CAPABILITIES.ESTIMATE_APPROVE), (req, res) => {
  try {
    const queue = reviewService.listReviewQueue(actorFromUser(req.user));
    res.json({ success: true, queue });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// ── In-app notifications (Phase 3 Part 12) — every authenticated user may
// read their own; no capability beyond being logged in as yourself. ────────
app.get('/api/notifications', requireAuth, (req, res) => {
  try {
    const { unread } = req.query;
    const notifications = reviewService.listNotifications(actorFromUser(req.user), { unreadOnly: unread === 'true' });
    res.json({ success: true, notifications });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
  try {
    const notification = reviewService.markNotificationRead(req.params.id, actorFromUser(req.user));
    res.json({ success: true, notification });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// ── Internal: estimate persistence (called by eva_service) ────────────────────
function internalActorOrDeny(req, res) {
  if (req.get('x-internal-key') !== INTERNAL_API_KEY) {
    res.status(401).json({ success: false, error: 'Invalid internal key.' });
    return null;
  }
  const { actorUserId, actorName, actorRole } = req.body || {};
  if (!actorUserId || !actorName || !actorRole) {
    res.status(400).json({ success: false, error: 'actorUserId, actorName and actorRole are required.' });
    return null;
  }
  if (!roleCan(actorRole, CAPABILITIES.ESTIMATE_SAVE)) {
    res.status(403).json({
      success: false,
      error: 'This role is not permitted to create or save estimates.',
      capability: CAPABILITIES.ESTIMATE_SAVE,
    });
    return null;
  }
  return { userId: actorUserId, name: actorName, role: actorRole };
}

app.post('/internal/estimates', async (req, res) => {
  const actor = internalActorOrDeny(req, res);
  if (!actor) return;
  try {
    const { name, businessUnit, inputs } = req.body || {};
    const estimate = await estimatesService.createEstimate({ name, businessUnit, inputs, actor }, ESTIMATOR_URL);
    res.json({ success: true, estimate });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/internal/estimates/:id/get', async (req, res) => {
  const actor = internalActorOrDeny(req, res);
  if (!actor) return;
  try {
    res.json({ success: true, estimate: estimatesService.getEstimate(req.params.id, actor) });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/internal/estimates/:id/update', async (req, res) => {
  const actor = internalActorOrDeny(req, res);
  if (!actor) return;
  try {
    const { changes, persist } = req.body || {};
    const result = persist
      ? await estimatesService.saveEstimate({ estimateId: req.params.id, changes, actor }, ESTIMATOR_URL)
      : await estimatesService.updateEstimate({ estimateId: req.params.id, changes, actor }, ESTIMATOR_URL);
    res.json({ success: true, persisted: !!persist, result });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/internal/estimates/:id/history', async (req, res) => {
  const actor = internalActorOrDeny(req, res);
  if (!actor) return;
  try {
    res.json({ success: true, versions: estimatesService.getEstimateHistory(req.params.id, actor) });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

app.post('/internal/estimates/:id/compare', async (req, res) => {
  const actor = internalActorOrDeny(req, res);
  if (!actor) return;
  try {
    const { versionA, versionB } = req.body || {};
    res.json({
      success: true,
      comparison: estimatesService.compareEstimateVersions(req.params.id, versionA, versionB, actor),
    });
  } catch (err) {
    sendEstimateError(res, err);
  }
});

// ── EVA planner proxy ─────────────────────────────────────────────────────────
// Forwards the retrieval-planning request (user turn + session facts) to the
// Python EVA service (eva_service/src/routes/plan_route.py) and passes its
// JSON plan straight through. Standalone debug/admin endpoint — the live
// chat hot path (below) runs planning internally instead of calling this.
app.post('/api/eva/plan', requireAuth, async (req, res) => {
  try {
    // callerRole is never taken from the client — see the /api/eva handler
    // below for why (this is the actual fix for the R5 role-gating bypass).
    const upstream = await fetch(`${EVA_URL}/api/eva/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({ ...req.body, callerRole: req.user.role }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('EVA service unreachable:', err.message);
    res.status(502).json({
      success: false,
      error: `EVA service unreachable at ${EVA_URL}. Is it running?`,
    });
  }
});

// ── EVA chat proxy ───────────────────────────────────────────────────────────
// Forwards the chat turn to the Python EVA service (eva_service/src/routes/
// chat_route.py — runs the full cache/planner/retrieval/generation pipeline
// internally) and passes its response straight through.
app.post('/api/eva', requireAuth, async (req, res) => {
  try {
    // ── The actual security fix ────────────────────────────────────────────
    // eva_service's R5 role-gating (see EVA_RAG_IMPLEMENTATION_PLAN.md) has
    // always trusted `callerRole` in the request body — before real auth
    // existed, that meant anyone could POST {"callerRole":"admin"} directly
    // and read rate-card content the UI pretends is locked. callerRole is
    // now always overwritten with the verified session's actual role, never
    // taken from the client, so eva_service's trust in this field is finally
    // warranted. callerUserId/callerName are forwarded the same way (the
    // verified session's real identity, never taken from the client) so the
    // estimate persistence tools can attribute created/saved estimates to
    // the actual logged-in user instead of only knowing their role.
    //
    // x-internal-key proves to eva_service that THIS request came from
    // upload-server at all — without it, eva_service previously trusted
    // callerRole/callerUserId/callerName from anyone who could reach its
    // port, regardless of whether upload-server was even involved. This
    // header is never sent to or readable by the browser.
    const upstream = await fetch(`${EVA_URL}/api/eva`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({
        ...req.body, callerRole: req.user.role, callerUserId: req.user.id, callerName: req.user.name,
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('EVA service unreachable:', err.message);
    res.status(502).json({
      success: false,
      error: `EVA service unreachable at ${EVA_URL}. Is it running?`,
    });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, error: 'File too large. Maximum is 50 MB.' });
  }
  console.error(err.message);
  res.status(400).json({ success: false, error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Calibre Upload Server  →  http://localhost:${PORT}`);
  console.log(`📁 KnowledgeHub root      →  ${KH_ROOT}`);
  console.log('\n📌 ROUTING RULES:');
  console.log('   document type = "template"  →  KnowledgeHub/{BU}/templates/');
  console.log('   any other type              →  KnowledgeHub/{BU}/data/');
  console.log('\n📌 STATUS RULES:');
  console.log('   Admin / COE   →  published immediately');
  console.log('   All others    →  draft (pending COE review)');
  console.log('\nEndpoints:');
  console.log(`  POST   /api/auth/login`);
  console.log(`  POST   /api/auth/logout`);
  console.log(`  GET    /api/auth/me`);
  console.log(`  GET    /api/auth/users        (admin only)`);
  console.log(`  POST   /api/auth/users        (admin only)`);
  console.log(`  PATCH  /api/auth/users/:id    (admin only)`);
  console.log(`  DELETE /api/auth/users/:id    (admin only)`);
  console.log(`  POST   /api/upload            (authenticated)`);
  console.log(`  GET    /api/files             (authenticated)`);
  console.log(`  GET    /api/health`);
  console.log(`  POST   /api/score  →  proxies to ${ESTIMATOR_URL}/score  (authenticated)`);
  console.log(`  POST   /api/estimate/calculate  (authenticated; server-authoritative cost)`);
  console.log(`  POST   /api/estimates  |  GET/PATCH /api/estimates/:id  |  GET .../history  |  GET .../compare  |  POST .../clone  |  PATCH .../status  (authenticated)`);
  console.log(`  POST   /api/eva/plan  →  proxies to ${EVA_URL}/api/eva/plan  (authenticated)`);
  console.log(`  POST   /api/eva    →  proxies to ${EVA_URL}/api/eva  (authenticated)`);
  console.log(`  POST   /internal/estimator/scenario  (internal key; called by eva_service)`);
  console.log(`  POST   /internal/estimates*  (internal key; called by eva_service)\n`);
  if (!process.env.INTERNAL_API_KEY) {
    console.warn('⚠️  INTERNAL_API_KEY is not set — using an insecure dev default for /internal/* routes.');
  }
  if (!process.env.JWT_SECRET) {
    console.log('⚠️  Run `node scripts/seed_users.mjs` once to create demo login accounts.\n');
  }
});
