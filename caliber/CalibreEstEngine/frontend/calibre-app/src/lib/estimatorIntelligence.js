// Phase 2 "Estimator Output Intelligence" — pure, deterministic functions
// that turn the existing Layer 1 (computeBottomUp) and Layer 2 (/score ML
// calibration) outputs into business-friendly summaries: Estimate Health,
// Cost/Risk Drivers, Historical Benchmark, Coverage Ratio explanation,
// Completeness Score, and Anomaly Detection.
//
// No LLM calls, no network calls, no fabricated data — every number here is
// derived from bottomUp/ml/similarProjects/coverage/sectionA, all of which
// are already computed elsewhere (useEstimator.js) or already returned by
// the /score endpoint. Kept framework-free so it's testable independent of
// React (see useEstimator.js's computeBottomUp/computeCoverageRatios for
// the same convention).

// Explicit .js extension — also imported directly by the Node gateway's
// scenario runner, which (unlike Vite) requires it.
import { COMPONENTS, SECTION_A_PARAMS } from '../constants/estimator-template.js';

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// This estimate's ML-predicted deviation vs. the median deviation actually
// observed on the 5 comparable historical projects returned by /score. A
// positive gap means the model expects THIS estimate to deviate more than
// similar past projects did. Used by both Estimate Health and Anomaly
// Detection as the "vs comparables" signal. Note: the comparator dataset
// only exposes deviation_pct, not effort-in-days, so this — not an "X days
// below historical median" figure — is the honest benchmark comparison
// available from the current /score contract.
function deviationGapPts(ml, similarProjects) {
  if (!similarProjects || similarProjects.length === 0) return null;
  const med = median(similarProjects.map((p) => p.deviation_pct));
  return ml.predictedDeviationPct - med;
}

// Modules present in virtually every real Oracle Fusion delivery programme
// regardless of scope — a complete absence of selected components from one
// of these is worth flagging (Completeness Score, Anomaly Detection).
const USUALLY_PRESENT_MODULES = ['Testing & QA', 'Programme Mgmt'];

function modulesWithNoSelection(componentRows) {
  const includedByModule = {};
  componentRows.forEach((c) => {
    if (!(c.module in includedByModule)) includedByModule[c.module] = false;
    if (c.included) includedByModule[c.module] = true;
  });
  return USUALLY_PRESENT_MODULES.filter((m) => includedByModule[m] === false);
}

// ── Feature 1: Estimate Health ──────────────────────────────────────────
// Composite status derived from named, documented signals — never a raw AI
// number. The underlying ML risk band is always returned alongside the
// composite so the two are never conflated in the UI.
const RISK_BAND_POINTS = { GREEN: 0, AMBER: 1, RED: 2 };
const OVERRUN_PROB_THRESHOLD = 0.5;
const DEVIATION_GAP_THRESHOLD = 5; // percentage points
const COVERAGE_LOW_THRESHOLD = 0.85;
const CONFIDENCE_BASE = 95;
const CONFIDENCE_PER_POINT = 10;
const CONFIDENCE_FLOOR = 40;
const CONFIDENCE_CEILING = 95;

