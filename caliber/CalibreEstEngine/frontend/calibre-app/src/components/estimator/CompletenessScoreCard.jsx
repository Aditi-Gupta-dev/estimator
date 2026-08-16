import { IconChecklist } from '@tabler/icons-react';
import { computeCompletenessScore } from '../../lib/estimatorIntelligence';

export function CompletenessScoreCard({
  sectionA, componentRows, similarProjects, selectedCount,
}) {
  const { score, checks } = computeCompletenessScore({
    sectionA, componentRows, similarProjects, selectedCount,
  });
  const failedCount = checks.filter((c) => !c.passed).length;

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconChecklist size={18} color="var(--gold)" />
        Estimate Completeness
        <span className="est-tag est-tag-formula">Deterministic checklist</span>
      </h2>

      <div className="est-completeness-score">{score}%</div>

      <ul className="est-completeness-list">
        {checks.map((c) => (
          <li key={c.key} className={c.passed ? 'est-check-pass' : 'est-check-warn'}>
            {c.passed ? '✓' : '⚠'} {c.label}
          </li>
        ))}
      </ul>

      {failedCount > 0 && (
        <div className="est-note">
          {failedCount} estimation area{failedCount > 1 ? 's' : ''} require review.
        </div>
      )}
    </div>
  );
}
