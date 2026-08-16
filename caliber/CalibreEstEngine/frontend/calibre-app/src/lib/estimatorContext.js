// Serializes the live estimator state into a compact snapshot for EVA.
//
// Every number here is READ from what the estimator already computed —
// computeBottomUp/computeCoverageRatios (Layer 1), the /score response
// (Layer 2), and the Phase 2 intelligence functions. Nothing is
// recalculated with its own formula, so the estimator remains the single
// source of truth and EVA's Python side never does estimator math.
//
// Deliberately compact: the gateway's express.json() uses the default
// 100kb body cap, and dumping all 67 components into an LLM prompt would
// be wasteful and unfocused. Lists are capped; EVA gets summaries.

import {
  computeEstimateHealth,
  computeCostDrivers,
  computeRiskDrivers,
  computeBenchmarkSummary,
  computeCompletenessScore,
  computeAnomalies,
} from './estimatorIntelligence';

const TOP_N = 5;

const r1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r0 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
const r2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export function buildEstimatorContext({
  estimateId, result, sectionA, overallComplexity, industry, overrides, componentRows, selectedCount,
}) {
  if (!result) return null;

  const {
    bottomUp, ml, similarProjects, coverage,
  } = result;

  // Reuse of the exact functions the Output page renders from — so EVA can
  // never disagree with what the user is looking at on screen.
  const health = computeEstimateHealth({
    bottomUp, ml, similarProjects, coverage, sectionA, overallComplexity,
  });
  const costDrivers = computeCostDrivers({ bottomUp });
  const riskDrivers = computeRiskDrivers({
    ml, coverage, sectionA, overallComplexity, industry,
  });
  const benchmark = computeBenchmarkSummary({ ml, similarProjects });
  const completeness = computeCompletenessScore({
    sectionA, componentRows, similarProjects, selectedCount,
  });
  const anomalies = computeAnomalies({
    ml, similarProjects, coverage, componentRows,
  });

  return {
    estimateId,
    timestamp: new Date().toISOString(),

    // TRANSPORT ONLY — never rendered into an LLM prompt. This is the raw
    // input state the scenario runner needs to re-run computeBottomUp with a
    // modification ("what if integration effort went up 10%?"). It carries
    // volumes/complexities/counts only — no rate-card figures, since rates
    // are applied during computeBottomUp, not stored here. eva_service's
    // selectors deliberately never read this key.
    rawInputs: overrides ? { sectionA, overrides, overallComplexity, industry } : null,

    inputs: {
      industry,
      complexity: overallComplexity,
      durationMonths: r0(sectionA.duration_months),
      contingencyPct: r0(sectionA.contingency_pct),
      onshorePct: r0(sectionA.onshore_pct),
      workingDaysPerMonth: r0(sectionA.working_days_month),
      modules: r0(sectionA.n_modules),
      entities: r0(sectionA.n_entities),
      integrationsSimple: r0(sectionA.integ_simple),
      integrationsComplex: r0(sectionA.integ_complex),
      dataMigrationObjects: r0(sectionA.n_dm_objects),
      reports: r0(sectionA.n_reports),
      cemli: r0(sectionA.n_cemli),
      selectedComponentCount: selectedCount,
      totalComponentCount: componentRows.length,
    },

    bottomUp: {
      baseEffortDays: r0(bottomUp.totalBase),
      contingencyDays: r0(bottomUp.contingencyDays),
      totalEffortDays: r0(bottomUp.totalWithContingency),
      totalCost: r0(bottomUp.totalCost),
      totalFte: r1(bottomUp.totalAvgFte),
      // blendedRate is rate-card data — eva_service strips it for roles that
      // aren't permitted to see rate cards (see sanitize_estimator_context).
      topRoles: costDrivers.byRole.slice(0, TOP_N).map((x) => ({
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

    ml: ml ? {
      deviationPct: r1(ml.predictedDeviationPct),
      p25: r1(ml.rangeLowPct),
      p75: r1(ml.rangeHighPct),
      overrunProbability: r2(ml.overrunProbability),
      riskBand: ml.riskBand,
      historicalOverrunRate: r2(ml.historicalOverrunRate),
      historicalNProjects: ml.historicalNProjects,
      modelUsed: ml.modelUsed,
    } : null,

    intelligence: {
      health: {
        status: health.status,
        confidence: health.confidence,
        mlRiskBand: health.mlRiskBand,
        concerns: health.concerns,
        recommendation: health.recommendation,
      },
      costDrivers: {
        byModule: costDrivers.byModule.slice(0, TOP_N).map((x) => ({
          module: x.module, effortDays: r0(x.effortDays), pctOfTotal: r1(x.pctOfTotal),
        })),
      },
      riskDrivers: riskDrivers.slice(0, TOP_N).map((d) => ({
        label: d.label, direction: d.direction, explanation: d.explanation, contribution: r2(d.contribution),
      })),
      benchmark: {
        comparableCount: benchmark.comparableCount,
        medianDeviationPct: r1(benchmark.medianDeviation),
        comparableOverrunRate: r2(benchmark.comparableOverrunRate),
        modelHistoricalOverrunRate: r2(benchmark.modelHistoricalOverrunRate),
        modelHistoricalNProjects: benchmark.modelHistoricalNProjects,
        deviationGapPts: r1(benchmark.deviationGapPts),
        // Lets EVA say "not enough history" instead of guessing (spec §18/§36).
        insufficientData: benchmark.comparableCount === 0,
        similarProjects: (similarProjects || []).slice(0, TOP_N).map((p) => ({
          projectId: p.project_id,
          industry: p.industry,
          complexity: p.complexity,
          deviationPct: r1(p.deviation_pct),
          overran: !!p.overrun_flag,
          health: p.health,
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
