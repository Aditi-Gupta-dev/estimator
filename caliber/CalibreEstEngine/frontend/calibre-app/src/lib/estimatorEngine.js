// The single, authoritative "run an estimate" pipeline — Layer 1
// (computeBottomUp/computeCoverageRatios, client-side) followed by Layer 2
// (/score, the FastAPI estimator_agents ML calibration). useEstimator.js's
// main flow, the Scenario Simulator, and the Risk Reduction feature all
// call the exact same scoreEstimate() here rather than each re-implementing
// the request/response contract — "do not duplicate estimator logic."
//
// computeBottomUp/computeCoverageRatios were moved here verbatim from
// useEstimator.js (no logic change) so they have one home instead of being
// re-derived by every feature that needs a bottom-up number.

// NOTE: explicit .js extension — this module is imported both by Vite (which
// accepts either) and directly by the Node gateway's scenario runner (which
// requires the extension), so the estimator math has exactly one copy.
import { COMPONENTS, COMPLEXITY_MULT, RATE_CARD } from '../constants/estimator-template.js';

// Node upload-server proxy (see upload-server/index.js POST /api/score),
// which forwards to the FastAPI estimator_agents service. Hardcoded to match
// the existing convention in useUpload.js (localhost:3001) rather than
// introducing a new config pattern for just this one call.
const SCORE_URL = 'http://localhost:3001/api/score';

const COVERAGE_RATIO_CLIP = [0.75, 2.25];

function clip(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

// FastAPI/Pydantic validation errors return `detail` as an array of
// {loc, msg, type} objects (or occasionally a single object), not a plain
// string — stringify whatever shape it comes back as so the UI never shows
// a raw "[object Object]".
function extractErrorMessage(data, status) {
  const { detail } = data;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === 'string' ? d : d.msg || JSON.stringify(d))).join('; ');
  }
  if (detail && typeof detail === 'object') return detail.msg || JSON.stringify(detail);
  if (data.error) return data.error;
  return `Estimator service returned ${status}`;
}

// ── Layer 1: bottom-up effort/cost/role-FTE (client-side, mirrors the
// uploaded Oracle_Fusion_Estimator_v3_1.xlsx template's own formula) ────────
export function computeBottomUp(overrides, sectionA) {
  let totalBase = 0;
  let totalAdjusted = 0;
  const roleEffort = {};
  const componentEffort = {}; // per-component adjusted effort, for coverage-ratio calc below

  COMPONENTS.forEach((c) => {
    const { complexity, volume, included } = overrides[c.component];
    if (!included) return; // not part of this engagement — contributes nothing

    const base = volume * c.unit_effort;
    const adjusted = base * COMPLEXITY_MULT[complexity];
    totalBase += base;
    totalAdjusted += adjusted;
    roleEffort[c.primary_role] = (roleEffort[c.primary_role] || 0) + adjusted;
    componentEffort[c.component] = adjusted;
  });

  const contingencyDays = totalAdjusted * (sectionA.contingency_pct / 100);
  const totalWithContingency = totalAdjusted + contingencyDays;
  const contingencyFactor = totalAdjusted ? totalWithContingency / totalAdjusted : 1;

  const roleEffortWithContingency = {};
  Object.keys(roleEffort).forEach((r) => { roleEffortWithContingency[r] = roleEffort[r] * contingencyFactor; });

  const workingDaysTotal = sectionA.duration_months * sectionA.working_days_month;
  const roleAvgFte = {};
  Object.keys(roleEffortWithContingency).forEach((r) => { roleAvgFte[r] = roleEffortWithContingency[r] / workingDaysTotal; });
  const totalAvgFte = Object.values(roleAvgFte).reduce((a, b) => a + b, 0);

  const costByRole = {};
  let totalCost = 0;
  Object.keys(roleEffortWithContingency).forEach((role) => {
    const rate = RATE_CARD[role];
    const blended = (sectionA.onshore_pct / 100) * rate.onshore + (1 - sectionA.onshore_pct / 100) * rate.offshore;
    const cost = roleEffortWithContingency[role] * blended;
    costByRole[role] = { effortDays: roleEffortWithContingency[role], blendedRate: blended, cost };
    totalCost += cost;
  });

  return {
    totalBase, totalAdjusted, contingencyDays, totalWithContingency,
    roleEffort: roleEffortWithContingency, roleAvgFte, totalAvgFte,
    costByRole, totalCost, componentEffort,
  };
}

