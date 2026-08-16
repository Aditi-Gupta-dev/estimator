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
import { requireAuth, requireRole } from './auth/middleware.js';
import { runScenario, ScenarioValidationError } from './estimator/scenarioRunner.js';

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
// session cookie of its own) rather than by the browser. Dev default matches
// the JWT_SECRET convention below — warned about loudly at startup.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';

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
      type: type || 'guideline',
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
      headers: { 'Content-Type': 'application/json' },
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
app.get('/api/files', requireAuth, (_req, res) => {
  try {
    const files = [];

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
app.post('/api/score', requireAuth, requireRole('admin', 'super', 'sme', 'estimator'), async (req, res) => {
  try {
    const upstream = await fetch(`${ESTIMATOR_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
const SCORE_ALLOWED_ROLES = ['admin', 'super', 'sme', 'estimator'];

app.post('/internal/estimator/scenario', async (req, res) => {
  if (req.get('x-internal-key') !== INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid internal key.' });
  }

  const { callerRole, baseInputs, changes } = req.body || {};

  if (!SCORE_ALLOWED_ROLES.includes(callerRole)) {
    return res.status(403).json({
      success: false,
      error: 'This role is not permitted to run estimator scoring.',
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
      headers: { 'Content-Type': 'application/json' },
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
    // warranted.
    const upstream = await fetch(`${EVA_URL}/api/eva`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  console.log(`  POST   /api/eva/plan  →  proxies to ${EVA_URL}/api/eva/plan  (authenticated)`);
  console.log(`  POST   /api/eva    →  proxies to ${EVA_URL}/api/eva  (authenticated)`);
  console.log(`  POST   /internal/estimator/scenario  (internal key; called by eva_service)\n`);
  if (!process.env.INTERNAL_API_KEY) {
    console.warn('⚠️  INTERNAL_API_KEY is not set — using an insecure dev default for /internal/* routes.');
  }
  if (!process.env.JWT_SECRET) {
    console.log('⚠️  Run `node scripts/seed_users.mjs` once to create demo login accounts.\n');
  }
});
