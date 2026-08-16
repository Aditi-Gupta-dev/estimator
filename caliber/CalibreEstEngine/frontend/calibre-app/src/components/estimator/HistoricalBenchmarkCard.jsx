import { IconChartBar } from '@tabler/icons-react';
import { computeBenchmarkSummary } from '../../lib/estimatorIntelligence';

export function HistoricalBenchmarkCard({ ml, similarProjects }) {
  const summary = computeBenchmarkSummary({ ml, similarProjects });

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconChartBar size={18} color="var(--gold)" />
        Historical Benchmark
        <span className="est-tag est-tag-ml">{summary.comparableCount} comparable projects found</span>
      </h2>

      {summary.comparableCount > 0 ? (
        <div className="est-kpi-grid">
          <div className="est-kpi">
            <div className="est-kpi-label">Median Comparable Deviation</div>
            <div className="est-kpi-value">
              {summary.medianDeviation >= 0 ? '+' : ''}{summary.medianDeviation.toFixed(1)}%
            </div>
            <div className="est-kpi-sub">across the {summary.comparableCount} nearest projects</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Comparable Overrun Rate</div>
            <div className="est-kpi-value">{Math.round(summary.comparableOverrunRate * 100)}%</div>
            <div className="est-kpi-sub">{summary.overrunCount} of {summary.comparableCount} overran</div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Your Predicted Deviation</div>
            <div className="est-kpi-value">
              {summary.predictedDeviationPct >= 0 ? '+' : ''}{summary.predictedDeviationPct.toFixed(1)}%
            </div>
            <div className="est-kpi-sub">
              {summary.deviationGapPts >= 0 ? 'higher' : 'lower'} than comparable median by {Math.abs(summary.deviationGapPts).toFixed(1)} pts
            </div>
          </div>
          <div className="est-kpi">
            <div className="est-kpi-label">Model&apos;s Band Overrun Rate</div>
            <div className="est-kpi-value">{Math.round(summary.modelHistoricalOverrunRate * 100)}%</div>
            <div className="est-kpi-sub">broader statistic, n={summary.modelHistoricalNProjects}</div>
          </div>
        </div>
      ) : (
        <div className="est-note">No comparable historical projects were returned for this configuration.</div>
      )}

      {similarProjects.length > 0 && (
        <>
          <div className="est-driver-subhead">Comparable Projects</div>
          <table className="est-table est-table-compact">
            <thead>
              <tr><th>Project</th><th>Industry</th><th>Complexity</th><th>Deviation</th><th>Health</th></tr>
            </thead>
            <tbody>
              {similarProjects.map((p) => (
                <tr key={p.project_id}>
                  <td>{p.project_id}</td>
                  <td>{p.industry}</td>
                  <td>{p.complexity}</td>
                  <td className={p.overrun_flag ? 'est-dev-over' : 'est-dev-under'}>
                    {p.deviation_pct >= 0 ? '+' : ''}{p.deviation_pct.toFixed(1)}%
                  </td>
                  <td>{p.health}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