// ── integ/dm coverage ratio: how much more/less effort THIS estimate's own
// bottom-up volumetric assumptions produced vs the template's per-unit
// baseline rate at the given Section A counts. This is the estimation-time
// proxy for the "actual/benchmark effort" ratio the ML model was trained on
// (which is only knowable in hindsight, from real project actuals). ────────
export function computeCoverageRatios(bottomUp, sectionA) {
  const integSimpleRow = COMPONENTS.find((c) => c.component === 'REST/SOAP API Integrations (Simple)');
  const integComplexRow = COMPONENTS.find((c) => c.component === 'Real-Time / Event-Driven Integrations (Complex)');
  const dmObjectRow = COMPONENTS.find((c) => c.component === 'FBDI/HDL Template Build (per object)');

  const integActual = (bottomUp.componentEffort[integSimpleRow.component] || 0)
    + (bottomUp.componentEffort[integComplexRow.component] || 0);
  const integBenchmark = sectionA.integ_simple * integSimpleRow.unit_effort
    + sectionA.integ_complex * integComplexRow.unit_effort;

  const dmActual = bottomUp.componentEffort[dmObjectRow.component] || 0;
  const dmBenchmark = sectionA.n_dm_objects * dmObjectRow.unit_effort;

  return {
    integCoverageRatio: clip(integBenchmark > 0 ? integActual / integBenchmark : 1, COVERAGE_RATIO_CLIP),
    dmCoverageRatio: clip(dmBenchmark > 0 ? dmActual / dmBenchmark : 1, COVERAGE_RATIO_CLIP),
  };
}

// Returns a new overrides object with every *included* component in the
// given module's volume scaled by `factor`. Pure — does not mutate the
// input. Used by the Risk Reduction feature's "increase X effort by 10%"
// candidates; the Scenario Simulator itself edits volumes directly via the
// reused EstimatorComponentGrid, so it doesn't need this helper.
export function scaleModuleVolumes(overrides, module, factor) {
  const next = { ...overrides };
  COMPONENTS.forEach((c) => {
    if (c.module !== module) return;
    const row = overrides[c.component];
    if (!row || !row.included) return;
    next[c.component] = { ...row, volume: row.volume * factor };
  });
  return next;
}

// Builds the /score request payload from Layer 1 inputs — shared by
// scoreEstimate() below (round-tripped through the network) and by anything
// that wants to derive a cache key for an identical set of inputs without
// actually making the call.
export function buildScorePayload({
  overrides, sectionA, industry, overallComplexity,
}) {
  const bottomUp = computeBottomUp(overrides, sectionA);
  const { integCoverageRatio, dmCoverageRatio } = computeCoverageRatios(bottomUp, sectionA);
  const teamSize = Math.max(6, Math.round(bottomUp.totalAvgFte));

  const payload = {
    complexity: overallComplexity,
    industry,
    // Section A fields are meant to be whole counts, but the number
    // inputs don't hard-block fractional typing — round defensively
    // so a stray float never trips the service's integer validation.
    n_modules: Math.round(sectionA.n_modules),
    n_entities: Math.round(sectionA.n_entities),
    integ_simple: Math.round(sectionA.integ_simple),
    integ_complex: Math.round(sectionA.integ_complex),
    n_reports: Math.round(sectionA.n_reports),
    n_cemli: Math.round(sectionA.n_cemli),
    n_dm_objects: Math.round(sectionA.n_dm_objects),
    duration_months: Math.round(sectionA.duration_months),
    team_size: teamSize,
    integ_coverage_ratio: integCoverageRatio,
    dm_coverage_ratio: dmCoverageRatio,
  };

  return { bottomUp, coverage: { integCoverageRatio, dmCoverageRatio }, payload };
}

// The full Layer 1 → Layer 2 pipeline. Throws with a human-readable message
// (via extractErrorMessage) on any failure — callers decide how to surface
// that (set an error state, mark a scenario as failed, silently drop a
// risk-reduction candidate, etc).
// scoreUrl/credentials default to the browser path (through the authenticated
// gateway proxy, sending the session cookie). The Node scenario runner passes
// the estimator service's own URL with credentials omitted, since it is a
// server-to-server call with no cookie — same function, same contract.
export async function scoreEstimate({
  overrides, sectionA, industry, overallComplexity,
  scoreUrl = SCORE_URL, credentials = 'include',
}) {
  const { bottomUp, coverage, payload } = buildScorePayload({
    overrides, sectionA, industry, overallComplexity,
  });

  const response = await fetch(scoreUrl, {
    method: 'POST',
    credentials,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status));
  }

  return {
    bottomUp,
    ml: {
      predictedDeviationPct: data.ml_calibration.predicted_deviation_pct,
      rangeLowPct: data.ml_calibration.range_low_pct,
      rangeHighPct: data.ml_calibration.range_high_pct,
      overrunProbability: data.ml_calibration.overrun_probability,
      riskBand: data.ml_calibration.risk_band,
      historicalOverrunRate: data.ml_calibration.historical_overrun_rate,
      historicalNProjects: data.ml_calibration.historical_n_projects,
      topDrivers: data.ml_calibration.top_drivers,
      modelUsed: data.ml_calibration.model_used,
    },
    similarProjects: data.similar_projects || [],
    coverage,
  };
}
