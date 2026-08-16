import { IconHeartbeat } from '@tabler/icons-react';
import { computeEstimateHealth } from '../../lib/estimatorIntelligence';

export function EstimateHealthCard({
  bottomUp, ml, similarProjects, coverage, sectionA, overallComplexity,
}) {
  const health = computeEstimateHealth({
    bottomUp, ml, similarProjects, coverage, sectionA, overallComplexity,
  });

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconHeartbeat size={18} color="var(--gold)" />
        Estimate Health
        <span className="est-tag est-tag-formula">Rule-based composite</span>
      </h2>

      <div className="est-health-top">
        <span className={`est-band-pill est-band-${health.status}`}>{health.status}</span>
        <span className="est-health-confidence">Confidence: {health.confidence}%</span>
        <span className="est-health-ml-note">ML risk band: <strong>{health.mlRiskBand}</strong></span>
      </div>

      {health.concerns.length > 0 ? (
        <div className="est-health-block">
          <div className="est-health-block-label">Primary concerns</div>
          <ul className="est-completeness-list">
            {health.concerns.map((c) => <li key={c} className="est-check-warn">{c}</li>)}
          </ul>
        </div>
      ) : (
        <div className="est-note">No concerns triggered by the rules below.</div>
      )}

      <div className="est-health-block">
        <div className="est-health-block-label">Recommendation</div>
        <div className="est-health-recommendation">{health.recommendation}</div>
      </div>

      <details className="est-health-why">
        <summary>How is this calculated?</summary>
        <p className="est-note">
          Status starts from the ML risk band (GREEN = 0, AMBER = 1, RED = 2 points), then adds one point each
          for: overrun probability ≥ 50%, predicted deviation ≥5 points above comparable historical projects,
          integration or data-migration coverage ratio ≤ 0.85x, and an aggressive duration for the project&apos;s
          complexity. 0 points → GREEN, 1–2 → AMBER, 3+ → RED. Confidence starts at 95% and is reduced 10
          points per concern, with an additional penalty when fewer than 20 historical projects, or fewer than
          5 comparable projects, are available.
        </p>
      </details>
    </div>
  );
}
