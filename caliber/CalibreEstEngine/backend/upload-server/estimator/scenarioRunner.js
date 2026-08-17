/**
 * Server-side what-if scenario execution for EVA.
 *
 * This deliberately imports the SAME modules the browser estimator uses
 * (frontend/calibre-app/src/lib/*) rather than reimplementing any of the
 * math in Node or Python. There is exactly one computeBottomUp, one
 * computeCoverageRatios, and one set of intelligence functions in the
 * codebase; this file only orchestrates them and validates the requested
 * change. If the estimator formulas change, this path changes with them
 * automatically.
 *
 * The result is intentionally shaped like the frontend's estimator-context
 * snapshot (see frontend/src/lib/estimatorContext.js) so EVA's existing
 * read-only selectors can render a scenario with no second code path.
 */
import {
  computeBottomUp,
  computeCoverageRatios,
  scaleModuleVolumes,
  scoreEstimate,
} from '../../../frontend/calibre-app/src/lib/estimatorEngine.js';
import {
  computeEstimateHealth,
  computeCostDrivers,
  computeRiskDrivers,
  computeBenchmarkSummary,
  computeCompletenessScore,
  computeAnomalies,
} from '../../../frontend/calibre-app/src/lib/estimatorIntelligence.js';
import {
  COMPONENTS,
  SECTION_A_PARAMS,
} from '../../../frontend/calibre-app/src/constants/estimator-template.js';
import { RATE_CARD } from './rateCard.js';

// estimator_agents is internal-only and now requires this shared secret —
// same env var, same dev default, as upload-server's own INTERNAL_API_KEY
// (index.js) and estimator_agents' own fallback (src/api.py).
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';

const COMPLEXITY_CODES = ['L', 'M', 'H', 'VH'];
const MODULES = [...new Set(COMPONENTS.map((c) => c.module))];
// A multiplier outside this band isn't a "what-if", it's a different project —
// and the ML model was never trained on inputs that far from the template.
const MULTIPLIER_RANGE = [0.5, 2.0];

export class ScenarioValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScenarioValidationError';
  }
}

const NUMERIC_CHANGES = {
  durationMonths: 'duration_months',
  contingencyPct: 'contingency_pct',
  onshorePct: 'onshore_pct',
};
const DELTA_CHANGES = {
  durationMonthsDelta: 'duration_months',
  contingencyPctDelta: 'contingency_pct',
  onshorePctDelta: 'onshore_pct',
};

const ALLOWED_KEYS = new Set([
  ...Object.keys(NUMERIC_CHANGES),
  ...Object.keys(DELTA_CHANGES),
  'complexity',
  'moduleEffortMultiplier',
]);

function assertInRange(sectionAKey, value, label) {
  const spec = SECTION_A_PARAMS[sectionAKey];
  if (!Number.isFinite(value)) {
    throw new ScenarioValidationError(`${label} must be a number.`);
  }
  if (value < spec.min || value > spec.max) {
    throw new ScenarioValidationError(
      `${label} of ${value} is outside the supported estimator range (${spec.min}–${spec.max} ${spec.unit}).`,
    );
  }
}

/**
 * Applies a validated change set to a copy of the base inputs.
 * Never mutates its arguments — scenario execution must not be able to
 * disturb the estimate the user is actually working on.
 */
