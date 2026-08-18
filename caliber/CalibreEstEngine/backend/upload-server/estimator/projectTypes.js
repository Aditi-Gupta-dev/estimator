/**
 * Small enums for project tracking (Phase 4) — mirrors reviewTypes.js's
 * pattern. Deliberately NOT a closed/strict enum enforced server-side for
 * update_type: Part 7 requires the data model to stay domain-neutral (no
 * ESU-only fields), so this is a suggested vocabulary for the frontend, not
 * a validation whitelist — any non-empty string is accepted.
 */
export const ProjectUpdateType = {
  PROGRESS: 'progress',
  MILESTONE: 'milestone',
  RISK: 'risk',
  STATUS_CHANGE: 'status_change',
  NOTE: 'note',
};

export const ALL_PROJECT_UPDATE_TYPES = Object.values(ProjectUpdateType);
