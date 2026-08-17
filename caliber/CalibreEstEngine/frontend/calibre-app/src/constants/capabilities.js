// ─── Capability model — the single source of truth for "who may do what" ────
//
// This file replaces three parallel, mutually-contradicting role models that
// existed before: roles.js's PERMISSIONS matrix (46 keys, entirely dead code),
// roles.js's CARD_ACCESS, and workflows.js's allowedRoles/requiresAdmin. Their
// disagreement was not academic — PERMISSIONS granted 'eva.ratecards' to all
// roles while the backend correctly denied rate cards to estimator (and, at
// the time, the now-removed senior_mgmt role).
//
// RBAC model: 4 roles — admin, super, sme, estimator. `super` is the primary
// Reviewer authority (holds ESTIMATE_APPROVE); there is no separate reviewer
// role. A fifth role, senior_mgmt, existed historically and was removed —
// unknown roles fail closed (roleCan returns false), never granted access.
//
// IMPORTANT: this module is imported by BOTH the React app and the Node
// gateway (backend/upload-server), the same way scenarioRunner.js imports the
// estimator engine — so the browser and the server cannot drift apart. It is
// mirrored for Python in eva_service/src/agents/capabilities.py, and a pytest
// asserts the two stay identical.
//
// The frontend uses this for UX (what to show). The SERVER is always the
// authority — every sensitive route re-checks with requireCapability(), so a
// tampered browser gains nothing.

export const CAPABILITIES = {
  // Estimation
  ESTIMATE_RUN: 'estimate.run',                    // execute Layer 1 + /score
  ESTIMATE_VIEW_DETAIL: 'estimate.view.detail',    // 67-component workspace
  SCENARIO_RUN: 'scenario.run',                    // what-if execution
  ESTIMATE_SAVE: 'estimate.save',                  // create/update/save persisted estimates (own)
  ESTIMATE_APPROVE: 'estimate.approve',            // review decisions (approve/reject/request changes)
  REVIEWER_ASSIGN: 'reviewer.assign',              // assign a reviewer to a submitted estimate
  // Commercially sensitive
  RATE_CARD_VIEW: 'ratecard.view',                 // day rates / blended rates
  // Knowledge Hub
  KNOWLEDGE_VIEW: 'knowledge.view',
  KNOWLEDGE_UPLOAD: 'knowledge.upload',
  KNOWLEDGE_REVIEW: 'knowledge.review',            // edit/curate/see raw data docs
  // Analytics
  EXECUTIVE_ANALYTICS_VIEW: 'analytics.executive',
  PLATFORM_ANALYTICS_VIEW: 'analytics.platform',   // model + system health
  TECHNICAL_REVIEW: 'review.technical',            // SME validation view
  // Governance
  USER_MANAGE: 'users.manage',
  // Assistant
  EVA_CHAT: 'eva.chat',
};

const C = CAPABILITIES;

// Seeded to EXACTLY the behaviour the server already enforced before this
// refactor, so consolidation changes no access decision:
//   /api/score + /internal/estimator/scenario → admin, super, sme, estimator
//   rate cards (RATE_CARD_RESTRICTED_ROLES)   → denied to estimator
//   /api/auth/users*                          → admin only
export const ROLE_CAPABILITIES = {
  admin: [
    C.ESTIMATE_RUN, C.ESTIMATE_VIEW_DETAIL, C.SCENARIO_RUN,
    C.ESTIMATE_SAVE, C.ESTIMATE_APPROVE, C.REVIEWER_ASSIGN,
    C.RATE_CARD_VIEW,
    C.KNOWLEDGE_VIEW, C.KNOWLEDGE_UPLOAD, C.KNOWLEDGE_REVIEW,
    C.EXECUTIVE_ANALYTICS_VIEW, C.PLATFORM_ANALYTICS_VIEW, C.TECHNICAL_REVIEW,
    C.USER_MANAGE,
    C.EVA_CHAT,
  ],
  super: [
    C.ESTIMATE_RUN, C.ESTIMATE_VIEW_DETAIL, C.SCENARIO_RUN,
    C.ESTIMATE_SAVE, C.ESTIMATE_APPROVE,
    C.RATE_CARD_VIEW,
    C.KNOWLEDGE_VIEW, C.KNOWLEDGE_UPLOAD,
    C.EXECUTIVE_ANALYTICS_VIEW,
    C.EVA_CHAT,
  ],
  sme: [
    C.ESTIMATE_RUN, C.ESTIMATE_VIEW_DETAIL, C.SCENARIO_RUN,
    C.ESTIMATE_SAVE,
    C.RATE_CARD_VIEW,
    C.KNOWLEDGE_VIEW, C.KNOWLEDGE_UPLOAD, C.KNOWLEDGE_REVIEW,
    C.TECHNICAL_REVIEW,
    C.EVA_CHAT,
  ],
  estimator: [
    C.ESTIMATE_RUN, C.ESTIMATE_VIEW_DETAIL, C.SCENARIO_RUN,
    C.ESTIMATE_SAVE,
    C.KNOWLEDGE_VIEW, C.KNOWLEDGE_UPLOAD,
    C.EVA_CHAT,
  ],
};

/** Does this role hold this capability? Unknown role/capability → false. */
export function roleCan(roleId, capability) {
  return ROLE_CAPABILITIES[roleId]?.includes(capability) ?? false;
}

/** Every capability a role holds (used by the nav/dashboard config). */
export function capabilitiesFor(roleId) {
  return ROLE_CAPABILITIES[roleId] ?? [];
}

// Human-readable denial copy. A bare "Access Denied" is unhelpful; each of
// these names what the role CAN still do, so the UI and EVA can degrade
// gracefully instead of dead-ending.
export const CAPABILITY_DENIAL_MESSAGE = {
  [C.ESTIMATE_RUN]: 'Running estimates isn\'t available for your role. You can still review estimate outcomes, risk and historical benchmarks.',
  [C.ESTIMATE_VIEW_DETAIL]: 'The detailed estimator workspace isn\'t available for your role. The executive summary shows effort, cost, FTE and risk.',
  [C.SCENARIO_RUN]: 'Scenario execution isn\'t available for your role. You can still view estimate health, cost drivers and risk analysis.',
  [C.ESTIMATE_SAVE]: 'Creating or saving estimates isn\'t available for your role. You can still view and discuss existing estimates.',
  [C.ESTIMATE_APPROVE]: 'Approving or rejecting submitted estimates is restricted to Admin and Delivery Leadership roles.',
  [C.REVIEWER_ASSIGN]: 'Assigning a reviewer to an estimate is restricted to platform administrators.',
  [C.RATE_CARD_VIEW]: 'Rate-card figures are restricted for your role. I can still explain effort, FTE, risk and the cost drivers behind an estimate.',
  [C.USER_MANAGE]: 'User management is restricted to platform administrators.',
  [C.KNOWLEDGE_REVIEW]: 'Curating Knowledge Hub content is restricted to Admin and SME roles.',
  [C.PLATFORM_ANALYTICS_VIEW]: 'Platform and model analytics are restricted to platform administrators.',
  [C.TECHNICAL_REVIEW]: 'The technical review workspace is available to SME and Admin roles.',
};

export function denialMessage(capability) {
  return CAPABILITY_DENIAL_MESSAGE[capability]
    || 'That action isn\'t available for your role.';
}
