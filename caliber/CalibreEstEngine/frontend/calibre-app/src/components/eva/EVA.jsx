import { EVAAvatar } from './EVAAvatar';
import { EVAPanel } from './EVAPanel';
import '../../styles/eva.css';

export function EVA({ evaStateOverride }) {
  const { toggleEVA, isOpen } = evaStateOverride;

  return (
    <>
      {/* Floating Action Button */}
      <button
        className="eva-fab"
        onClick={toggleEVA}
        aria-label={`${isOpen ? 'Close' : 'Open'} EVA — Estimation Virtual Assistant`}
        aria-expanded={isOpen}
      >
        <div className="eva-fab-avatar-wrap">
          <EVAAvatar size="sm" animate={!isOpen} />
          <div className="eva-online-dot" />
        </div>
        <div className="eva-fab-text">
          <span className="eva-fab-name">EVA</span>
          <span className="eva-fab-sub">Estimation Virtual Assistant</span>
        </div>
      </button>

      {/* Chat Panel */}
      <EVAPanel evaState={evaStateOverride} />
    </>
  );
}
