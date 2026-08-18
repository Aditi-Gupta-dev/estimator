/**
 * Small enums for version-delta analysis (Phase 5) — mirrors
 * reviewTypes.js/projectTypes.js's pattern.
 */
export const DeltaStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const ALL_DELTA_STATUSES = Object.values(DeltaStatus);
