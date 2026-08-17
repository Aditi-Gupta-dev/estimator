import { useState } from 'react';
import {
  IconUsers, IconListCheck, IconGauge, IconFlask,
} from '@tabler/icons-react';
import { GENERIC_RISK_REGISTER } from '../../constants/estimator-template';
import { EstimateHealthCard } from './EstimateHealthCard';
import { CostRiskDriversSection } from './CostRiskDriversSection';
import { HistoricalBenchmarkCard } from './HistoricalBenchmarkCard';
import { CoverageRatioCard } from './CoverageRatioCard';
import { CompletenessScoreCard } from './CompletenessScoreCard';
import { AnomalyReviewCard } from './AnomalyReviewCard';
import { RiskReductionCard } from './RiskReductionCard';
import { ScenarioSimulatorPanel } from './ScenarioSimulatorPanel';
import { SaveEstimateCard } from './SaveEstimateCard';

const fmt = (n, d = 0) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtCurrency = (n) => `$${fmt(n / 1000)}k`;

export function EstimatorResultsView({
  result, sectionA, overallComplexity, industry, overrides, componentRows, selectedCount, onOpenMyEstimates,
}) {
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  if (!result) return null;
  const {
    bottomUp, ml, similarProjects, coverage,
  } = result;

  // bottomUp.componentEffort only has an entry for components the user actually
  // selected (computeBottomUp skips unselected ones) — so its key count is the
  // real "how many of the 67-component catalog fed this estimate" figure.
  const selectedComponentCount = Object.keys(bottomUp.componentEffort).length;

  const calibratedEffort = bottomUp.totalWithContingency * (1 + ml.predictedDeviationPct / 100);
  const calibratedLow = bottomUp.totalWithContingency * (1 + ml.rangeLowPct / 100);
  const calibratedHigh = bottomUp.totalWithContingency * (1 + ml.rangeHighPct / 100);

  const roleRows = Object.keys(bottomUp.roleAvgFte).sort((a, b) => bottomUp.roleAvgFte[b] - bottomUp.roleAvgFte[a]);
  const maxFte = Math.max(...Object.values(bottomUp.roleAvgFte), 0.01);

  return (
    <>
      <SaveEstimateCard
        industry={industry}
        overallComplexity={overallComplexity}
        sectionA={sectionA}
        overrides={overrides}
        onOpenMyEstimates={onOpenMyEstimates}
      />

      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconGauge size={18} color="var(--gold)" />
          Total Effort & Cost
          <span className="est-tag est-tag-formula">{selectedComponentCount}-Component Formula</span>
          <span className="est-tag est-tag-ml">ML-Calibrated</span>
        </h2>
        <div className="est-kpi-grid">
          <div className="est-kpi">
            <div className="est-kpi-label">Base Effort</div>
            <div className="est-kpi-value">{fmt(bottomUp.totalBase)}d</div>
            <div className="est-kpi-sub">before complexity adj.</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">With Contingency</div>
            <div className="est-kpi-value">{fmt(bottomUp.totalWithContingency)}d</div>
            <div className="est-kpi-sub">{fmt(bottomUp.totalAdjusted)}d + {fmt(bottomUp.contingencyDays)}d</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">ML-Calibrated Effort</div>
            <div className="est-kpi-value">{fmt(calibratedEffort)}d</div>
            <div className="est-kpi-sub">{fmt(calibratedLow)}d – {fmt(calibratedHigh)}d</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Overrun Probability</div>
            <div className="est-kpi-value">{Math.round(ml.overrunProbability * 100)}%</div>
            <div className="est-kpi-sub">
              <span className={`est-band-pill est-band-${ml.riskBand}`}>{ml.riskBand}</span>
              {ml.historicalOverrunRate != null && (
                <> · {Math.round(ml.historicalOverrunRate * 100)}% historical ({ml.historicalNProjects} projects)</>
              )}
            </div>
          </div>
        </div>
        <div className="est-kpi-grid" style={{ marginTop: 14 }}>
          <div className="est-kpi">
            <div className="est-kpi-label">Total Engagement Cost</div>
            <div className="est-kpi-value">{fmtCurrency(bottomUp.totalCost)}</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Total Avg FTE</div>
            <div className="est-kpi-value">{bottomUp.totalAvgFte.toFixed(1)}</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Model Used</div>
            <div className="est-kpi-value" style={{ fontSize: 13 }}>{ml.modelUsed.uc1} / {ml.modelUsed.uc2}</div>
            <div className="est-kpi-sub">UC-1 deviation · UC-2 overrun</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Components in Scope</div>
            <div className="est-kpi-value">{selectedComponentCount} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/ 67</span></div>
          </div>
        </div>
      </div>

      <EstimateHealthCard
        bottomUp={bottomUp}
        ml={ml}
        similarProjects={similarProjects}
        coverage={coverage}
        sectionA={sectionA}
        overallComplexity={overallComplexity}
      />

      <CostRiskDriversSection
        bottomUp={bottomUp}
        ml={ml}
        coverage={coverage}
        sectionA={sectionA}
        overallComplexity={overallComplexity}
        industry={industry}
      />

      <HistoricalBenchmarkCard ml={ml} similarProjects={similarProjects} />

      <CoverageRatioCard coverage={coverage} />

      <CompletenessScoreCard
        sectionA={sectionA}
        componentRows={componentRows}
        similarProjects={similarProjects}
        selectedCount={selectedCount}
      />

      <AnomalyReviewCard
        ml={ml}
        similarProjects={similarProjects}
        coverage={coverage}
        componentRows={componentRows}
      />

      <RiskReductionCard
        baseline={{
          industry, overallComplexity, sectionA, overrides,
        }}
        baselineResult={result}
      />

      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconUsers size={18} color="var(--gold)" />
          Role-Mapped FTEs
          <span className="est-tag est-tag-formula">From template's Primary Role per component</span>
        </h2>
        {roleRows.map((role) => (
          <div className="est-bar-row" key={role}>
            <div className="est-bar-name">{role}</div>
            <div className="est-bar-track">
              <div className="est-bar-fill" style={{ width: `${(bottomUp.roleAvgFte[role] / maxFte) * 100}%` }} />
            </div>
            <div className="est-bar-contrib">{bottomUp.roleAvgFte[role].toFixed(2)} FTE</div>
          </div>
        ))}
      </div>

      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconListCheck size={18} color="var(--gold)" />
          Generic Delivery Risk Register
          <span className="est-tag est-tag-formula">From uploaded template</span>
        </h2>
        <table className="est-table est-table-compact">
          <thead>
            <tr><th>Risk</th><th>Category</th><th>Prob.</th><th>Impact</th><th>Effort Adder</th></tr>
          </thead>
          <tbody>
            {GENERIC_RISK_REGISTER.map((r) => (
              <tr key={r.risk}>
                <td>{r.risk}</td>
                <td>{r.category}</td>
                <td>{r.probability}</td>
                <td>{r.impact}</td>
                <td>+{r.effort_adder_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {simulatorOpen ? (
        <ScenarioSimulatorPanel
          baseline={{
            industry, overallComplexity, sectionA, overrides,
          }}
          baselineResult={result}
          onClose={() => setSimulatorOpen(false)}
        />
      ) : (
        <button className="est-run-btn est-scenario-open-btn" onClick={() => setSimulatorOpen(true)}>
          <IconFlask size={16} />
          Open Scenario Simulator
        </button>
      )}
    </>
  );
}
