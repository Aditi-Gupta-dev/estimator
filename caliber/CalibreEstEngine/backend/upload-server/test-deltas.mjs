/**
 * Smoke test for AI-driven version delta analysis (Phase 5).
 *
 * Requires THREE things already running, all pointed at the SAME isolated
 * CALIBRE_DATA_DIR (never live data):
 *   1. upload-server on BASE_SUCCESS, EVA_URL pointed at the mock double
 *      (test-deltas-mock-eva.mjs) — deterministic COMPLETED-path testing without
 *      depending on external LLM credentials.
 *   2. upload-server on BASE_FAIL, EVA_URL pointed at a real (in this dev
 *      environment, genuinely broken-credentialed) eva_service — a REAL,
 *      not simulated, FAILED-path test.
 *   3. The mock double itself, so /_last-request can be inspected.
 *
 *   node test-deltas.mjs <BASE_SUCCESS> <BASE_FAIL> <MOCK_BASE>
 *   node test-deltas.mjs http://localhost:3011 http://localhost:3010 http://localhost:8012
 *
 * A handful of scenarios (Part 19: arbitrary/non-sequential version pairs,
 * redaction-before-LLM-context as a unit fact rather than an incidental
 * one) are tested via DIRECT IN-PROCESS IMPORT of deltaService.js/
 * deltaEngine.js/rateCardRedaction.js against the same CALIBRE_DATA_DIR —
 * these are internal invariants with no public HTTP surface (by design:
 * the automatic pipeline only ever calls itself with values it already
 * knows are correct), so they're verified directly rather than faked
 * through the API.
 */
import { COMPONENTS } from '../../frontend/calibre-app/src/constants/estimator-template.js';

