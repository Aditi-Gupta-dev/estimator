/**
 * Smoke test for estimate persistence + server-authoritative cost.
 *
 * Run against an ISOLATED instance, never the live dev server on 3001 — see
 * this session's standing verification discipline. Usage:
 *   PORT=3002 node index.js &         (separate terminal/background)
 *   node test-estimates.mjs http://localhost:3002
 *
 * Uses the seeded demo accounts (password Calibre123! for all).
 */
import { COMPONENTS } from '../../frontend/calibre-app/src/constants/estimator-template.js';

const BASE = process.argv[2] || 'http://localhost:3002';

let pass = 0;
let fail = 0;

function check(label, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}  ${detail}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(`login failed for ${email}: ${JSON.stringify(data)}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  return cookie;
}

// computeBottomUp requires an entry for EVERY component (included:false for
// ones not in scope) — not just the ones actually selected.
function sampleOverrides(selected) {
  const overrides = {};
  COMPONENTS.forEach((c) => {
    overrides[c.component] = { complexity: c.default_complexity, volume: c.default_volume, included: false };
  });
  selected.forEach((name) => { overrides[name] = { ...overrides[name], included: true }; });
  return overrides;
}

function sampleInputs() {
  return {
    industry: 'BFSI',
    overallComplexity: 'H',
    sectionA: {
      duration_months: 18, n_modules: 5, n_entities: 3, n_integrations: 25,
      n_dm_objects: 15, n_reports: 40, n_cemli: 10, integ_complex: 8, integ_simple: 17,
      contingency_pct: 15, mgmt_reserve_pct: 5, working_hours_day: 8, working_days_month: 20,
      onshore_pct: 30,
    },
    overrides: sampleOverrides([
      'Enterprise Structures & Legal Entities', 'REST/SOAP API Integrations (Simple)',
    ]),
  };
}

async function main() {
  console.log(`\nTesting estimate persistence against ${BASE}\n`);

  // ── Server-authoritative calculate: cost only appears from the server ──────
  console.log('Server-authoritative calculation');
  const estimatorCookie = await login('estimator@calibre.demo', 'Calibre123!');
  const calcRes = await fetch(`${BASE}/api/estimate/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: estimatorCookie },
    body: JSON.stringify(sampleInputs()),
  });
  const calcData = await calcRes.json();
  check('calculate succeeds', calcRes.ok && calcData.success === true, JSON.stringify(calcData).slice(0, 200));
  check('bottomUp.totalCost is a real number', typeof calcData.result?.bottomUp?.totalCost === 'number');
  check('estimator does not receive blendedRate (403-equivalent redaction)',
    !JSON.stringify(calcData.result?.bottomUp?.costByRole).includes('blendedRate'));
  check('estimator still receives aggregate cost/effort per role (redaction is field-level, not row-level)',
    Object.values(calcData.result?.bottomUp?.costByRole || {}).every((r) => typeof r.cost === 'number' && typeof r.effortDays === 'number'));

  // ── Rate-card redaction: per-role behavior, proven server-side ─────────────
  console.log('\nRate-card redaction (server-side, not UI-dependent)');
  const adminCookieForRates = await login('admin@calibre.demo', 'Calibre123!');
  const superCookieForRates = await login('super@calibre.demo', 'Calibre123!');
  const smeCookie = await login('sme@calibre.demo', 'Calibre123!');

  const calcAs = async (cookie) => {
    const res = await fetch(`${BASE}/api/estimate/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(sampleInputs()),
    });
    return { status: res.status, data: await res.json() };
  };

  const adminCalc = await calcAs(adminCookieForRates);
  check('admin receives blendedRate (permitted role)',
    JSON.stringify(adminCalc.data.result?.bottomUp?.costByRole).includes('blendedRate'));

  const superCalc = await calcAs(superCookieForRates);
  check('super receives blendedRate (permitted role)',
    JSON.stringify(superCalc.data.result?.bottomUp?.costByRole).includes('blendedRate'));

  const smeCalc = await calcAs(smeCookie);
  check('sme receives blendedRate (permitted role)',
    JSON.stringify(smeCalc.data.result?.bottomUp?.costByRole).includes('blendedRate'));

  // Body-role-forgery: an estimator claiming to be admin in the request body
  // must still be redacted — authorization comes from the session
  // (req.user.role), never anything the client sends.
  const forgedRoleRes = await fetch(`${BASE}/api/estimate/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: estimatorCookie },
    body: JSON.stringify({ ...sampleInputs(), role: 'admin', callerRole: 'admin' }),
  });
  const forgedRoleData = await forgedRoleRes.json();
  check('changing role in the request body cannot bypass redaction',
    !JSON.stringify(forgedRoleData.result?.bottomUp?.costByRole).includes('blendedRate'));

  // Frontend-irrelevance: this whole test file is a raw fetch script with no
  // UI involved at all — nothing here renders or hides anything. That the
  // two checks above (estimator redacted, admin not) already hold PROVES the
  // decision is made server-side: there is no client to have hidden it.

  // ── Create / get / update / save / history ──────────────────────────────────
  console.log('\nCreate → get → update(propose) → save(persist) → history');

  const createRes = await fetch(`${BASE}/api/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: smeCookie },
    body: JSON.stringify({ name: 'Smoke Test Estimate', inputs: sampleInputs() }),
  });
  const createData = await createRes.json();
  check('create succeeds', createRes.ok && createData.success === true, JSON.stringify(createData).slice(0, 200));
  const estimateId = createData.estimate?.id;
  check('create returns an id', !!estimateId);
  check('create starts at version 1, status draft', createData.estimate?.currentVersion === 1 && createData.estimate?.status === 'draft');
  check('persisted-estimate response also carries blendedRate for a permitted role (sme)',
    JSON.stringify(createData.estimate?.latestVersion?.bottomUp?.costByRole).includes('blendedRate'));

  // Same redaction applies to every persisted-estimate response, not just
  // /api/estimate/calculate — proven here via a real create+get as estimator.
  const estimatorCreateRes = await fetch(`${BASE}/api/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: estimatorCookie },
    body: JSON.stringify({ name: 'Estimator-owned Estimate', inputs: sampleInputs() }),
  });
  const estimatorCreateData = await estimatorCreateRes.json();
  check('estimator-owned persisted estimate does not carry blendedRate either',
    !JSON.stringify(estimatorCreateData.estimate?.latestVersion?.bottomUp?.costByRole).includes('blendedRate'));

  const getRes = await fetch(`${BASE}/api/estimates/${estimateId}`, { headers: { Cookie: smeCookie } });
  const getData = await getRes.json();
  check('get returns the same estimate', getRes.ok && getData.estimate?.id === estimateId);

  const updateRes = await fetch(`${BASE}/api/estimates/${estimateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: smeCookie },
    body: JSON.stringify({ changes: { durationMonthsDelta: 1 }, persist: false }),
  });
  const updateData = await updateRes.json();
  check('update(propose) succeeds without persisting', updateRes.ok && updateData.success === true && updateData.persisted === false);

  const afterProposeRes = await fetch(`${BASE}/api/estimates/${estimateId}`, { headers: { Cookie: smeCookie } });
  const afterProposeData = await afterProposeRes.json();
  check('proposing a change does not bump the version', afterProposeData.estimate?.currentVersion === 1);

  const saveRes = await fetch(`${BASE}/api/estimates/${estimateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: smeCookie },
    body: JSON.stringify({ changes: { durationMonthsDelta: 1 }, persist: true }),
  });
  const saveData = await saveRes.json();
  check('save(persist) succeeds and bumps the version', saveRes.ok && saveData.result?.currentVersion === 2);

  const historyRes = await fetch(`${BASE}/api/estimates/${estimateId}/history`, { headers: { Cookie: smeCookie } });
  const historyData = await historyRes.json();
  check('history shows 2 versions', (historyData.versions || []).length === 2);

  const compareRes = await fetch(`${BASE}/api/estimates/${estimateId}/compare?a=1&b=2`, { headers: { Cookie: smeCookie } });
  const compareData = await compareRes.json();
  check('compare returns a delta', compareRes.ok && typeof compareData.comparison?.delta?.effortDays === 'number');

  // ── Ownership + capability enforcement ───────────────────────────────────
  console.log('\nOwnership and capability enforcement');
  const otherEstimatorCookie = await login('admin@calibre.demo', 'Calibre123!');
  // admin CAN see it (owner-or-admin rule) — verifies the rule's positive case
  const adminGetRes = await fetch(`${BASE}/api/estimates/${estimateId}`, { headers: { Cookie: otherEstimatorCookie } });
  check('admin can view another user\'s estimate', adminGetRes.ok);

  // Every remaining role (admin/super/sme/estimator) holds ESTIMATE_SAVE, so
  // there is no role left to prove a create/read denial against on this
  // capability. ESTIMATE_APPROVE remains genuinely restricted (only
  // admin/super hold it) — estimator attempting a status transition is the
  // equivalent-strength regression check post senior_mgmt removal.
  const deniedApproveRes = await fetch(`${BASE}/api/estimates/${estimateId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: smeCookie },
    body: JSON.stringify({ status: 'archived' }),
  });
  check('sme is blocked from ESTIMATE_APPROVE-gated status transitions (403)', deniedApproveRes.status === 403);

  // A second, unrelated estimator must not be able to read the SME's estimate.
  const secondEstimatorCookie = await login('estimator@calibre.demo', 'Calibre123!');
  const crossOwnerRes = await fetch(`${BASE}/api/estimates/${estimateId}`, { headers: { Cookie: secondEstimatorCookie } });
  check('a non-owner, non-admin role cannot read someone else\'s estimate (403)', crossOwnerRes.status === 403);

  // ── Internal (EVA) path ──────────────────────────────────────────────────
  console.log('\nInternal path (simulating EVA)');
  const internalNoKeyRes = await fetch(`${BASE}/internal/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorUserId: 'x', actorName: 'x', actorRole: 'admin', inputs: sampleInputs(),
    }),
  });
  check('internal route rejects a missing/invalid internal key (401)', internalNoKeyRes.status === 401);

  const internalKey = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';
  const internalDeniedRes = await fetch(`${BASE}/internal/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      actorUserId: 'x', actorName: 'x', actorRole: 'guest', inputs: sampleInputs(),
    }),
  });
  check('internal route re-validates the claimed role (unknown role denied, 403)', internalDeniedRes.status === 403);

  const internalOkRes = await fetch(`${BASE}/internal/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      actorUserId: 'eva-sim-user', actorName: 'EVA Simulated User', actorRole: 'estimator', inputs: sampleInputs(),
    }),
  });
  const internalOkData = await internalOkRes.json();
  check('internal route creates an estimate for a permitted role', internalOkRes.ok && internalOkData.success === true);

  // Forged callerUserId cannot bypass ownership checks: a valid internal key
  // plus a permitted role is not enough to read someone else's estimate —
  // estimatesService.js's ownership check (owner-or-admin) still applies to
  // the internal path exactly as it does to the cookie path above.
  const internalOwnedEstimateId = internalOkData.estimate?.id;
  const internalForgedOwnerRes = await fetch(`${BASE}/internal/estimates/${internalOwnedEstimateId}/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      actorUserId: 'a-completely-different-user', actorName: 'Someone Else', actorRole: 'estimator',
    }),
  });
  check('internal route ownership check rejects a forged/mismatched actorUserId (403)',
    internalForgedOwnerRes.status === 403);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
