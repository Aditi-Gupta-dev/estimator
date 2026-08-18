/**
 * Project lifecycle (Phase 4) — mirrors estimateStatus.js's pattern exactly
 * (plain string enum + explicit transition table + canTransition()). Kept
 * as its own file/state graph rather than reusing EstimateStatus: a project
 * and its baseline estimate are lifecycle-independent by design (Part 3 —
 * the estimate stays immutable/APPROVED forever regardless of what happens
 * to the project built from it).
 */
export const ProjectStatus = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const ALL_PROJECT_STATUSES = Object.values(ProjectStatus);

// Exactly the 6 transitions required (Part 14) — nothing else. COMPLETED
// and CANCELLED are terminal; there is no "reopen" path this phase.
const ALLOWED_TRANSITIONS = {
  [ProjectStatus.PLANNED]: new Set([ProjectStatus.ACTIVE, ProjectStatus.CANCELLED]),
  [ProjectStatus.ACTIVE]: new Set([ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED]),
  [ProjectStatus.ON_HOLD]: new Set([ProjectStatus.ACTIVE]),
  [ProjectStatus.COMPLETED]: new Set([]),
  [ProjectStatus.CANCELLED]: new Set([]),
};

export function canTransition(current, target) {
  if (!ALL_PROJECT_STATUSES.includes(target)) return false;
  if (current === target) return true;
  return ALLOWED_TRANSITIONS[current]?.has(target) ?? false;
}