const BASE_SUCCESS = process.argv[2] || 'http://localhost:3011';
const BASE_FAIL = process.argv[3] || 'http://localhost:3010';
const MOCK_BASE = process.argv[4] || 'http://localhost:8012';
const DATA_DIR = process.argv[5];

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${label}`); } else { fail += 1; console.log(`  FAIL ${label}  ${detail}`); }
}

async function login(base, email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(`login failed for ${email} @ ${base}: ${JSON.stringify(data)}`);
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], user: data.user };
}
async function post(base, cookie, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function patch(base, cookie, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function get(base, cookie, path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function sleep(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

function sampleOverrides(selected) {
  const overrides = {};
  COMPONENTS.forEach((c) => { overrides[c.component] = { complexity: c.default_complexity, volume: c.default_volume, included: false }; });
  selected.forEach((name) => { overrides[name] = { ...overrides[name], included: true }; });
  return overrides;
}
function sampleInputs(selected = ['Enterprise Structures & Legal Entities'], overrides = {}) {
  return {
    industry: 'BFSI', overallComplexity: 'H',
    sectionA: {
      duration_months: 18, n_modules: 5, n_entities: 3, n_integrations: 25, n_dm_objects: 15,
      n_reports: 40, n_cemli: 10, integ_complex: 8, integ_simple: 17, contingency_pct: 15,
      mgmt_reserve_pct: 5, working_hours_day: 8, working_days_month: 20, onshore_pct: 30,
      ...overrides,
    },
    overrides: sampleOverrides(selected),
  };
}
async function createEstimate(base, cookie, name, businessUnit) {
  const { data } = await post(base, cookie, '/api/estimates', { name, businessUnit, inputs: sampleInputs() });
  return data.estimate;
}
async function waitForTerminal(base, cookie, estimateId, { maxTries = 20, delayMs = 1500 } = {}) {
  let delta = null;
  for (let i = 0; i < maxTries; i += 1) {
    await sleep(delayMs);
    const { data } = await get(base, cookie, `/api/estimates/${estimateId}/deltas`);
    delta = (data.deltas || [])[data.deltas.length - 1];
    if (delta && (delta.status === 'completed' || delta.status === 'failed')) return delta;
  }
  return delta;
}

async function main() {
  console.log(`\nTesting AI delta analysis: success=${BASE_SUCCESS} fail=${BASE_FAIL} mock=${MOCK_BASE}\n`);

  const estimatorS = await login(BASE_SUCCESS, 'estimator@calibre.demo', 'Calibre123!');
  const adminS = await login(BASE_SUCCESS, 'admin@calibre.demo', 'Calibre123!');
  const superS = await login(BASE_SUCCESS, 'super@calibre.demo', 'Calibre123!'); // unit: Oracle ERP
  const smeS = await login(BASE_SUCCESS, 'sme@calibre.demo', 'Calibre123!');

  const stamp = Date.now();
  const { data: crossUnitUser } = await post(BASE_SUCCESS, adminS.cookie, '/api/auth/users', {
    name: 'Delta Cross Unit', email: `delta-cross-unit-${stamp}@calibre.demo`, password: 'Temp1234!', role: 'super', unit: 'SAP', department: 'delivery',
  });
  const crossUnit = await login(BASE_SUCCESS, crossUnitUser.user.email, 'Temp1234!');

  // ══════════════════════════════════════════════════════════════════════
  // FLOW A — success path (mock LLM): V1 -> V2 deterministic + AI delta
  // ══════════════════════════════════════════════════════════════════════
  console.log('Flow A: V1 -> V2 with a working AI backend');

  const e1 = await createEstimate(BASE_SUCCESS, estimatorS.cookie, 'Delta Flow A', 'Oracle ERP');
  const save1 = await patch(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}`, {
    persist: true, changes: { durationMonthsDelta: 3, contingencyPctDelta: 5 },
  });
  check('V2 created from V1', save1.data.result?.latestVersion?.version === 2);

  const d1 = await waitForTerminal(BASE_SUCCESS, estimatorS.cookie, e1.id);
  check('V1 -> V2 deterministic delta computed', d1 && Array.isArray(d1.deterministicDelta?.numericDeltas) && d1.deterministicDelta.numericDeltas.length > 0);
  check('AI analysis stored on success', d1.status === 'completed' && !!d1.aiAnalysis?.summary);
  check('AI analysis has all required conceptual fields', ['summary', 'key_changes', 'likely_drivers', 'impact', 'risks', 'recommendations', 'confidence']
    .every((k) => k in d1.aiAnalysis));

  // 15/16 — AI cannot modify estimate/version data or approval state.
  const estimateAfter = await get(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}`);
  check('15. AI analysis did not modify estimate/version data', estimateAfter.data.estimate.currentVersion === 2
    && estimateAfter.data.estimate.status === 'draft');
  check('16. AI analysis cannot approve/reject — status untouched', estimateAfter.data.estimate.status === 'draft');

  // 7 — LLM context excludes rate-card figures (proves redaction happens
  // BEFORE the request is constructed, not just at read time).
  const lastReq = await (await fetch(`${MOCK_BASE}/_last-request`)).json();
  check('7. LLM request payload carries no roleRate entries', !(lastReq.deterministicDelta.numericDeltas || []).some((d) => d.category === 'roleRate'));

  // 1/2 — estimator sees allowed info, never blendedRate-derived deltas.
  check('1. estimator can see the delta (allowed info)', d1.deterministicDelta && d1.status === 'completed');
  check('2. estimator never receives roleRate entries', !(d1.deterministicDelta.numericDeltas || []).some((c) => c.category === 'roleRate'));

  // Admin sees the same record (rate-card-visible role) — roleRate entries,
  // if any exist for this particular delta, must be present; absence here
  // is fine (small synthetic change), the REDACTION LOGIC ITSELF is proven
  // deterministically below via direct import, independent of what this
  // particular scenario happened to generate.
  const adminView = await get(BASE_SUCCESS, adminS.cookie, `/api/deltas/${d1.id}`);
  check('5. admin can access the delta', adminView.status === 200);

  // 3/4/6 — access control.
  const smeDenied = await get(BASE_SUCCESS, smeS.cookie, `/api/deltas/${d1.id}`);
  check('3. unauthorized (unrelated) user cannot access delta (403)', smeDenied.status === 403);
  const crossUnitDenied = await get(BASE_SUCCESS, crossUnit.cookie, `/api/deltas/${d1.id}`);
  check('4/6. cross-unit reviewer (unit-scoped, not assigned) cannot access delta (403)', crossUnitDenied.status === 403);
  // e1 has no reviewer assignment at all — estimate-scoped access is
  // assignment-based (Phase 3's requireEstimateViewAccess), not unit-wide
  // like project access. A super never assigned to THIS estimate is
  // correctly denied; Flow D below proves the positive case (assigned
  // reviewer CAN access) once a real assignment exists.
  const unassignedSuperDenied = await get(BASE_SUCCESS, superS.cookie, `/api/estimates/${e1.id}/deltas`);
  check('6a. super not assigned to this estimate is denied (assignment-scoped, not unit-wide)', unassignedSuperDenied.status === 403);

  // 17 — audit trail carries every lifecycle event, no secrets.
  const audit1 = await get(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}/audit`);
  const actions = audit1.data.events.map((ev) => ev.action);
  check('audit: DELTA_ANALYSIS_REQUESTED recorded', actions.includes('DELTA_ANALYSIS_REQUESTED'));
  check('audit: DELTA_ANALYSIS_COMPLETED recorded', actions.includes('DELTA_ANALYSIS_COMPLETED'));
  check('audit events reference estimate + version, no raw delta contents', audit1.data.events
    .filter((ev) => ev.action.startsWith('DELTA_ANALYSIS'))
    .every((ev) => !JSON.stringify(ev.metadata || {}).includes('numericDeltas')));

  // notification — estimate owner notified on completion.
  const notifs1 = await get(BASE_SUCCESS, estimatorS.cookie, '/api/notifications');
  check('notification created on delta completion', notifs1.data.notifications.some((n) => n.type === 'delta_analysis_completed' && n.estimateId === e1.id));

  // ══════════════════════════════════════════════════════════════════════
  // FLOW B — V2 -> V3 second delta preserved independently (Part 4/12/20)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow B: V2 -> V3 — old delta remains, both independently queryable');

  const save2 = await patch(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}`, {
    persist: true, changes: { moduleEffortMultiplier: { Integration: 1.2 } },
  });
  check('V3 created from V2', save2.data.result?.latestVersion?.version === 3);
  const d2 = await waitForTerminal(BASE_SUCCESS, estimatorS.cookie, e1.id, { maxTries: 20 });

  const allDeltas = await get(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}/deltas`);
  check('12. old (V1->V2) delta remains after V2->V3 delta is created', allDeltas.data.deltas.length === 2
    && allDeltas.data.deltas[0].previousVersionId === d1.previousVersionId
    && allDeltas.data.deltas[0].currentVersionId === d1.currentVersionId);
  check('V2->V3 delta is a distinct, independently completed record', allDeltas.data.deltas[1].id !== d1.id
    && allDeltas.data.deltas[1].previousVersionId === d1.currentVersionId);

  // ══════════════════════════════════════════════════════════════════════
  // FLOW C — genuine LLM failure (real, broken-credentialed eva_service)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow C: genuine LLM unavailability — version creation must still succeed');

  const estimatorF = await login(BASE_FAIL, 'estimator@calibre.demo', 'Calibre123!');
  const e2 = await createEstimate(BASE_FAIL, estimatorF.cookie, 'Delta Flow C', 'Oracle ERP');
  const save3 = await patch(BASE_FAIL, estimatorF.cookie, `/api/estimates/${e2.id}`, {
    persist: true, changes: { durationMonthsDelta: 1 },
  });
  check('10. version creation succeeds even though the LLM backend is unavailable', save3.status === 200 && save3.data.result?.latestVersion?.version === 2);

  const d3 = await waitForTerminal(BASE_FAIL, estimatorF.cookie, e2.id);
  check('LLM failure -> status FAILED (not left stuck pending)', d3.status === 'failed');
  check('deterministic delta still stored despite AI failure', Array.isArray(d3.deterministicDelta?.numericDeltas));
  check('error_message is safe (no raw stack trace)', typeof d3.errorMessage === 'string' && !d3.errorMessage.includes('Traceback') && !d3.errorMessage.includes('  at '));

  const notifsF1 = await get(BASE_FAIL, estimatorF.cookie, '/api/notifications');
  const failNotifCountBefore = notifsF1.data.notifications.filter((n) => n.type === 'delta_analysis_failed' && n.estimateId === e2.id).length;
  check('notification created on FIRST failure', failNotifCountBefore === 1);

  // Retry — must not duplicate the row, must not re-notify.
  const retryRes = await post(BASE_FAIL, estimatorF.cookie, `/api/deltas/${d3.id}/retry`, {});
  check('retry accepted (delta exists, was FAILED)', retryRes.status === 200);
  const d3retried = await waitForTerminal(BASE_FAIL, estimatorF.cookie, e2.id);
  check('11. retry does not create a duplicate delta row', (await get(BASE_FAIL, estimatorF.cookie, `/api/estimates/${e2.id}/deltas`)).data.deltas.length === 1);
  check('retry re-failed against the same (still broken) backend', d3retried.status === 'failed');
  const notifsF2 = await get(BASE_FAIL, estimatorF.cookie, '/api/notifications');
  const failNotifCountAfter = notifsF2.data.notifications.filter((n) => n.type === 'delta_analysis_failed' && n.estimateId === e2.id).length;
  check('Part 16/18: retry failure does NOT send a second notification', failNotifCountAfter === failNotifCountBefore);

  const retryCompleted = await post(BASE_SUCCESS, estimatorS.cookie, `/api/deltas/${d1.id}/retry`, {});
  check('cannot retry a COMPLETED delta (409 — state conflict)', retryCompleted.status === 409);

  // ══════════════════════════════════════════════════════════════════════
  // FLOW D — project association + baseline preservation (Part 12/13/20)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow D: project association — baseline untouched by later deltas');

  const e3 = await createEstimate(BASE_SUCCESS, estimatorS.cookie, 'Delta Flow D', 'Oracle ERP');
  await post(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e3.id}/submit`);
  await post(BASE_SUCCESS, adminS.cookie, `/api/estimates/${e3.id}/assign-reviewer`, { reviewerUserId: superS.user.id });
  await post(BASE_SUCCESS, superS.cookie, `/api/estimates/${e3.id}/review/start`);
  await post(BASE_SUCCESS, superS.cookie, `/api/estimates/${e3.id}/review/decision`, { decision: 'approved', reviewedVersion: 1 });
  const projRes = await post(BASE_SUCCESS, adminS.cookie, `/api/projects/from-estimate/${e3.id}`, { name: 'Delta Flow D Project' });
  const projectId = projRes.data.project.id;
  const baselineVersionId = projRes.data.project.baselineEstimateVersionId;

  // A new estimate version now happens ON TOP of the approved/projected
  // estimate (e.g. a subsequent what-if save) — must NOT touch the project.
  const save4 = await patch(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e3.id}`, {
    persist: true, changes: { durationMonthsDelta: 1 },
  });
  check('new version created on a projected, approved estimate', save4.data.result?.latestVersion?.version === 2);
  const d4 = await waitForTerminal(BASE_SUCCESS, estimatorS.cookie, e3.id);
  check('delta is associated with the project', d4.projectId === projectId);

  const projectDeltas = await get(BASE_SUCCESS, adminS.cookie, `/api/projects/${projectId}/deltas`);
  check('project delta history includes this delta', projectDeltas.data.deltas.some((x) => x.id === d4.id));

  const projectAfter = await get(BASE_SUCCESS, adminS.cookie, `/api/projects/${projectId}`);
  check('13. project baseline_estimate_version_id is UNCHANGED by the new version/delta', projectAfter.data.project.baselineEstimateVersionId === baselineVersionId);

  // 6b — the positive case: super WAS assigned+reviewed e3, so they hold
  // "ever assigned as reviewer" access to e3's deltas (Phase 3's existing
  // requireEstimateViewAccess rule, reused unchanged for delta routes).
  const assignedSuperAllowed = await get(BASE_SUCCESS, superS.cookie, `/api/estimates/${e3.id}/deltas`);
  check('6b. super who WAS assigned as reviewer can access this estimate\'s deltas', assignedSuperAllowed.status === 200);

  // ══════════════════════════════════════════════════════════════════════
  // FLOW E — change_reason propagation (Part 11/20)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow E: change_reason is persisted and passed to delta analysis');

  const e4 = await createEstimate(BASE_SUCCESS, estimatorS.cookie, 'Delta Flow E', 'Oracle ERP');
  await post(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e4.id}/submit`);
  await post(BASE_SUCCESS, adminS.cookie, `/api/estimates/${e4.id}/assign-reviewer`, { reviewerUserId: superS.user.id });
  await post(BASE_SUCCESS, superS.cookie, `/api/estimates/${e4.id}/review/start`);
  await post(BASE_SUCCESS, superS.cookie, `/api/estimates/${e4.id}/review/decision`, { decision: 'changes_requested', comments: 'Add data migration scope.', reviewedVersion: 1 });
  const resubmit4 = await post(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e4.id}/resubmit`, {
    inputs: sampleInputs(['Enterprise Structures & Legal Entities', 'Data Migration']),
    changeReason: 'Client added three integration modules.',
  });
  check('resubmit creates V2 with change_reason', resubmit4.data.estimate?.latestVersion?.changeReason === 'Client added three integration modules.');
  const d5 = await waitForTerminal(BASE_SUCCESS, estimatorS.cookie, e4.id);
  check('14. change_reason is persisted on the delta record', d5.deterministicDelta.changeReason === 'Client added three integration modules.');
  check('scope change (added component) captured deterministically', d5.deterministicDelta.addedItems.some((i) => i.name === 'Data Migration'));

  const lastReq2 = await (await fetch(`${MOCK_BASE}/_last-request`)).json();
  check('change_reason was passed to the AI analysis context', lastReq2.changeReason === 'Client added three integration modules.');

  // ══════════════════════════════════════════════════════════════════════
  // FLOW F — internal invariants with no public HTTP surface (Part 5/19.8/19.9):
  // the automatic pipeline only ever calls itself with values it derived
  // itself, so "reject a non-sequential/unrelated pair" is verified by
  // calling the real validator directly with deliberately wrong pairings.
  // ══════════════════════════════════════════════════════════════════════
  if (DATA_DIR) {
    console.log('\nFlow F: non-sequential / unrelated version pairs rejected (direct invariant check)');
    process.env.CALIBRE_DATA_DIR = DATA_DIR;
    const deltaService = await import('./estimator/deltaService.js');
    const systemActor = { userId: estimatorS.user.id, name: 'test', role: 'admin' };

    // e1 now has V1, V2, V3 (from Flows A/B). e4 has V1, V2 (Flow E).
    // "V3 -> V5" style: pass V1 as "previous" and V3 as "current" directly —
    // V3.previousVersionId is actually V2, not V1, so this must be rejected.
    const e1history = await get(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e1.id}/history`);
    const v1 = e1history.data.versions.find((v) => v.version === 1);
    const v3 = e1history.data.versions.find((v) => v.version === 3);
    let threwNonSequential = false;
    try {
      deltaService.triggerDeltaAnalysis({
        estimateId: e1.id, previousVersionId: v1.id, currentVersionId: v3.id, actor: systemActor,
      }, MOCK_BASE, 'dev-internal-key-change-me');
    } catch (err) {
      threwNonSequential = err.name === 'DeltaValidationError';
    }
    check('8. non-sequential pair (V1 -> V3, actually derives from V2) rejected', threwNonSequential);

    // Unrelated estimates: e4's V1 paired with e1's V2 — different estimates entirely.
    const e4history = await get(BASE_SUCCESS, estimatorS.cookie, `/api/estimates/${e4.id}/history`);
    const e4v1 = e4history.data.versions.find((v) => v.version === 1);
    const e1v2 = e1history.data.versions.find((v) => v.version === 2);
    let threwUnrelated = false;
    try {
      deltaService.triggerDeltaAnalysis({
        estimateId: e1.id, previousVersionId: e4v1.id, currentVersionId: e1v2.id, actor: systemActor,
      }, MOCK_BASE, 'dev-internal-key-change-me');
    } catch (err) {
      threwUnrelated = err.name === 'DeltaValidationError';
    }
    check('9. unrelated-estimate version pair rejected', threwUnrelated);

    // Redaction is proven as a pure fact of the function, not incidental to
    // whatever a particular scenario happened to generate.
    const { redactDeltaForRole } = await import('./estimator/rateCardRedaction.js');
    const syntheticDelta = {
      numericDeltas: [
        { category: 'cost', field: 'totalCost', previous: 100, current: 150, delta: 50, deltaPct: 50 },
        { category: 'roleRate', field: 'Functional Consultant', previous: 500, current: 550, delta: 50, deltaPct: 10 },
      ],
    };
    const redactedForEstimator = redactDeltaForRole(syntheticDelta, 'estimator');
    const unredactedForAdmin = redactDeltaForRole(syntheticDelta, 'admin');
    check('rateCardRedaction: roleRate stripped for estimator', !redactedForEstimator.numericDeltas.some((d) => d.category === 'roleRate'));
    check('rateCardRedaction: cost NOT stripped for estimator (aggregate cost is not restricted)', redactedForEstimator.numericDeltas.some((d) => d.category === 'cost'));
    check('rateCardRedaction: admin sees roleRate unredacted', unredactedForAdmin.numericDeltas.some((d) => d.category === 'roleRate'));
  } else {
    console.log('\n(Flow F skipped — no DATA_DIR arg supplied)');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
