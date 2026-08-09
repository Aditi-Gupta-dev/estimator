import { BUSINESS_UNITS } from '../../constants/business-units';
import { CONTENT_TYPES } from '../../constants/business-units';
import { IconArrowRight } from '@tabler/icons-react';

export function KHAllUnitsView({ allUnitStats, onSelectUnit }) {
  return (
    <div className="kh-all-units" id="kh-all-units-view">
      {BUSINESS_UNITS.map((bu, i) => {
        const stats = allUnitStats[bu.id] || {};
        const byType = stats.byType || {};
        const total = stats.total || 0;
        const newCount = stats.newThisWeek || 0;

        return (
          <div
            key={bu.id}
            id={`kh-bu-card-${bu.id}`}
            className="kh-bu-card"
            style={{
              '--bu-color': bu.color,
              '--bu-glow': bu.glowColor,
              animationDelay: `${i * 0.05}s`,
            }}
            onClick={() => onSelectUnit(bu.id)}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = bu.color + '66';
              e.currentTarget.style.boxShadow = `0 8px 28px ${bu.glowColor}`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            {/* Top accent strip */}
            <div className="kh-bu-card-accent" style={{ background: bu.color }} />

            <div className="kh-bu-card-top">
              <div
                className="kh-bu-card-icon"
                style={{ background: bu.glowColor, color: bu.color }}
              >
                <bu.Icon size={19} color={bu.color} />
              </div>
              <div>
                <div className="kh-bu-card-name">{bu.code}</div>
                <div className="kh-bu-card-fullname" title={bu.fullName}>{bu.fullName}</div>
              </div>
              <div className="kh-bu-card-count" style={{ color: bu.color }}>{total}</div>
            </div>

            {/* Type breakdown dots */}
            <div className="kh-bu-card-breakdown">
              {CONTENT_TYPES.filter((ct) => byType[ct.id]).map((ct) => (
                <span key={ct.id} className="kh-bu-card-type-dot" title={`${ct.label}: ${byType[ct.id]}`}>
                  <span className="kh-bu-card-type-dot-circle" style={{ background: ct.color }} />
                  {byType[ct.id]}
                </span>
              ))}
            </div>

            <div className="kh-bu-card-footer">
              {newCount > 0 ? (
                <span className="kh-bu-card-new">+{newCount} this week</span>
              ) : (
                <span>Up to date</span>
              )}
              <span className="kh-bu-card-arrow" style={{ color: bu.color }}>
                <IconArrowRight size={14} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
