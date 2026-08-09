export function KHSidebarUnit({ bu, stats, isActive, onClick }) {
  const { Icon, color, glowColor, code, fullName } = bu;
  const total = stats?.total || 0;
  const newCount = stats?.newThisWeek || 0;

  return (
    <div
      id={`kh-nav-${bu.id}`}
      className={`kh-sidebar-unit${isActive ? ' active' : ''}`}
      style={{ borderLeftColor: isActive ? color : 'transparent' }}
      onClick={onClick}
    >
      <div
        className="kh-sidebar-unit-icon"
        style={{ background: isActive ? glowColor : 'var(--surface-3)', color }}
      >
        <Icon size={13} color={color} />
      </div>

      <div className="kh-sidebar-unit-info">
        <div
          className="kh-sidebar-unit-code"
          style={isActive ? { color } : {}}
        >
          {code}
        </div>
        <div className="kh-sidebar-unit-count">{total} items</div>
      </div>

      {newCount > 0 && (
        <span className="kh-sidebar-unit-badge">+{newCount}</span>
      )}
    </div>
  );
}