export function applyChanges(baseInputs, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new ScenarioValidationError('changes must be an object.');
  }

  const unknown = Object.keys(changes).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) {
    throw new ScenarioValidationError(
      `Unsupported change(s): ${unknown.join(', ')}. Supported: ${[...ALLOWED_KEYS].join(', ')}.`,
    );
  }

  const sectionA = { ...baseInputs.sectionA };
  let overrides = Object.fromEntries(
    Object.entries(baseInputs.overrides).map(([name, row]) => [name, { ...row }]),
  );
  let overallComplexity = baseInputs.overallComplexity;

  for (const [key, sectionAKey] of Object.entries(NUMERIC_CHANGES)) {
    if (changes[key] === undefined) continue;
    const value = Number(changes[key]);
    assertInRange(sectionAKey, value, key);
    sectionA[sectionAKey] = value;
  }

  for (const [key, sectionAKey] of Object.entries(DELTA_CHANGES)) {
    if (changes[key] === undefined) continue;
    const delta = Number(changes[key]);
    if (!Number.isFinite(delta)) {
      throw new ScenarioValidationError(`${key} must be a number.`);
    }
    const value = sectionA[sectionAKey] + delta;
    assertInRange(sectionAKey, value, key);
    sectionA[sectionAKey] = value;
  }

  if (changes.complexity !== undefined) {
    if (!COMPLEXITY_CODES.includes(changes.complexity)) {
      throw new ScenarioValidationError(
        `complexity must be one of ${COMPLEXITY_CODES.join(', ')}.`,
      );
    }
    overallComplexity = changes.complexity;
  }

  if (changes.moduleEffortMultiplier !== undefined) {
    const map = changes.moduleEffortMultiplier;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw new ScenarioValidationError('moduleEffortMultiplier must be an object of {module: factor}.');
    }
    for (const [module, rawFactor] of Object.entries(map)) {
      if (!MODULES.includes(module)) {
        throw new ScenarioValidationError(
          `Unknown module "${module}". Known modules: ${MODULES.join(', ')}.`,
        );
      }
      const factor = Number(rawFactor);
      if (!Number.isFinite(factor) || factor < MULTIPLIER_RANGE[0] || factor > MULTIPLIER_RANGE[1]) {
        throw new ScenarioValidationError(
          `Multiplier ${rawFactor} for "${module}" is outside the supported range (${MULTIPLIER_RANGE[0]}–${MULTIPLIER_RANGE[1]}x).`,
        );
      }
      overrides = scaleModuleVolumes(overrides, module, factor);
    }
  }

  return { sectionA, overrides, overallComplexity, industry: baseInputs.industry };
}

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r0 = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/** Same shape as the frontend's estimator-context snapshot, so EVA's
 *  existing selectors can format a scenario with no extra code path. */
function toSnapshot(inputs, scored, componentRows, selectedCount) {
  const { bottomUp, ml, similarProjects, coverage } = scored;
  const { sectionA, overallComplexity, industry } = inputs;

  const health = computeEstimateHealth({
    bottomUp, ml, similarProjects, coverage, sectionA, overallComplexity,
  });
  const costDrivers = computeCostDrivers({ bottomUp });
  const riskDrivers = computeRiskDrivers({ ml, coverage, sectionA, overallComplexity, industry });
  const benchmark = computeBenchmarkSummary({ ml, similarProjects });
  const completeness = computeCompletenessScore({
    sectionA, componentRows, similarProjects, selectedCount,
  });
  const anomalies = computeAnomalies({ ml, similarProjects, coverage, componentRows });

  return {
    inputs: {
      industry,
      complexity: overallComplexity,
      durationMonths: r0(sectionA.duration_months),
      contingencyPct: r0(sectionA.contingency_pct),
      onshorePct: r0(sectionA.onshore_pct),
      selectedComponentCount: selectedCount,
      totalComponentCount: componentRows.length,
    },
    bottomUp: {
      baseEffortDays: r0(bottomUp.totalBase),
      contingencyDays: r0(bottomUp.contingencyDays),
      totalEffortDays: r0(bottomUp.totalWithContingency),
      totalCost: r0(bottomUp.totalCost),
      totalFte: r1(bottomUp.totalAvgFte),
      topRoles: costDrivers.byRole.slice(0, 5).map((x) => ({
        role: x.role,
        effortDays: r0(x.effortDays),
        cost: r0(x.cost),
        pctOfTotalCost: r1(x.pctOfTotal),
        blendedRate: r0(bottomUp.costByRole[x.role]?.blendedRate),
      })),
    },
    coverage: {
      integrationCoverageRatio: r2(coverage.integCoverageRatio),
      migrationCoverageRatio: r2(coverage.dmCoverageRatio),
    },
    ml: {
      deviationPct: r1(ml.predictedDeviationPct),
      p25: r1(ml.rangeLowPct),
      p75: r1(ml.rangeHighPct),
      overrunProbability: r2(ml.overrunProbability),
      riskBand: ml.riskBand,
      historicalOverrunRate: r2(ml.historicalOverrunRate),
      historicalNProjects: ml.historicalNProjects,
      modelUsed: ml.modelUsed,
    },
    intelligence: {
      health: {
        status: health.status,
        confidence: health.confidence,
        mlRiskBand: health.mlRiskBand,
        concerns: health.concerns,
        recommendation: health.recommendation,
      },
      costDrivers: {
        byModule: costDrivers.byModule.slice(0, 5).map((x) => ({
          module: x.module, effortDays: r0(x.effortDays), pctOfTotal: r1(x.pctOfTotal),
        })),
      },
      riskDrivers: riskDrivers.slice(0, 5).map((d) => ({
        label: d.label, direction: d.direction, explanation: d.explanation, contribution: r2(d.contribution),
      })),
      benchmark: {
        comparableCount: benchmark.comparableCount,
        medianDeviationPct: r1(benchmark.medianDeviation),
        comparableOverrunRate: r2(benchmark.comparableOverrunRate),
        modelHistoricalOverrunRate: r2(benchmark.modelHistoricalOverrunRate),
        modelHistoricalNProjects: benchmark.modelHistoricalNProjects,
        deviationGapPts: r1(benchmark.deviationGapPts),
        insufficientData: benchmark.comparableCount === 0,
        similarProjects: (similarProjects || []).slice(0, 5).map((p) => ({
          projectId: p.project_id, industry: p.industry, complexity: p.complexity,
          deviationPct: r1(p.deviation_pct), overran: !!p.overrun_flag, health: p.health,
        })),
      },
      completeness: {
        score: completeness.score,
        failedChecks: completeness.checks.filter((c) => !c.passed).map((c) => c.label),
      },
      anomalies: {
        status: anomalies.status,
        items: anomalies.items.map((i) => `${i.severity}: ${i.text}`),
        dataCaveat: anomalies.dataCaveat,
      },
    },
  };
}

