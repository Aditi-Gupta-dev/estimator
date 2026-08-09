import { IconSparkles } from '@tabler/icons-react';
import { getUnitStats } from '../../constants/knowledge-content';

export function KHBUHero({ unit, onAskEVA, dynamicStats }) {
  if (!unit) return null;
  const mockStats = getUnitStats(unit.id);
  const stats = dynamicStats
    ? {
        total: dynamicStats.total,
        newThisWeek: dynamicStats.newThisWeek,
        typesCount: dynamicStats.typesCount
      }
    : mockStats;
  const { Icon, color, glowColor } = unit;

  return (
    <div
      className="kh-bu-hero"
      style={{ background: `linear-gradient(135deg, ${glowColor} 0%, transparent 60%)` }}
    >
      {/* Unit icon */}
      <div
        className="kh-bu-icon"
        style={{ background: glowColor, border: `1px solid ${color}44` }}
      >
        <Icon size={22} color={color} />
      </div>

      {/* Name + desc */}
      <div className="kh-bu-info">
        <div className="kh-bu-name" style={{ color }}>
          {unit.code}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
            — {unit.fullName}
          </span>
        </div>
        <div className="kh-bu-desc">{unit.shortDesc}</div>
      </div>

      {/* Stats */}
      <div className="kh-bu-stats">
        <div className="kh-bu-stat">
          <div className="kh-bu-stat-val" style={{ color }}>{stats.total}</div>
          <div className="kh-bu-stat-label">Items</div>
        </div>
        <div className="kh-bu-stat-divider" />
        <div className="kh-bu-stat">
          <div className="kh-bu-stat-val" style={{ color: 'var(--green)' }}>{stats.newThisWeek}</div>
          <div className="kh-bu-stat-label">New / 7d</div>
        </div>
        <div className="kh-bu-stat-divider" />
        <div className="kh-bu-stat">
          <div className="kh-bu-stat-val" style={{ color: 'var(--amber)' }}>
            {stats.typesCount !== undefined ? stats.typesCount : Object.keys(stats.byType || {}).length}
          </div>
          <div className="kh-bu-stat-label">Types</div>
        </div>
      </div>

      {/* EVA button */}
      <button
        className="kh-bu-eva-btn"
        onClick={() => onAskEVA?.(`Tell me about ${unit.code} estimation — ${unit.fullName}`)}
      >
        <IconSparkles size={13} />
        Ask EVA about {unit.code}
      </button>
    </div>
  );
}
