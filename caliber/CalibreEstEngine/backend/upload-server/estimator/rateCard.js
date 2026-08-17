/**
 * Blended day-rates per role — the one place this table exists.
 *
 * Deliberately NOT under frontend/calibre-app/src: nothing there imports
 * this file, so Vite has nothing to bundle. Every role, including
 * `estimator` and `senior_mgmt` (who are restricted from ever seeing raw
 * rate-card figures), used to receive this table for free in the JS bundle
 * even though the UI hid it — this file is what closes that gap. Cost
 * calculation now only happens where this import is reachable: the Node
 * gateway (authoritativeEstimate.js, scenarioRunner.js).
 */
export const RATE_CARD = {
  'Programme Director': { onshore: 2200, offshore: 900 },
  'Solution Architect': { onshore: 1800, offshore: 750 },
  'Functional Lead': { onshore: 1500, offshore: 600 },
  'Technical Lead': { onshore: 1600, offshore: 650 },
  'Functional Consultant': { onshore: 1050, offshore: 420 },
  'Technical Developer': { onshore: 950, offshore: 380 },
  'Data Migration Specialist': { onshore: 1100, offshore: 440 },
  'Change Management Lead': { onshore: 1300, offshore: 520 },
  'Testing Lead': { onshore: 1000, offshore: 400 },
  'Infrastructure Engineer': { onshore: 1100, offshore: 450 },
  'Project Manager': { onshore: 1400, offshore: 560 },
};
