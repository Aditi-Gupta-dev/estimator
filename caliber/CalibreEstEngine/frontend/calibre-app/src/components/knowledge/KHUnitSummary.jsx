import { IconSparkles } from '@tabler/icons-react';
import { CONTENT_TYPE_MAP, BU_EVA_SUGGESTIONS } from '../../constants/business-units';
import { getUnitStats } from '../../constants/knowledge-content';

export function KHUnitSummary({ unit, openEVA }) {
  const unitId = unit?.id || 'all';
  const stats = getUnitStats(unitId);
  const suggestions = BU_EVA_SUGGESTIONS[unitId] || BU_EVA_SUGGESTIONS.all;

  return (
    <div className="kh-unit-summary">
      {/* Stats */}
      <div style={{ marginBottom: 16 }}>
        <div className="kh-modal-section-label">Summary</div>
        {[
          { label: 'Total items', val: stats.total },
          { label: 'New this week', val: stats.newThisWeek },
          ...Object.entries(stats.byType || {}).map(([type, count]) => ({
            label: CONTENT_TYPE_MAP[type]?.label || type,
            val: count,
            color: CONTENT_TYPE_MAP[type]?.color,
          })),
        ].map((row, i) => (
          <div key={i} className="kh-unit-summary-stat">
            <span className="kh-unit-summary-stat-label">{row.label}</span>
            <span
              className="kh-unit-summary-stat-val"
              style={row.color ? { color: row.color } : {}}
            >
              {row.val}
            </span>
          </div>
        ))}
      </div>

      {/* EVA suggestions */}
      <div className="kh-eva-suggestions">
        <div className="kh-eva-suggestions-label">
          <IconSparkles size={9} /> Ask EVA
        </div>
        <div className="kh-eva-suggest-chips">
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="kh-eva-suggest-chip"
              onClick={() => openEVA?.(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
