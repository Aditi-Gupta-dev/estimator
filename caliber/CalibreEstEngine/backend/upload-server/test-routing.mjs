/**
 * Calibre Upload Routing Test
 * Tests all 4 routing scenarios against http://localhost:3001
 * Run: node test-routing.mjs
 */

import { createReadStream, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL  = 'http://localhost:3001';

// ── Create a tiny dummy PDF for tests (just needs to pass the MIME filter) ──
const DUMMY_FILE = join(__dirname, '_test_dummy.pdf');
writeFileSync(DUMMY_FILE, '%PDF-1.4 % Calibre routing test dummy file');

// ── multipart/form-data helper (no external deps) ────────────────────────────
async function uploadFile({ unitId, type, title, version, uploaderRole }) {
  const boundary = `----CalibreTestBoundary${Date.now()}`;

  const textField = (name, val) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`;

  const filePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="_test_dummy.pdf"\r\n` +
    `Content-Type: application/pdf\r\n\r\n` +
    `%PDF-1.4 Calibre routing test dummy\r\n`;

  const body =
    textField('unitId',       unitId)       +
    textField('type',         type)         +
    textField('title',        title)        +
    textField('version',      version)      +
    textField('uploaderRole', uploaderRole) +
    filePart +
    `--${boundary}--\r\n`;

  const res  = await fetch(`${BASE_URL}/api/upload`, {
    method:  'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });

  return res.json();
}

// ── Test cases ────────────────────────────────────────────────────────────────
const TESTS = [
  {
    label:       'TEST 1 — ESU Estimation Template',
    unitId:      'esu',
    type:        'template',
    title:       'Oracle ERP Estimation Template',
    version:     '2.0',
    uploaderRole:'Admin / COE',
    expectSub:   'templates',
    expectBU:    'ESU',
  },
  {
    label:       'TEST 2 — ADM Point of View',
    unitId:      'adm',
    type:        'pov',
    title:       'Cloud Migration PoV',
    version:     '1.0',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'ADM',
  },
  {
    label:       'TEST 3 — IAE Guideline',
    unitId:      'iae',
    type:        'guideline',
    title:       'IAE Estimation Guidelines v3',
    version:     '3.0',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'IAE',
  },
  {
    label:       'TEST 4 — ITIS Case Study',
    unitId:      'itis',
    type:        'casestudy',
    title:       'ITIS Infra Modernisation Case Study',
    version:     '1.0',
    uploaderRole:'Unit SME',
    expectSub:   'data',
    expectBU:    'ITIS',
  },
  {
    label:       'TEST 5 — BPS Playbook',
    unitId:      'bps',
    type:        'playbook',
    title:       'BPS Automation Playbook',
    version:     '1.0',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'BPS',
  },
  {
    label:       'TEST 6 — IAE Template (the MES scenario)',
    unitId:      'iae',
    type:        'template',
    title:       'MES Implementation Estimation Template',
    version:     '1.0',
    uploaderRole:'Admin / COE',
    expectSub:   'templates',
    expectBU:    'IAE',
  },
  {
    label:       'TEST 7 — AI Point of View',
    unitId:      'ai',
    type:        'pov',
    title:       'GenAI Implementation POV',
    version:     '1.0',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'AI',
  },
  {
    label:       'TEST 8 — Cyber Security Guideline',
    unitId:      'cyber',
    type:        'guideline',
    title:       'Zero-Trust Architecture Guidelines',
    version:     '1.1',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'CYBER',
  },
  {
    label:       'TEST 9 — Data & Cloud Case Study',
    unitId:      'datacloud',
    type:        'casestudy',
    title:       'AWS Migration Case Study',
    version:     '2.0',
    uploaderRole:'Admin / COE',
    expectSub:   'data',
    expectBU:    'DATACLOUD',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

let passed = 0, failed = 0;

console.log(`\n${BOLD}${CYAN}━━━ Calibre Upload Routing Tests ━━━${RESET}\n`);

// Health check first
try {
  const h = await fetch(`${BASE_URL}/api/health`).then(r => r.json());
  console.log(`${GREEN}✔ Upload server running — KH root: ${h.khRoot}${RESET}\n`);
} catch {
  console.log(`${RED}✘ Upload server NOT reachable at ${BASE_URL}. Start with: node index.js${RESET}\n`);
  process.exit(1);
}

for (const tc of TESTS) {
  process.stdout.write(`${BOLD}${tc.label}${RESET}\n`);
  process.stdout.write(`  type=${tc.type}  unit=${tc.unitId}  uploader=${tc.uploaderRole}\n`);

  try {
    const data = await uploadFile(tc);

    if (!data.success) {
      console.log(`  ${RED}✘ FAILED — server error: ${data.error}${RESET}\n`);
      failed++;
      continue;
    }

    const actualSub = data.routing?.subFolder;
    const actualBU  = data.routing?.buFolder;
    const fullPath  = data.routing?.fullPath;
    const rule      = data.routing?.rule;

    const subOk = actualSub === tc.expectSub;
    const buOk  = actualBU  === tc.expectBU;
    const ok    = subOk && buOk;

    if (ok) {
      console.log(`  ${GREEN}✔ PASS${RESET}  →  ${CYAN}${fullPath}/${RESET}`);
      console.log(`         Rule: ${rule}`);
      passed++;
    } else {
      console.log(`  ${RED}✘ FAIL${RESET}`);
      if (!subOk) console.log(`    subfolder — expected: ${tc.expectSub}  got: ${actualSub}`);
      if (!buOk)  console.log(`    buFolder  — expected: ${tc.expectBU}  got: ${actualBU}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ${RED}✘ ERROR — ${err.message}${RESET}`);
    failed++;
  }
  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`${BOLD}━━━ Results ━━━${RESET}`);
console.log(`  ${GREEN}Passed: ${passed}${RESET}  ${failed > 0 ? RED : ''}Failed: ${failed}${RESET}`);

if (failed === 0) {
  console.log(`\n${GREEN}${BOLD}✔ ALL TESTS PASSED — routing is working correctly.${RESET}`);
  console.log(`  Template → templates/   |   All artifacts → data/\n`);
} else {
  console.log(`\n${RED}${BOLD}✘ ${failed} TEST(S) FAILED — routing has issues.${RESET}\n`);
  process.exit(1);
}

// ── Verify files on disk ──────────────────────────────────────────────────────
console.log(`\n${BOLD}${CYAN}━━━ KnowledgeHub Folder Verification ━━━${RESET}`);
const { readdirSync, statSync } = await import('fs');
const KH_ROOT = join(__dirname, '..', 'KnowledgeHub');

function scanFolder(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth || !existsSync(dir)) return;
  const pad = '  '.repeat(depth);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const sub = entry.name === 'templates' ? `${GREEN}${entry.name}${RESET}` :
                  entry.name === 'data'      ? `${CYAN}${entry.name}${RESET}`  : entry.name;
      console.log(`${pad}📁 ${sub}`);
      scanFolder(join(dir, entry.name), depth + 1, maxDepth);
    } else {
      const sz = statSync(join(dir, entry.name)).size;
      console.log(`${pad}  📄 ${entry.name} (${sz}B)`);
    }
  }
}
console.log(`Root: ${KH_ROOT}\n`);
scanFolder(KH_ROOT);
console.log('');