export function computeEstimateHealth({
  bottomUp, ml, similarProjects, coverage, sectionA, overallComplexity,
}) {
  const concerns = [];
  const areas = [];
  let points = RISK_BAND_POINTS[ml.riskBand] ?? 1;

  if (ml.overrunProbability >= OVERRUN_PROB_THRESHOLD) {
    points += 1;
    concerns.push(`Overrun probability exceeds 50% (${Math.round(ml.overrunProbability * 100)}%).`);
    areas.push('overrun probability');
  }

  const gap = deviationGapPts(ml, similarProjects);
  if (gap != null && gap >= DEVIATION_GAP_THRESHOLD) {
    points += 1;
    concerns.push(`Predicted deviation (+${ml.predictedDeviationPct.toFixed(1)}%) is ${gap.toFixed(1)} points higher than comparable historical projects.`);
    areas.push('scope/effort vs comparable projects');
  }

  if (coverage.integCoverageRatio <= COVERAGE_LOW_THRESHOLD) {
    points += 1;
    concerns.push(`Integration effort is below the volumetric benchmark implied by Section A (${coverage.integCoverageRatio.toFixed(2)}x).`);
    areas.push('Integration');
  }
  if (coverage.dmCoverageRatio <= COVERAGE_LOW_THRESHOLD) {
    points += 1;
    concerns.push(`Data Migration effort is below the volumetric benchmark implied by Section A (${coverage.dmCoverageRatio.toFixed(2)}x).`);
    areas.push('Data Migration');
  }

  const durParam = SECTION_A_PARAMS.duration_months;
  const durationQ1 = durParam.min + (durParam.max - durParam.min) * 0.25;
  const isAggressiveDuration = sectionA.duration_months <= durationQ1
    && (overallComplexity === 'H' || overallComplexity === 'VH');
  if (isAggressiveDuration) {
    points += 1;
    concerns.push(`Duration (${sectionA.duration_months} months) is short for a ${overallComplexity} complexity programme.`);
    areas.push('Duration');
  }

  let status = 'GREEN';
  if (points >= 3) status = 'RED';
  else if (points >= 1) status = 'AMBER';

  let confidence = CONFIDENCE_BASE - CONFIDENCE_PER_POINT * points;
  if (ml.historicalNProjects != null && ml.historicalNProjects < 20) confidence -= 10;
  if (!similarProjects || similarProjects.length < 5) confidence -= 5;
  confidence = Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEILING, confidence));

  const recommendation = areas.length > 0
    ? `Review ${areas.join(', ')} before submission.`
    : 'No major concerns — estimate is ready for review.';

  return {
    status, points, confidence, concerns, recommendation, mlRiskBand: ml.riskBand,
    // exposed so bottomUp isn't reported as an unused param if a caller
    // wants to add effort-scale context to the headline later
    totalWithContingency: bottomUp.totalWithContingency,
  };
}

