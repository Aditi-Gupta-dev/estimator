import { IconCoin, IconAlertTriangle } from '@tabler/icons-react';
import { computeCostDrivers, computeRiskDrivers } from '../../lib/estimatorIntelligence';

const fmt = (n, d = 0) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtCurrency = (n) => `$${fmt(n / 1000)}k`;

export function CostRiskDriversSection({
  bottomUp, ml, coverage, sectionA, overallComplexity, industry,
}) {
  const { byRole, byModule } = computeCostDrivers({ bottomUp });
  const riskDrivers = computeRiskDrivers({
    ml, coverage, sectionA, overallComplexity, industry,
  });

  const topRoles = byRole.slice(0, 5);
  const topModules = byModule.slice(0, 5);
  const maxRoleCost = Math.max(...topRoles.map((r) => r.cost), 1);
  const maxDriver = Math.max(...riskDrivers.map((d) => Math.abs(d.contribution)), 0.001);

  return (
    <div className="est-driver-grid">
      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconCoin size={18} color="var(--gold)" />
          Top Cost Drivers
          <span className="est-tag est-tag-formula">Layer 1 — bottom-up</span>
        </h2>
        <div className="est-note">
          What makes this estimate expensive — the largest role and module contributors to cost/effort.
        </div>

        <div className="est-driver-subhead">By Role</div>
        {topRoles.map((r) => (
          <div className="est-bar-row" key={r.role}>
            <div className="est-bar-name">{r.role}</div>
            <div className="est-bar-track">
              <div className="est-bar-fill" style={{ width: `${(r.cost / maxRoleCost) * 100}%` }} />
            </div>
            <div className="est-bar-contrib">{fmtCurrency(r.cost)}</div>
          </div>
        ))}

        <div className="est-driver-subhead">By Module</div>
        <table className="est-table est-table-compact">
          <thead>
            <tr><th>Module</th><th>Effort</th><th>% of Total</th></tr>
          </thead>
          <tbody>
            {topModules.map((m) => (
              <tr key={m.module}>
                <td>{m.module}</td>
                <td>{fmt(m.effortDays)}d</td>
                <td>{m.pctOfTotal.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconAlertTriangle size={18} color="var(--gold)" />
          Top Risk Drivers
          <span className="est-tag est-tag-ml">Layer 2 — ML/SHAP</span>
        </h2>
        <div className="est-note">
          What makes this estimate potentially inaccurate or risky — the model&apos;s top explanatory factors
          for overrun probability.
        </div>

        {riskDrivers.map((d) => (
          <div className="est-risk-driver-row" key={d.feature}>
            <div className="est-bar-row">
              <div className="est-bar-name">{d.label}</div>
              <div className="est-bar-track">
                <div
                  className="est-bar-fill"
                  style={{
                    width: `${Math.min(100, (Math.abs(d.contribution) / maxDriver) * 100)}%`,
                    background: d.contribution >= 0 ? 'var(--danger)' : 'var(--green)',
                  }}
                />
              </div>
              <div className="est-bar-contrib">{d.direction}</div>
            </div>
            <div className="est-driver-explain">{d.explanation}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
