import { useNavigate } from 'react-router-dom';
import { IconArrowUpRight, IconLock, IconShieldLock } from '@tabler/icons-react';

export function WorkflowCard({ workflow, isLocked, currentRoleId, onLockedClick }) {
  const navigate = useNavigate();
  const { num, title, description, color, glowColor, gradientFrom, borderHover, Icon, id } = workflow;

  // Super user gets "Approval Queue" badge on card 02
  const showApprovalBadge = id === 2 && currentRoleId === 'super';
  // SME gets green access badge on cards 04 & 05 instead of lock
  const showSMEAccess = (id === 4 || id === 5) && currentRoleId === 'sme';

  const handleClick = () => {
    if (isLocked) {
      onLockedClick();
      return;
    }
    if (workflow.route) {
      navigate(workflow.route);
    }
  };

  return (
    <article
      className={`workflow-card${isLocked ? ' locked' : ''}`}
      style={{
        '--card-color': color,
        '--card-glow': glowColor,
        '--card-border-hover': borderHover,
      }}
      onClick={handleClick}
      role="button"
      tabIndex={isLocked ? -1 : 0}
      aria-label={`${isLocked ? 'Locked: ' : ''}Workflow ${num}: ${title}`}
      aria-disabled={isLocked}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      // Inline hover styles via CSS custom properties
      onMouseEnter={(e) => {
        if (isLocked) return;
        const el = e.currentTarget;
        el.style.borderColor = borderHover;
        el.style.boxShadow = `0 12px 40px ${glowColor}`;
        el.style.setProperty('--before-gradient', `radial-gradient(circle at top left, ${gradientFrom} 0%, transparent 60%)`);
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = '';
        el.style.boxShadow = '';
      }}
    >
      {/* Radial gradient overlay via inline style on hover */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at top left, ${gradientFrom} 0%, transparent 60%)`,
          borderRadius: 'var(--r-lg)',
          opacity: 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
        }}
        className="card-gradient-overlay"
      />

      {/* Left accent strip */}
      <div
        className="card-accent-strip"
        style={{ background: color }}
      />

      {/* Card top row */}
      <div className="card-top">
        <div
          className="card-icon-box"
          style={{ background: `${color}18`, color }}
        >
          <Icon size={22} strokeWidth={1.8} />
        </div>
        <div className="card-arrow">
          <IconArrowUpRight size={16} strokeWidth={2} />
        </div>
      </div>

      {/* Body */}
      <div className="card-body">
        <div className="card-num">{num}</div>
        <div className="card-title">{title}</div>
        <div className="card-desc">{description}</div>

        {/* Badges */}
        <div className="card-badges">
          {isLocked && !showSMEAccess && (
            <span className="card-badge lock">
              <IconShieldLock size={11} strokeWidth={2} />
              Admin / SME only
            </span>
          )}
          {showSMEAccess && (
            <span className="card-badge sme-access">
              <IconShieldLock size={11} strokeWidth={2} />
              SME Access
            </span>
          )}
          {isLocked && (
            <span className="card-badge lock" style={{ opacity: 0.7 }}>
              <IconLock size={11} strokeWidth={2} />
              Not available for your role
            </span>
          )}
          {showApprovalBadge && (
            <span className="card-badge approval">
              Approval Queue
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
