/**
 * Smoke test for the estimate review/approval lifecycle (Phase 3).
 *
 * Run against an ISOLATED instance, never the live dev server — see this
 * session's standing verification discipline.
 *   node test-review-workflow.mjs http://localhost:3010
 *
 * Uses the seeded demo accounts (password Calibre123! for all) plus two
 * ad-hoc reviewer accounts created via the admin user-management API
 * (needed for the "second reviewer, not assigned" and "cross-unit
 * reviewer" security scenarios).
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
    overrides: sampleOverrides(['Enterprise Structures & Legal Entities']),
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

async function main() {
  console.log(`\nTesting estimate review/approval lifecycle against ${BASE}\n`);

  const estimator = await login('estimator@calibre.demo', 'Calibre123!');
  const admin = await login('admin@calibre.demo', 'Calibre123!');
  const superUser = await login('super@calibre.demo', 'Calibre123!'); // unit: Oracle ERP
  console.log(`reviewer (super) unit: ${superUser.user.unit}`);

  const stamp = Date.now();
  const secondReviewerAccount = await createUser(admin.cookie, {
    name: 'Second Reviewer', email: `second-reviewer-${stamp}@calibre.demo`, role: 'super', unit: 'Oracle ERP',
  });
  const secondReviewer = await login(secondReviewerAccount.email, 'Temp1234!');

  const crossUnitReviewerAccount = await createUser(admin.cookie, {
    name: 'Cross Unit Reviewer', email: `cross-unit-${stamp}@calibre.demo`, role: 'super', unit: 'SAP',
  });
  const crossUnitReviewer = await login(crossUnitReviewerAccount.email, 'Temp1234!');

  // ══════════════════════════════════════════════════════════════════════
  // FLOW 1 — full lifecycle: create → submit → assign → review → changes
  // requested → resubmit (V2) → review V2 → approve. Covers tests 1-5,
  // 8-14.
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow 1: full lifecycle (changes requested -> resubmit -> approve)');

  const e1 = await createEstimate(estimator.cookie, 'Flow1 Estimate', 'Oracle ERP');
  check('1. estimator creates estimate', !!e1?.id && e1.status === 'draft');

  const submit1 = await post(estimator.cookie, `/api/estimates/${e1.id}/submit`);
  check('2. estimator submits', submit1.data.success && submit1.data.estimate.status === 'submitted');

  const assign1 = await post(admin.cookie, `/api/estimates/${e1.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  check('3. reviewer assignment persisted', assign1.data.success
    && assign1.data.assignment.reviewerUserId === superUser.user.id
    && assign1.data.assignment.status === 'assigned');

  const queue1 = await get(superUser.cookie, '/api/review-queue');
  check('4. reviewer sees the assigned estimate in their queue', queue1.data.success
    && queue1.data.queue.some((q) => q.estimate?.id === e1.id));

  const start1 = await post(superUser.cookie, `/api/estimates/${e1.id}/review/start`);
  check('5. reviewer starts review (SUBMITTED -> UNDER_REVIEW)', start1.data.success
    && start1.data.estimate.status === 'under_review');

  const changes1 = await post(superUser.cookie, `/api/estimates/${e1.id}/review/decision`, {
    decision: 'changes_requested', comments: 'Please clarify the integration count.', reviewedVersion: 1,
  });
  check('8. reviewer requests changes', changes1.data.success && changes1.data.estimate.status === 'changes_requested');

  const feedback1 = await get(estimator.cookie, `/api/estimates/${e1.id}/reviews`);
  check('9. estimator sees reviewer feedback', feedback1.data.success
    && feedback1.data.reviews.length === 1
    && feedback1.data.reviews[0].decision === 'changes_requested'
    && feedback1.data.reviews[0].comments.includes('integration'));
  const estimatorNotifs1 = await get(estimator.cookie, '/api/notifications');
  check('9b. estimator notified of changes requested', estimatorNotifs1.data.notifications.some(
    (n) => n.type === 'changes_requested' && n.estimateId === e1.id,
  ));

  const resubmit1 = await post(estimator.cookie, `/api/estimates/${e1.id}/resubmit`, {
    changes: { durationMonthsDelta: 1 }, changeReason: 'Extended duration per reviewer feedback.',
  });
  check('10/11. estimator creates V2 and resubmits', resubmit1.data.success
    && resubmit1.data.estimate.currentVersion === 2
    && resubmit1.data.estimate.status === 'submitted');

  const history1 = await get(estimator.cookie, `/api/estimates/${e1.id}/history`);
  check('12. V1 remains immutable alongside the new V2', history1.data.versions.length === 2
    && history1.data.versions[0].version === 1 && history1.data.versions[0].changeReason === null
    && history1.data.versions[1].version === 2 && history1.data.versions[1].changeReason.includes('duration')
    && history1.data.versions[1].previousVersionId === history1.data.versions[0].id);

  const start1b = await post(superUser.cookie, `/api/estimates/${e1.id}/review/start`);
  check('14a. reviewer independently starts review of V2', start1b.data.success
    && start1b.data.estimate.currentVersion === 2 && start1b.data.estimate.status === 'under_review');

  const approve1 = await post(superUser.cookie, `/api/estimates/${e1.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 2,
  });
  check('6/14b. reviewer approves V2', approve1.data.success && approve1.data.estimate.status === 'approved'
    && approve1.data.estimate.approvedVersionId === approve1.data.estimate.latestVersion.id);

  const finalReviews1 = await get(estimator.cookie, `/api/estimates/${e1.id}/reviews`);
  check('13/14c. BOTH V1 (changes_requested) and V2 (approved) reviews preserved independently — V1 never overwritten',
    finalReviews1.data.reviews.length === 2
    && finalReviews1.data.reviews[0].version === 1 && finalReviews1.data.reviews[0].decision === 'changes_requested'
    && finalReviews1.data.reviews[1].version === 2 && finalReviews1.data.reviews[1].decision === 'approved');

  // ══════════════════════════════════════════════════════════════════════
  // FLOW 2 — straightforward reject (test 7)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow 2: straightforward reject');
  const e2 = await createEstimate(estimator.cookie, 'Flow2 Reject', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${e2.id}/submit`);
  await post(admin.cookie, `/api/estimates/${e2.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  await post(superUser.cookie, `/api/estimates/${e2.id}/review/start`);

  const rejectNoComment = await post(superUser.cookie, `/api/estimates/${e2.id}/review/decision`, {
    decision: 'rejected', reviewedVersion: 1,
  });
  check('9a-guard. reject without a comment is rejected by the server', rejectNoComment.status === 422);

  const reject2 = await post(superUser.cookie, `/api/estimates/${e2.id}/review/decision`, {
    decision: 'rejected', comments: 'Scope exceeds the agreed budget envelope.', reviewedVersion: 1,
  });
  check('7. reviewer rejects (with required reason)', reject2.data.success && reject2.data.estimate.status === 'rejected');
  const estimatorNotifs2 = await get(estimator.cookie, '/api/notifications');
  check('7b. estimator notified of rejection', estimatorNotifs2.data.notifications.some(
    (n) => n.type === 'estimate_rejected' && n.estimateId === e2.id,
  ));

  // ══════════════════════════════════════════════════════════════════════
  // FLOW 3 — reviewer ping + notifications + audit trail (tests 15, 16, 17)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nFlow 3: reviewer ping, notifications, audit trail');
  const e3 = await createEstimate(estimator.cookie, 'Flow3 Ping', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${e3.id}/submit`);
  await post(admin.cookie, `/api/estimates/${e3.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });

  const ping3 = await post(estimator.cookie, `/api/estimates/${e3.id}/ping-reviewer`);
  check('15. estimator pings the assigned reviewer', ping3.data.success && ping3.data.pinged === true);

  const ping3Again = await post(estimator.cookie, `/api/estimates/${e3.id}/ping-reviewer`);
  check('15b. repeated ping within the debounce window is rejected (429)', ping3Again.status === 429);

  const reviewerNotifs3 = await get(superUser.cookie, '/api/notifications');
  check('16. notification is a persisted record, not just a toast', reviewerNotifs3.data.success
    && reviewerNotifs3.data.notifications.some((n) => n.type === 'reviewer_pinged' && n.estimateId === e3.id));

  const audit3 = await get(estimator.cookie, `/api/estimates/${e3.id}/audit`);
  const actions3 = audit3.data.events.map((e) => e.action);
  check('17. audit trail records every lifecycle mutation', audit3.data.success
    && actions3.includes('ESTIMATE_SUBMITTED')
    && actions3.includes('REVIEWER_ASSIGNED')
    && actions3.includes('REVIEWER_PINGED'));
  check('17b. audit events carry authenticated actor info, not client-claimed identity',
    audit3.data.events.every((e) => !!e.actorUserId && !!e.actorRole));

  // ══════════════════════════════════════════════════════════════════════
  // SECURITY (tests 18-22)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nSecurity');
  const e5 = await createEstimate(estimator.cookie, 'Flow5 Security', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${e5.id}/submit`);
  await post(admin.cookie, `/api/estimates/${e5.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });

  const estimatorApprove = await post(estimator.cookie, `/api/estimates/${e5.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 1,
  });
  check('18a. estimator cannot approve (403)', estimatorApprove.status === 403);
  const estimatorReject = await post(estimator.cookie, `/api/estimates/${e5.id}/review/decision`, {
    decision: 'rejected', comments: 'x', reviewedVersion: 1,
  });
  check('18b. estimator cannot reject (403)', estimatorReject.status === 403);
  const estimatorChanges = await post(estimator.cookie, `/api/estimates/${e5.id}/review/decision`, {
    decision: 'changes_requested', comments: 'x', reviewedVersion: 1,
  });
  check('18c. estimator cannot request changes (403)', estimatorChanges.status === 403);
  const estimatorAssign = await post(estimator.cookie, `/api/estimates/${e5.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  check('18d. estimator cannot assign a reviewer (403)', estimatorAssign.status === 403);

  const otherEstimator = await login('sme@calibre.demo', 'Calibre123!'); // different owner entirely
  const crossOwnerRead = await get(otherEstimator.cookie, `/api/estimates/${e5.id}`);
  check('18e. estimator cannot access/review another user\'s estimate (403)', crossOwnerRead.status === 403);

  const unauthorizedStart = await post(secondReviewer.cookie, `/api/estimates/${e5.id}/review/start`);
  check('19. a reviewer who is NOT the assigned reviewer is denied (403)', unauthorizedStart.status === 403);

  const crossUnitStart = await post(crossUnitReviewer.cookie, `/api/estimates/${e5.id}/review/start`);
  check('20a. cross-unit reviewer denied even without ever being assigned (defense in depth)', crossUnitStart.status === 403);
  const crossUnitAssign = await post(admin.cookie, `/api/estimates/${e5.id}/assign-reviewer`, { reviewerUserId: crossUnitReviewer.user.id });
  check('20b. cross-unit assignment itself is rejected at assignment time', crossUnitAssign.status === 403 || crossUnitAssign.status === 400);

  const start5 = await post(superUser.cookie, `/api/estimates/${e5.id}/review/start`);
  check('(setup) legitimate reviewer starts review', start5.data.success);
  const staleApprove = await post(superUser.cookie, `/api/estimates/${e5.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 999,
  });
  check('21. stale/mismatched-version approval fails (409)', staleApprove.status === 409);

  // 22. arbitrary status transitions fail
  const e6 = await createEstimate(estimator.cookie, 'Flow6 Transitions', 'Oracle ERP');
  await post(estimator.cookie, `/api/estimates/${e6.id}/submit`);
  await post(admin.cookie, `/api/estimates/${e6.id}/assign-reviewer`, { reviewerUserId: superUser.user.id });
  const skipStart = await post(superUser.cookie, `/api/estimates/${e6.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 1,
  });
  check('22a. reviewer cannot decide before starting review (SUBMITTED->APPROVED skip, 422)', skipStart.status === 422);

  const approvedAlreadyResubmit = await post(estimator.cookie, `/api/estimates/${e1.id}/resubmit`, {
    changes: {}, changeReason: 'trying to resubmit an approved estimate',
  });
  check('22b. estimator cannot resubmit an APPROVED estimate (422)', approvedAlreadyResubmit.status === 422);
  const approvedAlreadySubmit = await post(estimator.cookie, `/api/estimates/${e1.id}/submit`);
  check('22c. estimator cannot re-submit an APPROVED estimate (422)', approvedAlreadySubmit.status === 422);

  const e7 = await createEstimate(estimator.cookie, 'Flow7 Draft Transitions', 'Oracle ERP');
  const draftToApprovedViaStatusRoute = await patch(estimator.cookie, `/api/estimates/${e7.id}/status`, { status: 'approved' });
  check('22d. estimator cannot use the admin status route to jump DRAFT->APPROVED (403, lacks ESTIMATE_APPROVE)',
    draftToApprovedViaStatusRoute.status === 403);
  const draftDecision = await post(superUser.cookie, `/api/estimates/${e7.id}/review/decision`, {
    decision: 'approved', reviewedVersion: 1,
  });
  check('22e. reviewer cannot approve a DRAFT estimate (no assignment exists yet, 404)', draftDecision.status === 404);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