// ── Feature 2a: Cost Drivers (Layer 1) ──────────────────────────────────
export function computeCostDrivers({ bottomUp }) {
  const byRole = Object.keys(bottomUp.costByRole)
    .map((role) => ({
      role,
      effortDays: bottomUp.costByRole[role].effortDays,
      cost: bottomUp.costByRole[role].cost,
      pctOfTotal: bottomUp.totalCost > 0 ? (bottomUp.costByRole[role].cost / bottomUp.totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  // componentEffort is pre-contingency adjusted effort; scale by the same
  // factor computeBottomUp uses for roleEffort so module totals reconcile
  // with the contingency-inclusive totals shown elsewhere on the page.
  const contingencyFactor = bottomUp.totalAdjusted > 0
    ? bottomUp.totalWithContingency / bottomUp.totalAdjusted
    : 1;
  const moduleEffort = {};
  COMPONENTS.forEach((c) => {
    const effort = bottomUp.componentEffort[c.component];
    if (effort == null) return; // not selected for this engagement
    moduleEffort[c.module] = (moduleEffort[c.module] || 0) + effort * contingencyFactor;
  });
  const byModule = Object.keys(moduleEffort)
    .map((module) => ({
      module,
      effortDays: moduleEffort[module],
      pctOfTotal: bottomUp.totalWithContingency > 0
        ? (moduleEffort[module] / bottomUp.totalWithContingency) * 100 : 0,
    }))
    .sort((a, b) => b.effortDays - a.effortDays);

  return { byRole, byModule };
}

// ── Feature 2b: Risk Drivers (Layer 2 / SHAP) ───────────────────────────
// Translates the model's raw feature names into a business label + a
// factual, value-grounded one-line explanation (Model Explainability, §18).
const DRIVER_LABELS = {
  integ_coverage_ratio: {
    label: 'Integration Coverage',
    explain: (ctx) => `Your integration coverage ratio is ${ctx.coverage.integCoverageRatio.toFixed(2)}x — ${ctx.coverage.integCoverageRatio < 1 ? 'below' : 'above'} the 1.0x baseline.`,
  },
  dm_coverage_ratio: {
    label: 'Data Migration Coverage',
    explain: (ctx) => `Your data migration coverage ratio is ${ctx.coverage.dmCoverageRatio.toFixed(2)}x — ${ctx.coverage.dmCoverageRatio < 1 ? 'below' : 'above'} the 1.0x baseline.`,
  },
  duration_months: {
    label: 'Project Duration',
    explain: (ctx) => `Duration is set to ${Math.round(ctx.sectionA.duration_months)} months.`,
  },
  team_size: {
    label: 'Team Size',
    explain: () => 'Larger teams are historically associated with higher coordination risk.',
  },
  n_modules: {
    label: 'Module Count',
    explain: (ctx) => `${Math.round(ctx.sectionA.n_modules)} Oracle modules in scope.`,
  },
  n_entities: {
    label: 'Legal Entity Count',
    explain: (ctx) => `${Math.round(ctx.sectionA.n_entities)} legal entities / countries in scope.`,
  },
  n_reports: {
    label: 'Custom Reports',
    explain: (ctx) => `${Math.round(ctx.sectionA.n_reports)} custom reports/analytics in scope.`,
  },
  n_cemli: {
    label: 'Custom Extensions (CEMLI)',
    explain: (ctx) => `${Math.round(ctx.sectionA.n_cemli)} custom extensions in scope.`,
  },
  n_dm_objects: {
    label: 'Data Migration Objects',
    explain: (ctx) => `${Math.round(ctx.sectionA.n_dm_objects)} data migration objects in scope.`,
  },
  integ_simple: {
    label: 'Simple Integrations',
    explain: (ctx) => `${Math.round(ctx.sectionA.integ_simple)} simple integrations in scope.`,
  },
  integ_complex: {
    label: 'Complex Integrations',
    explain: (ctx) => `${Math.round(ctx.sectionA.integ_complex)} complex integrations in scope.`,
  },
};

function humanizeFeature(name) {
  return name.replace(/_/g, ' ');
}

function labelForFeature(feature) {
  if (DRIVER_LABELS[feature]) return DRIVER_LABELS[feature].label;
  if (feature.startsWith('complexity_')) return `Complexity: ${feature.replace('complexity_', '')}`;
  if (feature.startsWith('industry_')) return `Industry: ${feature.replace('industry_', '')}`;
  return humanizeFeature(feature);
}

function explanationForFeature(feature, ctx) {
  if (DRIVER_LABELS[feature]) return DRIVER_LABELS[feature].explain(ctx);
  if (feature.startsWith('complexity_')) return `This estimate's overall complexity is ${ctx.overallComplexity}.`;
  if (feature.startsWith('industry_')) return `This estimate's industry is ${ctx.industry}.`;
  return "Derived from the ML model's trained feature set.";
}

export function computeRiskDrivers({
  ml, coverage, sectionA, overallComplexity, industry,
}) {
  const ctx = {
    coverage, sectionA, overallComplexity, industry,
  };
  return ml.topDrivers.map((d) => ({
    feature: d.feature,
    label: labelForFeature(d.feature),
    direction: d.contribution >= 0 ? 'Increases risk' : 'Decreases risk',
    contribution: d.contribution,
    explanation: explanationForFeature(d.feature, ctx),
  }));
}

// ── Feature 3: Historical Benchmark Intelligence ────────────────────────
export function computeBenchmarkSummary({ ml, similarProjects }) {
  const comparableCount = similarProjects.length;
  const medianDeviation = comparableCount > 0 ? median(similarProjects.map((p) => p.deviation_pct)) : null;
  const overrunCount = similarProjects.filter((p) => p.overrun_flag).length;

  return {
    comparableCount,
    medianDeviation,
    overrunCount,
    comparableOverrunRate: comparableCount > 0 ? overrunCount / comparableCount : null,
    modelHistoricalOverrunRate: ml.historicalOverrunRate,
    modelHistoricalNProjects: ml.historicalNProjects,
    predictedDeviationPct: ml.predictedDeviationPct,
    deviationGapPts: deviationGapPts(ml, similarProjects),
  };
}

// ── Feature 6: Estimate Completeness Score ──────────────────────────────
// Deterministic, no LLM. Every check is named and independently visible.
const COMPLETENESS_CHECKS = [
  {
    key: 'sectionAValid',
    label: 'Global parameters within valid range',
    check: ({ sectionA }) => Object.keys(SECTION_A_PARAMS).every((key) => {
      const p = SECTION_A_PARAMS[key];
      const v = sectionA[key];
      return v != null && v >= p.min && v <= p.max;
    }),
  },
  {
    key: 'componentsSelected',
    label: 'Required components reviewed and selected',
    check: ({ selectedCount }) => selectedCount > 0,
  },
  {
    key: 'contingencyDefined',
    label: 'Contingency defined',
    check: ({ sectionA }) => sectionA.contingency_pct > 0,
  },
  {
    key: 'benchmarksAvailable',
    label: 'Historical benchmarks available',
    check: ({ similarProjects }) => similarProjects && similarProjects.length > 0,
  },
  {
    key: 'usualModulesCovered',
    label: 'Usually-present modules covered (Testing & QA, Programme Mgmt)',
    check: ({ componentRows }) => modulesWithNoSelection(componentRows).length === 0,
  },
];

export function computeCompletenessScore({
  sectionA, componentRows, similarProjects, selectedCount,
}) {
  const ctx = {
    sectionA, componentRows, similarProjects, selectedCount,
  };
  const checks = COMPLETENESS_CHECKS.map((c) => ({
    key: c.key, label: c.label, passed: c.check(ctx),
  }));
  const passed = checks.filter((c) => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  return { score, checks };
}

// ── Feature 7: Estimation Anomaly Detection ─────────────────────────────
// Deterministic rules only — reuses the same signals as Estimate Health and
// Historical Benchmark. No unsupported claims; explicitly says when there
// isn't enough data rather than guessing (spec §10).
const DEVIATION_ANOMALY_THRESHOLD = 8; // percentage points — stricter than the Health warning threshold
const MIN_HISTORICAL_N = 10;

export function computeAnomalies({
  ml, similarProjects, coverage, componentRows,
}) {
  const items = [];

  if (coverage.integCoverageRatio <= COVERAGE_LOW_THRESHOLD) {
    items.push({
      severity: 'anomaly',
      text: `Integration effort is below the volumetric benchmark implied by Section A (${coverage.integCoverageRatio.toFixed(2)}x).`,
    });
  }
  if (coverage.dmCoverageRatio <= COVERAGE_LOW_THRESHOLD) {
    items.push({
      severity: 'anomaly',
      text: `Data Migration effort is below the volumetric benchmark implied by Section A (${coverage.dmCoverageRatio.toFixed(2)}x).`,
    });
  }

  modulesWithNoSelection(componentRows).forEach((m) => {
    items.push({
      severity: 'review',
      text: `No ${m} components selected — most Oracle Fusion delivery programmes include this workstream.`,
    });
  });

  const gap = deviationGapPts(ml, similarProjects);
  if (gap != null && gap >= DEVIATION_ANOMALY_THRESHOLD) {
    const med = median(similarProjects.map((p) => p.deviation_pct));
    items.push({
      severity: 'anomaly',
      text: `This estimate's ML-predicted deviation (+${ml.predictedDeviationPct.toFixed(1)}%) is notably higher than the median of comparable historical projects (+${med.toFixed(1)}%).`,
    });
  }

  const insufficientData = !similarProjects || similarProjects.length === 0
    || (ml.historicalNProjects != null && ml.historicalNProjects < MIN_HISTORICAL_N);
  const dataCaveat = insufficientData
    ? 'Insufficient historical data to assess this area with confidence.'
    : null;

  const status = items.some((i) => i.severity === 'anomaly')
    ? 'anomaly'
    : (items.length > 0 ? 'review' : 'clear');

  return { status, items, dataCaveat };
}
