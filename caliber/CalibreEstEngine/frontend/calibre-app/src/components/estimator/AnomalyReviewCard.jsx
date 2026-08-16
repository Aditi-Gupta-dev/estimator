import { IconShieldCheck } from '@tabler/icons-react';
import { computeAnomalies } from '../../lib/estimatorIntelligence';

export function AnomalyReviewCard({
  ml, similarProjects, coverage, componentRows,
}) {
  const { items, dataCaveat } = computeAnomalies({
    ml, similarProjects, coverage, componentRows,
  });

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconShieldCheck size={18} color="var(--gold)" />
        AI Review
        <span className="est-tag est-tag-formula">Rule-based anomaly detection</span>
      </h2>

      {items.length === 0 ? (
        <div className="est-check-pass est-anomaly-clear">✓ NO MAJOR ANOMALIES DETECTED</div>
      ) : (
        <ul className="est-completeness-list">
          {items.map((item) => (
            <li key={item.text} className={item.severity === 'anomaly' ? 'est-check-warn' : 'est-check-info'}>
              {item.severity === 'anomaly' ? '⚠ POTENTIAL ANOMALY — ' : '⚠ REVIEW SUGGESTED — '}
              {item.text}
            </li>
          ))}
        </ul>
      )}

      {dataCaveat && <div className="est-note">{dataCaveat}</div>}
    </div>
  );
}