function rowsFor(overrides) {
  return COMPONENTS.map((c) => ({ ...c, ...overrides[c.component] }));
}

/**
 * Runs `changes` against `baseInputs` and returns both sides plus the delta.
 * baseInputs is never mutated.
 *
 * @param {{sectionA, overrides, overallComplexity, industry}} baseInputs
 * @param {object} changes  validated against the closed vocabulary above
 * @param {string} scoreUrl estimator_agents /score endpoint
 */
export async function runScenario({ baseInputs, changes, scoreUrl }) {
  const scenarioInputs = applyChanges(baseInputs, changes);

  const score = (inputs) => scoreEstimate({
    overrides: inputs.overrides,
    sectionA: inputs.sectionA,
    industry: inputs.industry,
    overallComplexity: inputs.overallComplexity,
    rateCard: RATE_CARD, // server-side call — cost is authoritative here
    scoreUrl,
    credentials: 'omit', // server-to-server; there is no cookie to send
    internalKey: INTERNAL_API_KEY,
  });

  const [currentScored, scenarioScored] = await Promise.all([
    score(baseInputs),
    score(scenarioInputs),
  ]);

  const currentRows = rowsFor(baseInputs.overrides);
  const scenarioRows = rowsFor(scenarioInputs.overrides);
  const currentSelected = currentRows.filter((r) => r.included).length;
  const scenarioSelected = scenarioRows.filter((r) => r.included).length;

  const current = toSnapshot(baseInputs, currentScored, currentRows, currentSelected);
  const scenario = toSnapshot(scenarioInputs, scenarioScored, scenarioRows, scenarioSelected);

  return {
    changesApplied: changes,
    current,
    scenario,
    delta: {
      effortDays: scenario.bottomUp.totalEffortDays - current.bottomUp.totalEffortDays,
      cost: scenario.bottomUp.totalCost - current.bottomUp.totalCost,
      fte: r1(scenario.bottomUp.totalFte - current.bottomUp.totalFte),
      deviationPct: r1(scenario.ml.deviationPct - current.ml.deviationPct),
      overrunProbability: r2(scenario.ml.overrunProbability - current.ml.overrunProbability),
      riskBandChanged: scenario.ml.riskBand !== current.ml.riskBand,
    },
  };
}
