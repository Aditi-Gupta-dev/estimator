import { IconPercentage } from '@tabler/icons-react';
import { EstimatorInfoTip } from './EstimatorInfoTip';

// Matches useEstimator.js's COVERAGE_RATIO_CLIP — the same bounds the ratio
// is clipped to before it's ever sent to /score.
const CLIP = [0.75, 2.25];

function CoverageBar({ label, value }) {
  const fillPct = Math.min(100, Math.max(0, ((value - CLIP[0]) / (CLIP[1] - CLIP[0])) * 100));
  const baselinePct = ((1 - CLIP[0]) / (CLIP[1] - CLIP[0])) * 100;
  const diffPct = Math.abs((value - 1) * 100);
  const direction = value >= 1 ? 'above' : 'below';

  return (
    <div className="est-coverage-row">
      <div className="est-coverage-row-top">
        <span className="est-bar-name">{label}</span>
        <span className="est-coverage-value">{value.toFixed(2)}x</span>
      </div>
      <div className="est-bar-track est-coverage-track">
        <div className="est-bar-fill" style={{ width: `${fillPct}%` }} />
        <div className="est-coverage-marker" style={{ left: `${baselinePct}%` }} />
      </div>
      <div className="est-note">
        Your detailed {label.toLowerCase()} effort is {diffPct.toFixed(0)}% {direction} the template baseline.
      </div>
    </div>
  );
}

export function CoverageRatioCard({ coverage }) {
  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconPercentage size={18} color="var(--gold)" />
        Estimation Coverage
        <EstimatorInfoTip text="Coverage ratio compares detailed bottom-up effort against the baseline effort implied by Section A counts. It is used as a signal by the ML risk model." />
      </h2>
      <CoverageBar label="Integration" value={coverage.integCoverageRatio} />
      <CoverageBar label="Data Migration" value={coverage.dmCoverageRatio} />
    </div>
  );
}
