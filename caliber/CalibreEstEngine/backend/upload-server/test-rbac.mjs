/**
 * Per-role RBAC matrix — logs in as each of the five real demo accounts and
 * asserts the SERVER's actual HTTP responses. The frontend is never consulted:
 * this is the check that a tampered browser (or EVA) cannot gain anything.
 *
 * Matches the convention of test-auth.mjs / test-routing.mjs.
 *
 *   node test-rbac.mjs
 *   BASE=http://localhost:3099 node test-rbac.mjs
 *
 * Requires upload-server running (estimator_agents optional — a 502 from a
 * down estimator still proves the gate let the request through).
 */
const BASE = process.env.BASE || 'http://localhost:3001';
const PASSWORD = 'Calibre123!';
const KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';

const ACCOUNTS = {
  admin: 'admin@calibre.demo',
  super: 'super@calibre.demo',
  sme: 'sme@calibre.demo',
  estimator: 'estimator@calibre.demo',
};

// Expected outcome per role. `true` = must be allowed, `false` = must be 403.
const EXPECTED = {
  //            score  scenario  users  files  overview
  admin:       [true,  true,     true,  true,  true],
  super:       [true,  true,     false, true,  false],
  sme:         [true,  true,     false, true,  false],
  estimator:   [true,  true,     false, true,  false],
};

const SCORE_BODY = {
  complexity: 'H', industry: 'BFSI', n_modules: 5, n_entities: 3,
  integ_simple: 17, integ_complex: 8, n_reports: 40, n_cemli: 10,
  n_dm_objects: 15, duration_months: 18, team_size: 12,
  integ_coverage_ratio: 1.05, dm_coverage_ratio: 0.92,
};

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) { console.log(`    OK    ${label}`); passed++; }
  else { console.log(`    FAIL  ${label} ${detail}`); failed++; }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: HTTP ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

const req = async (cookie, method, pathname, body) => {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
};

// A gate that ALLOWS gives anything except 401/403 (502 = allowed through but
// the downstream Python service is down, which still proves the gate opened).
const allowed = (status) => status !== 401 && status !== 403;

console.log(`\nPer-role RBAC matrix → ${BASE}\n`);

for (const [role, email] of Object.entries(ACCOUNTS)) {
  console.log(`${role} (${email})`);
  const cookie = await login(email);
  const [expScore, expScenario, expUsers, expFiles, expOverview] = EXPECTED[role];

  const score = await req(cookie, 'POST', '/api/score', SCORE_BODY);
  check(`POST /api/score ${expScore ? 'allowed' : 'blocked'}`,
    allowed(score) === expScore, `(got ${score})`);

  // Scenario runs service-to-service; the role travels in the body the way
  // eva_service sends it, so this is the exact path EVA would take.
  const scenarioRes = await fetch(`${BASE}/internal/estimator/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': KEY },
    body: JSON.stringify({ callerRole: role, baseInputs: {}, changes: {} }),
  });
  check(`scenario ${expScenario ? 'allowed' : 'blocked'}`,
    allowed(scenarioRes.status) === expScenario, `(got ${scenarioRes.status})`);

  const users = await req(cookie, 'GET', '/api/auth/users');
  check(`GET /api/auth/users ${expUsers ? 'allowed' : 'blocked'}`,
    allowed(users) === expUsers, `(got ${users})`);

  const files = await req(cookie, 'GET', '/api/files');
  check(`GET /api/files ${expFiles ? 'allowed' : 'blocked'}`,
    allowed(files) === expFiles, `(got ${files})`);

  const overview = await req(cookie, 'GET', '/api/system/overview');
  check(`GET /api/system/overview ${expOverview ? 'allowed' : 'blocked'}`,
    allowed(overview) === expOverview, `(got ${overview})`);
}

// ── Spoofing: the frontend must not be able to claim a role ────────────────
console.log('\nspoofing');
{
  // All 4 remaining roles can score, so there is no restricted role left to
  // prove a body-supplied callerRole forgery against on /api/score directly
  // — that property is now covered where it actually matters: the eva_service
  // identity boundary (see test-eva-internal-auth.mjs, added alongside the
  // shared-secret fix in this phase).
  const scenario = await fetch(`${BASE}/internal/estimator/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callerRole: 'admin', baseInputs: {}, changes: {} }),
  });
  check('scenario endpoint rejects a forged role without the internal key',
    scenario.status === 401, `(got ${scenario.status})`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
