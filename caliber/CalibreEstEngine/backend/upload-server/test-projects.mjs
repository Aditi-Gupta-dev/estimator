/**
 * Smoke test for the approved-estimate -> project baseline -> tracking
 * lifecycle (Phase 4), plus the Phase 3 resubmission-gap fix (Part 16/17:
 * resubmit via full `inputs` replacement, not just a scenario-style delta).
 *
 * Run against an ISOLATED instance, never the live dev server.
 *   node test-projects.mjs http://localhost:3010
 */
import { COMPONENTS } from '../../frontend/calibre-app/src/constants/estimator-template.js';

const BASE = process.argv[2] || 'http://localhost:3010';

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
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { cookie, user: data.user };
}

async function post(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function patch(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function get(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function sampleOverrides(selected) {
  const overrides = {};
  COMPONENTS.forEach((c) => {
    overrides[c.component] = { complexity: c.default_complexity, volume: c.default_volume, included: false };
  });
  selected.forEach((name) => { overrides[name] = { ...overrides[name], included: true }; });
  return overrides;
}

function sampleInputs(overrideNames = ['Enterprise Structures & Legal Entities']) {
  return {
    industry: 'BFSI',
    overallComplexity: 'H',
    sectionA: {
      duration_months: 18, n_modules: 5, n_entities: 3, n_integrations: 25,
      n_dm_objects: 15, n_reports: 40, n_cemli: 10, integ_complex: 8, integ_simple: 17,
      contingency_pct: 15, mgmt_reserve_pct: 5, working_hours_day: 8, working_days_month: 20,
      onshore_pct: 30,
    },
    overrides: sampleOverrides(overrideNames),
  };
}

async function createEstimate(cookie, name, businessUnit) {
  const { data } = await post(cookie, '/api/estimates', { name, businessUnit, inputs: sampleInputs() });
  return data.estimate;
}

async function createUser(adminCookie, { name, email, role, unit }) {
  const { status, data } = await post(adminCookie, '/api/auth/users', {
    name, email, password: 'Temp1234!', role, unit, department: 'delivery',
  });
  if (status !== 201) throw new Error(`failed to create user ${email}: ${JSON.stringify(data)}`);
  return data.user;
}

/** Drives create -> submit -> assign -> start -> decide(approved) in one
 * shot, returning the approved estimate. Used repeatedly as test setup. */
async function approveEstimate(ownerCookie, adminCookie, reviewerCookie, reviewerId, name, unit) {
  const e = await createEstimate(ownerCookie, name, unit);
  await post(ownerCookie, `/api/estimates/${e.id}/submit`);
  await post(adminCookie, `/api/estimates/${e.id}/assign-reviewer`, { reviewerUserId: reviewerId });
  await post(reviewerCookie, `/api/estimates/${e.id}/review/start`);
  const { data } = await post(reviewerCookie, `/api/estimates/${e.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 1,
  });
  return data.estimate;
}

async function main() {
  console.log(`\nTesting project baseline/tracking lifecycle against ${BASE}\n`);

  const estimator = await login('estimator@calibre.demo', 'Calibre123!');
  const admin = await login('admin@calibre.demo', 'Calibre123!');
  const superUser = await login('super@calibre.demo', 'Calibre123!'); // unit: Oracle ERP
  const sme = await login('sme@calibre.demo', 'Calibre123!');

  const stamp = Date.now();
  const secondEstimatorAccount = await createUser(admin.cookie, {
    name: 'Second Estimator', email: `second-estimator-${stamp}@calibre.demo`, role: 'estimator', unit: 'Oracle ERP',
  });
  const secondEstimator = await login(secondEstimatorAccount.email, 'Temp1234!');

  const secondReviewerAccount = await createUser(admin.cookie, {
    name: 'Second Reviewer P4', email: `second-reviewer-p4-${stamp}@calibre.demo`, role: 'super', unit: 'Oracle ERP',
  });
  const secondReviewer = await login(secondReviewerAccount.email, 'Temp1234!');

  const crossUnitReviewerAccount = await createUser(admin.cookie, {
    name: 'Cross Unit Reviewer P4', email: `cross-unit-p4-${stamp}@calibre.demo`, role: 'super', unit: 'SAP',
  });
  const crossUnitReviewer = await login(crossUnitReviewerAccount.email, 'Temp1234!');

  // ══════════════════════════════════════════════════════════════════════
  // FLOW A — approve -> create project -> baseline -> updates -> status
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow A: approved estimate -> project baseline -> updates -> status transitions');

  const notApproved = await createEstimate(estimator.cookie, 'Not Yet Approved', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${notApproved.id}/submit`);
  const denyUnapproved = await post(admin.cookie, `/api/projects/from-estimate/${notApproved.id}`, { name: 'x' });
  check('9. project cannot be created from an unapproved (submitted) estimate (409)', denyUnapproved.status === 409);

  const toReject = await createEstimate(estimator.cookie, 'To Be Rejected', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${toReject.id}/submit`);
  await post(admin.cookie, `/api/estimates/${toReject.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  await post(superUser.cookie, `/api/estimates/${toReject.id}/review/start`);
  await post(superUser.cookie, `/api/estimates/${toReject.id}/review/decision`, {
    decision: 'rejected', comments: 'Not viable.', reviewedVersion: 1,
  });
  const denyRejected = await post(admin.cookie, `/api/projects/from-estimate/${toReject.id}`, { name: 'x' });
  check('10. project cannot be created from a rejected estimate (409)', denyRejected.status === 409);

  const e1 = await approveEstimate(estimator.cookie, admin.cookie, superUser.cookie, superUser.user.id, 'Flow A Estimate', 'Oracle ERP');
  check('estimate approved for Flow A', e1.status === 'approved' && !!e1.approvedVersionId);

  const denyEstimatorCreate = await post(estimator.cookie, `/api/projects/from-estimate/${e1.id}`, { name: 'x' });
  check('1/18a. unauthorized (estimator) project creation is denied (403)', denyEstimatorCreate.status === 403);

  const create1 = await post(admin.cookie, `/api/projects/from-estimate/${e1.id}`, {
    name: 'Flow A Project', description: 'desc', domain: 'Oracle Fusion ERP',
  });
  check('create project succeeds with a real project_key', create1.status === 200
    && create1.data.created === true
    && /^PRJ-\d{5}$/.test(create1.data.project.projectKey)
    && create1.data.project.estimateId === e1.id
    && create1.data.project.baselineEstimateVersionId === e1.approvedVersionId
    && create1.data.project.status === 'planned');
  const projectId = create1.data.project.id;

  check('estimate approved -> create project -> baseline captured', create1.data.project.baselineEstimateVersionId === e1.approvedVersionId);

  const dupCreate = await post(admin.cookie, `/api/projects/from-estimate/${e1.id}`, {
    name: 'Different Name Should Be Ignored', baselineEstimateVersionId: 'forged-version-id',
  });
  check('11. duplicate active project creation returns the SAME project, not a new one (idempotent)',
    dupCreate.status === 200 && dupCreate.data.created === false && dupCreate.data.project.id === projectId);
  check('12. estimator cannot manipulate baseline_estimate_version_id (server-derived, forged value ignored)',
    dupCreate.data.project.baselineEstimateVersionId === e1.approvedVersionId);

  const listAfterDup = await get(admin.cookie, '/api/projects');
  check('idempotent create did not create a duplicate row', listAfterDup.data.projects.filter((p) => p.estimateId === e1.id).length === 1);

  const baseline1 = await get(admin.cookie, `/api/projects/${projectId}/baseline`);
  check('get project baseline', baseline1.status === 200
    && baseline1.data.baseline.version.version === 1
    && baseline1.data.baseline.approvedByUserId === superUser.user.id);

  const forgedMetaPatch = await patch(admin.cookie, `/api/projects/${projectId}`, {
    name: 'Renamed', baselineEstimateVersionId: 'forged-again',
  });
  check('5. baseline cannot be changed after project creation (PATCH ignores the field entirely)',
    forgedMetaPatch.data.project.baselineEstimateVersionId === e1.approvedVersionId
    && forgedMetaPatch.data.project.name === 'Renamed');

  const forgedActorUpdate = await post(estimator.cookie, `/api/projects/${projectId}/updates`, {
    updateType: 'progress', title: 'Kickoff complete', createdBy: 'someone-else-entirely',
  });
  check('2. project created -> add update -> update persisted', forgedActorUpdate.status === 200 && !!forgedActorUpdate.data.update.id);
  check('7. project updates cannot be attributed to another actor (server-derived from session)',
    forgedActorUpdate.data.update.createdBy === estimator.user.id);

  const signalUpdate = await post(estimator.cookie, `/api/projects/${projectId}/updates`, {
    updateType: 'risk', title: 'Scope increased by 20%', description: 'client added modules',
    metadata: { actualEffortDays: 40, actualCost: 99999 }, requiresEstimateReview: true,
  });
  check('3. project update -> requires_estimate_review signal persisted', signalUpdate.data.update.requiresEstimateReview === true);
  check('estimator (no RATE_CARD_VIEW) never receives actualCost', signalUpdate.data.update.metadata.actualCost === undefined
    && signalUpdate.data.update.metadata.actualEffortDays === 40);

  const updatesAsAdmin = await get(admin.cookie, `/api/projects/${projectId}/updates`);
  check('admin (RATE_CARD_VIEW) receives actualCost', updatesAsAdmin.data.updates.some((u) => u.metadata?.actualCost === 99999));
  check('updates independently queryable, both preserved', updatesAsAdmin.data.updates.length === 2);

  const reviewerNotifs = await get(superUser.cookie, '/api/notifications');
  check('reviewer notified of the estimate-review signal', reviewerNotifs.data.notifications.some(
    (n) => n.type === 'estimate_review_signal' && n.projectId === projectId,
  ));

  // ── status transitions (Part 14 / 18.8) ──────────────────────────────────
  const badJump = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'completed' });
  check('8. arbitrary transition PLANNED->COMPLETED fails (422)', badJump.status === 422);

  const toActive = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'active' });
  check('PLANNED -> ACTIVE succeeds, started_at set', toActive.data.project.status === 'active' && !!toActive.data.project.startedAt);

  const backToPlanned = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'planned' });
  check('8. arbitrary transition ACTIVE->PLANNED fails (422)', backToPlanned.status === 422);

  const toHold = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'on_hold' });
  check('ACTIVE -> ON_HOLD succeeds', toHold.data.project.status === 'on_hold');

  const backActive = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'active' });
  check('ON_HOLD -> ACTIVE succeeds', backActive.data.project.status === 'active');

  const toCompleted = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'completed' });
  check('ACTIVE -> COMPLETED succeeds, completed_at set', toCompleted.data.project.status === 'completed' && !!toCompleted.data.project.completedAt);

  const afterTerminal = await patch(admin.cookie, `/api/projects/${projectId}/status`, { status: 'active' });
  check('COMPLETED is terminal — no path back to ACTIVE (422)', afterTerminal.status === 422);

  // ══════════════════════════════════════════════════════════════════════
  // FLOW B — access control: outside unit, non-owner, unrelated project
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow B: project access control (unit scope, ownership)');

  const e2 = await approveEstimate(secondEstimator.cookie, admin.cookie, secondReviewer.cookie, secondReviewer.user.id, 'Flow B Estimate', 'Oracle ERP');
  const create2 = await post(admin.cookie, `/api/projects/from-estimate/${e2.id}`, { name: 'Flow B Project' });
  const project2Id = create2.data.project.id;

  const estimatorDenied = await get(estimator.cookie, `/api/projects/${project2Id}`);
  check('3. estimator cannot access another user\'s project (403)', estimatorDenied.status === 403);

  const crossUnitDenied = await get(crossUnitReviewer.cookie, `/api/projects/${project2Id}`);
  check('2/4. reviewer outside the project\'s unit is denied (403)', crossUnitDenied.status === 403);

  const sameUnitReviewerAllowed = await get(superUser.cookie, `/api/projects/${project2Id}`);
  check('same-unit super IS allowed (unit-scoped access, not assignment-scoped)', sameUnitReviewerAllowed.status === 200);

  const smeDenied = await get(sme.cookie, `/api/projects/${project2Id}`);
  check('sme (not owner, not admin/super) is denied (403)', smeDenied.status === 403);

  const ownerAllowed = await get(secondEstimator.cookie, `/api/projects/${project2Id}`);
  check('project owner (the estimate\'s original owner) can access', ownerAllowed.status === 200);

  const superListScoped = await get(superUser.cookie, '/api/projects');
  check('super list is unit-scoped (does not include cross-unit projects)', superListScoped.data.projects.every((p) => p.unit === 'Oracle ERP'));

  // ══════════════════════════════════════════════════════════════════════
  // FLOW C — Phase 3 resubmission-gap fix: revise via full inputs (Part 16/17)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow C: revise estimate via full inputs (Phase 3 gap fix) -> V2 -> approve -> new baseline');

  const e3 = await createEstimate(estimator.cookie, 'Flow C Estimate', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${e3.id}/submit`);
  await post(admin.cookie, `/api/estimates/${e3.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  await post(superUser.cookie, `/api/estimates/${e3.id}/review/start`);
  await post(superUser.cookie, `/api/estimates/${e3.id}/review/decision`, {
    decision: 'changes_requested', comments: 'Add the missing integration components.', reviewedVersion: 1,
  });

  const missingReason = await post(estimator.cookie, `/api/estimates/${e3.id}/resubmit`, {
    inputs: sampleInputs(['Enterprise Structures & Legal Entities', 'Data Migration']),
  });
  check('16. revised version requires change_reason (422 without it)', missingReason.status === 422);

  const badInputs = await post(estimator.cookie, `/api/estimates/${e3.id}/resubmit`, {
    inputs: { industry: 'BFSI' }, changeReason: 'incomplete inputs on purpose',
  });
  check('resubmit with incomplete inputs is rejected (422)', badInputs.status === 422);

  const revise = await post(estimator.cookie, `/api/estimates/${e3.id}/resubmit`, {
    inputs: sampleInputs(['Enterprise Structures & Legal Entities', 'Data Migration']),
    changeReason: 'Added the data migration components the reviewer flagged as missing.',
  });
  check('4. CHANGES_REQUESTED -> revise (full inputs) -> V2 created -> submitted',
    revise.status === 200 && revise.data.estimate.currentVersion === 2 && revise.data.estimate.status === 'submitted');

  const history3 = await get(estimator.cookie, `/api/estimates/${e3.id}/history`);
  const v1 = history3.data.versions.find((v) => v.version === 1);
  const v2 = history3.data.versions.find((v) => v.version === 2);
  check('14. revised version belongs to the SAME estimate (no new estimate created)', history3.data.versions.length === 2);
  check('15. revised version has previousVersionId pointing at V1', v2.previousVersionId === v1.id);
  check('revised version carries the required change_reason', v2.changeReason.includes('data migration'));
  check('13/5. V1 remains immutable — original inputs untouched', JSON.stringify(v1.inputs.overrides['Data Migration']) === undefined
    || v1.inputs.overrides['Data Migration'].included === false);

  const reviews3 = await get(estimator.cookie, `/api/estimates/${e3.id}/reviews`);
  check('6/17. old (V1 changes_requested) review remains intact and independently queryable',
    reviews3.data.reviews.length === 1 && reviews3.data.reviews[0].version === 1 && reviews3.data.reviews[0].decision === 'changes_requested');

  const start3b = await post(superUser.cookie, `/api/estimates/${e3.id}/review/start`);
  const approve3b = await post(superUser.cookie, `/api/estimates/${e3.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 2,
  });
  check('18. new (revised) version can be resubmitted for review and approved',
    start3b.data.success && approve3b.data.estimate.status === 'approved' && approve3b.data.estimate.approvedVersionId === v2.id);

  const reviews3b = await get(estimator.cookie, `/api/estimates/${e3.id}/reviews`);
  check('V1 review still present after V2 is independently reviewed/approved (never overwritten)',
    reviews3b.data.reviews.length === 2
    && reviews3b.data.reviews.some((r) => r.version === 1 && r.decision === 'changes_requested')
    && reviews3b.data.reviews.some((r) => r.version === 2 && r.decision === 'approved'));

  const create3 = await post(admin.cookie, `/api/projects/from-estimate/${e3.id}`, { name: 'Flow C Project' });
  check('project baseline is the version that was ACTUALLY approved (V2), not V1',
    create3.data.project.baselineEstimateVersionId === v2.id && create3.data.project.baselineEstimateVersionId !== v1.id);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
