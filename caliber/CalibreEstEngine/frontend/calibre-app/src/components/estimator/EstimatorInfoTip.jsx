import { IconInfoCircle } from '@tabler/icons-react';

// Hover/focus-triggered explanation bubble — CSS-only (no new dependency),
// used next to KPI labels and section headers so a first-time user can see
// what a number means and how it's calculated without leaving the page.
export function EstimatorInfoTip({ text }) {
  return (
    <span className="est-info-tip" tabIndex={0}>
      <IconInfoCircle size={13} />
      <span className="est-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
