import { useState } from 'react';
import { IconBulb } from '@tabler/icons-react';
import { SECTION_A_PARAMS } from '../../constants/estimator-template';
import { scaleModuleVolumes, scoreEstimate } from '../../lib/estimatorEngine';

// Four fixed, documented, real adjustments to the current committed
// estimate — deliberately not an open-ended search. Each is actually run
// through the real estimator + ML pipeline (never fabricated); only ones
// that come back with a genuinely lower overrun probability are shown.
const CANDIDATES = [
  {
    key: 'integration',
    label: 'Increase Integration allocation by 10%',
    apply: (overrides, sectionA) => ({ overrides: scaleModuleVolumes(overrides, 'Integration', 1.1), sectionA }),
  },
  {
    key: 'dataMigration',
    label: 'Increase Data Migration allocation by 10%',
    apply: (overrides, sectionA) => ({ overrides: scaleModuleVolumes(overrides, 'Data Migration', 1.1), sectionA }),
  },
  {
    key: 'duration',
    label: 'Extend duration by 1 month',
    apply: (overrides, sectionA) => ({
      overrides,
      sectionA: {
        ...sectionA,
        duration_months: Math.min(SECTION_A_PARAMS.duration_months.max, sectionA.duration_months + 1),
      },
    }),
  },
  {
    key: 'contingency',
    label: 'Increase contingency by 5 points',
    apply: (overrides, sectionA) => ({
      overrides,
      sectionA: {
        ...sectionA,
        contingency_pct: Math.min(SECTION_A_PARAMS.contingency_pct.max, sectionA.contingency_pct + 5),
      },
    }),
  },
];

export function RiskReductionCard({ baseline, baselineResult }) {
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [suggestions, setSuggestions] = useState([]);

  const run = async () => {
    setStatus('running');
    const currentProb = baselineResult.ml.overrunProbability;

    const attempts = await Promise.allSettled(CANDIDATES.map(async (candidate) => {
      const { overrides, sectionA } = candidate.apply(baseline.overrides, baseline.sectionA);
      const scored = await scoreEstimate({
        overrides, sectionA, industry: baseline.industry, overallComplexity: baseline.overallComplexity,
      });
      return { candidate, scored };
    }));

    const qualifying = attempts
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter(({ scored }) => scored.ml.overrunProbability < currentProb)
      .sort((a, b) => a.scored.ml.overrunProbability - b.scored.ml.overrunProbability)
      .slice(0, 3);

    setSuggestions(qualifying);
    setStatus('done');
  };

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconBulb size={18} color="var(--gold)" />
        How Can I Reduce Risk?
        <span className="est-tag est-tag-ml">Runs real scenarios</span>
      </h2>
      <div className="est-note">
        Current overrun probability: {Math.round(baselineResult.ml.overrunProbability * 100)}%. Evaluates four
        concrete adjustments to the current estimate through the same estimator + ML pipeline used everywhere
        else on this page, and shows only the ones that actually scored lower — nothing here is predicted
        without being run.
      </div>

      {status === 'idle' && (
        <button className="est-run-btn" onClick={run}>How can I reduce risk?</button>
      )}
      {status === 'running' && <div className="est-note">Scoring candidate adjustments…</div>}
      {status === 'done' && suggestions.length === 0 && (
        <div className="est-note">None of the evaluated changes reduced risk for this estimate.</div>
      )}
      {status === 'done' && suggestions.length > 0 && (
        <ul className="est-completeness-list">
          {suggestions.map(({ candidate, scored }, i) => (
            <li key={candidate.key} className="est-check-pass">
              {i + 1}. {candidate.label} — predicted risk: {Math.round(baselineResult.ml.overrunProbability * 100)}%
              {' → '}{Math.round(scored.ml.overrunProbability * 100)}%
            </li>
          ))}
        </ul>
      )}
      {status === 'done' && (
        <button className="est-link-btn" onClick={run}>Re-run</button>
      )}
    </div>
  );
}
