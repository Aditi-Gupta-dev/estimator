import { IconGitCompare } from '@tabler/icons-react';
import { useMemo } from 'react';
import { computeBottomUp, computeCoverageRatios } from '../../lib/estimatorEngine';

const fmt = (n, d = 0) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtCurrency = (n) => `$${fmt(n / 1000)}k`;

function calibratedEffort(bottomUp, ml) {
  if (!bottomUp || !ml) return null;
  return bottomUp.totalWithContingency * (1 + ml.predictedDeviationPct / 100);
}

function Row({ label, current, scenario, scenarioPending }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{current}</td>
      <td className={scenarioPending ? 'est-note' : undefined}>{scenario}</td>
    </tr>
  );
}

export function ScenarioComparisonCard({ baselineResult, scenario }) {
  // Layer 1 recomputes live, synchronously, from the scenario's current
  // inputs — no need to wait on /score for effort/cost/FTE to update.
  const scenarioBottomUp = useMemo(
    () => computeBottomUp(scenario.overrides, scenario.sectionA),
    [scenario.overrides, scenario.sectionA],
  );
  const scenarioCoverage = useMemo(
    () => computeCoverageRatios(scenarioBottomUp, scenario.sectionA),
    [scenarioBottomUp, scenario.sectionA],
  );

  const scenarioMl = scenario.status === 'ready' ? scenario.result.ml : null;
  // Cost has no local instant value — the browser has no rate card to
  // compute it with (see estimatorEngine.js) — so, like the ML numbers, it
  // only appears once the debounced server call resolves.
  const scenarioCost = scenario.status === 'ready' ? scenario.result.bottomUp.totalCost : null;
  const isPending = scenario.status === 'scoring' || scenario.status === 'idle';

  const currentCalibrated = calibratedEffort(baselineResult.bottomUp, baselineResult.ml);
  const scenarioCalibrated = calibratedEffort(scenarioBottomUp, scenarioMl);

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconGitCompare size={18} color="var(--gold)" />
        Current vs Scenario
        {scenario.status === 'scoring' && <span className="est-tag est-tag-ml">Scoring…</span>}
        {scenario.status === 'error' && <span className="est-tag" style={{ color: 'var(--danger)' }}>Scoring failed</span>}
      </h2>

      <table className="est-table est-table-compact">
        <thead>
          <tr><th>Metric</th><th>Current</th><th>{scenario.name}</th></tr>
        </thead>
        <tbody>
          <Row
            label="Effort (with contingency)"
            current={`${fmt(baselineResult.bottomUp.totalWithContingency)}d`}
            scenario={`${fmt(scenarioBottomUp.totalWithContingency)}d`}
          />
          <Row
            label="ML-Calibrated Effort"
            current={`${fmt(currentCalibrated)}d`}
            scenario={scenarioMl ? `${fmt(scenarioCalibrated)}d` : '—'}
            scenarioPending={isPending}
          />
          <Row
            label="Total Cost"
            current={fmtCurrency(baselineResult.bottomUp.totalCost)}
            scenario={scenarioCost != null ? fmtCurrency(scenarioCost) : '—'}
            scenarioPending={isPending}
          />
          <Row
            label="Total Avg FTE"
            current={baselineResult.bottomUp.totalAvgFte.toFixed(1)}
            scenario={scenarioBottomUp.totalAvgFte.toFixed(1)}
          />
          <Row
            label="Predicted Deviation"
            current={`${baselineResult.ml.predictedDeviationPct >= 0 ? '+' : ''}${baselineResult.ml.predictedDeviationPct.toFixed(1)}%`}
            scenario={scenarioMl ? `${scenarioMl.predictedDeviationPct >= 0 ? '+' : ''}${scenarioMl.predictedDeviationPct.toFixed(1)}%` : '—'}
            scenarioPending={isPending}
          />
          <Row
            label="Risk Band"
            current={<span className={`est-band-pill est-band-${baselineResult.ml.riskBand}`}>{baselineResult.ml.riskBand}</span>}
            scenario={scenarioMl ? <span className={`est-band-pill est-band-${scenarioMl.riskBand}`}>{scenarioMl.riskBand}</span> : '—'}
            scenarioPending={isPending}
          />
          <Row
            label="Overrun Probability"
            current={`${Math.round(baselineResult.ml.overrunProbability * 100)}%`}
            scenario={scenarioMl ? `${Math.round(scenarioMl.overrunProbability * 100)}%` : '—'}
            scenarioPending={isPending}
          />
          <Row
            label="Integration / DM Coverage"
            current={`${baselineResult.coverage.integCoverageRatio.toFixed(2)}x / ${baselineResult.coverage.dmCoverageRatio.toFixed(2)}x`}
            scenario={`${scenarioCoverage.integCoverageRatio.toFixed(2)}x / ${scenarioCoverage.dmCoverageRatio.toFixed(2)}x`}
          />
        </tbody>
      </table>

      {scenario.status === 'error' && (
        <div className="est-note" style={{ color: 'var(--danger)' }}>{scenario.error}</div>
      )}
    </div>
  );
}
