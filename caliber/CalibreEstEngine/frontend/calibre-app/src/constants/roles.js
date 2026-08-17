// ─── Role Definitions ────────────────────────────────────────────────────────
// Roles are additive: Estimator is the universal baseline.
// Higher roles inherit Estimator capabilities plus their own.

export const ROLES = {
  admin: {
    id: 'admin',
    label: 'Admin / COE',
    initials: 'AC',
    color: '#00D4FF',
    borderColor: 'rgba(0, 212, 255, 0.5)',
    glowColor: 'rgba(0, 212, 255, 0.25)',
    colorVar: 'cyan',
    isRestricted: false,
    scope: 'global',
    evaGreeting: `Good to see you, COE Admin! I've spotted **3 model calibration reviews** pending and **2 estimates** awaiting sign-off. Want me to summarize the critical items first?`,
    icon: 'Crown',
    badgeLabel: null,
  },
  super: {
    id: 'super',
    label: 'Super User',
    initials: 'SU',
    color: '#A78BFA',
    borderColor: 'rgba(167, 139, 250, 0.5)',
    glowColor: 'rgba(167, 139, 250, 0.25)',
    colorVar: 'purple',
    isRestricted: false,
    scope: 'unit',
    evaGreeting: `Good day, Super User! You have **4 estimates** queued for your review and **1 template draft** awaiting COE sign-off. Shall I prioritize them by urgency or submission date?`,
    icon: 'Shield',
    badgeLabel: 'Approval Queue',
  },
  sme: {
    id: 'sme',
    label: 'Unit SME',
    initials: 'US',
    color: '#FFB347',
    borderColor: 'rgba(255, 179, 71, 0.5)',
    glowColor: 'rgba(255, 179, 71, 0.25)',
    colorVar: 'amber',
    isRestricted: false,
    scope: 'unit',
    evaGreeting: `Hi, Unit SME! **2 templates** and **3 estimates** are flagged for your expert review. Shall I pull up the pending items so you can annotate and provide feedback?`,
    icon: 'Tool',
    badgeLabel: null,
  },
  estimator: {
    id: 'estimator',
    label: 'Estimator',
    initials: 'ES',
    color: '#34D399',
    borderColor: 'rgba(52, 211, 153, 0.5)',
    glowColor: 'rgba(52, 211, 153, 0.25)',
    colorVar: 'green',
    isRestricted: true,
    scope: 'self',
    evaGreeting: `Hello, Estimator! I can see an active estimate for **Oracle Fusion ERP** in progress. Want to continue from where you left off, or shall we start a new one?`,
    icon: 'Calculator',
    badgeLabel: null,
  },
};

// ─── Departments ──────────────────────────────────────────────────────────────
export const DEPARTMENTS = [
  { id: 'sales', label: 'Sales' },
  { id: 'delivery', label: 'Delivery' },
];

// ─── Workflow Card Access ──────────────────────────────────────────────────────
// Defines which roles can access each card and in what mode.
// mode: 'full' | 'unit' | 'review' | 'comment' | 'self' | 'readonly' | 'locked'
export const CARD_ACCESS = {
  1: { // What / How to Estimate
    admin:        'full',
    super:        'full',
    sme:          'full',
    estimator:    'full',
  },
  2: { // Estimate / Re-estimate / View
    admin:        'full',
    super:        'unit',
    sme:          'review',
    estimator:    'self',
  },
  3: { // Compare Against Benchmarks
    admin:        'full',
    super:        'unit',
    sme:          'unit',
    estimator:    'self',
  },
  4: { // Calibrate Your Estimation Engine
    admin:        'full',
    super:        'readonly',
    sme:          'locked',
    estimator:    'locked',
  },
  5: { // ROI & AI Cost Computation
    admin:        'full',
    super:        'full',
    sme:          'full',
    estimator:    'full',
  },
};

// ─── Permission Helpers ───────────────────────────────────────────────────────

// Permission checks now live in constants/capabilities.js — one map shared by
// the React app, the Node gateway and (mirrored, with a parity test) EVA.
// roles.js keeps identity and theming only.

/** Check if a role can access a workflow card (not locked) */
export const hasCardAccess = (roleId, cardId) => {
  const mode = CARD_ACCESS[cardId]?.[roleId];
  return mode !== 'locked' && mode !== undefined;
};

/** Get the access mode for a role on a specific card */
export const getCardMode = (roleId, cardId) => {
  return CARD_ACCESS[cardId]?.[roleId] ?? 'locked';
};

/** Check if a role is unit-scoped (cannot see global data) */
export const isUnitScoped = (roleId) => {
  return ROLES[roleId]?.scope === 'unit';
};

/** Check if a role is self-scoped (can only see own data) */
export const isSelfScoped = (roleId) => {
  return ROLES[roleId]?.scope === 'self';
};

// ─── Time-aware greeting ──────────────────────────────────────────────────────
export const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};
