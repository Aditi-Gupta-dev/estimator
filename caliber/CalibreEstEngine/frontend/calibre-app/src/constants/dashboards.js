// ─── Role dashboard configuration ────────────────────────────────────────────
// One config per persona, consumed by a single set of dashboard components —
// so the five experiences differ in CONTENT, not in duplicated JSX.
//
// Honesty rule: nothing here declares a metric the application cannot actually
// measure. Calibre has no estimate persistence, so there is no such thing as
// "active estimates", "pending reviews" or a GREEN/AMBER/RED portfolio count —
// the previous hardcoded kpiData claimed all three. Anything that needs
// persistence is declared here as an explicit `unavailable` note instead, and
// the UI renders it as a stated limitation rather than a number.

import { CAPABILITIES as C } from './capabilities';

export const PERSISTENCE_NOTE =
  'Saved estimates aren\'t available yet — Calibre scores estimates live but does not persist them, so history and portfolio totals will appear once estimate persistence is added.';

export const DASHBOARDS = {
  admin: {
    title: 'Control Center',
    tagline: 'Govern Calibre — users, content, models and platform health.',
    // Real, server-sourced (GET /api/system/overview).
    sources: ['systemOverview'],
    quickActions: [
      { label: 'Manage Users', to: null, action: 'manage-users', capability: C.USER_MANAGE },
      { label: 'Estimates & Reviews', to: null, action: 'my-estimates', capability: C.ESTIMATE_SAVE },
      { label: 'Knowledge Hub', to: '/estimate/guide', capability: C.KNOWLEDGE_VIEW },
      { label: 'Open Estimator', to: '/estimate/create', capability: C.ESTIMATE_RUN },
    ],
    unavailable: [
      { label: 'Portfolio risk mix across all estimates', reason: PERSISTENCE_NOTE },
    ],
  },

  super: {
    title: 'Sales Estimation',
    tagline: 'Estimate opportunities quickly, with historical calibration.',
    sources: ['currentEstimate', 'knowledgeCounts'],
    quickActions: [
      { label: 'New Estimate', to: '/estimate/create', capability: C.ESTIMATE_RUN },
      { label: 'Estimates & Reviews', to: null, action: 'my-estimates', capability: C.ESTIMATE_SAVE },
      { label: 'ROI & Cost', to: '/estimate/roi-cost' },
      { label: 'Knowledge Hub', to: '/estimate/guide', capability: C.KNOWLEDGE_VIEW },
    ],
  },

  sme: {
    title: 'Technical Review',
    tagline: 'Validate whether an estimate makes technical sense.',
    sources: ['currentEstimate', 'technicalReview', 'knowledgeCounts'],
    quickActions: [
      { label: 'Open Estimator', to: '/estimate/create', capability: C.ESTIMATE_RUN },
      { label: 'My Estimates', to: null, action: 'my-estimates', capability: C.ESTIMATE_SAVE },
      { label: 'Knowledge Hub', to: '/estimate/guide', capability: C.KNOWLEDGE_VIEW },
    ],
    unavailable: [
      { label: 'Review queue and sign-off history', reason: 'SME does not hold review/approval authority in Calibre’s workflow — that remains with Reviewer (Super) and Admin.' },
    ],
  },

  estimator: {
    title: 'Estimation Workspace',
    tagline: 'Build accurate, defensible estimates.',
    sources: ['currentEstimate', 'knowledgeCounts'],
    quickActions: [
      { label: 'New Estimate', to: '/estimate/create', capability: C.ESTIMATE_RUN },
      { label: 'My Estimates', to: null, action: 'my-estimates', capability: C.ESTIMATE_SAVE },
      { label: 'ROI & Cost', to: '/estimate/roi-cost' },
      { label: 'Knowledge Hub', to: '/estimate/guide', capability: C.KNOWLEDGE_VIEW },
    ],
  },
};

export function dashboardFor(roleId) {
  return DASHBOARDS[roleId] ?? DASHBOARDS.estimator;
}

// ─── Role-aware navigation ───────────────────────────────────────────────────
// Filtered by capability at render time. Hiding a link is UX only — the server
// refuses the underlying request regardless.
export const NAV_ITEMS = [
  { label: 'Home', to: '/home' },
  { label: 'Estimator', to: '/estimate/create', capability: C.ESTIMATE_RUN },
  { label: 'Knowledge Hub', to: '/estimate/guide', capability: C.KNOWLEDGE_VIEW },
  { label: 'ROI & Cost', to: '/estimate/roi-cost' },
];

export function navItemsFor(can) {
  return NAV_ITEMS.filter((item) => !item.capability || can(item.capability));
}
