import { SUBDIVISION_MAP } from '../../constants/subdivisions';

export function KHSubdivisionNav({
  visibleSubdivisions,
  activeSubdivision,
  onSelectSubdivision,
  subdivisionCounts,
}) {
  return (
    <div className="kh-subdivision-nav" id="kh-subdivision-nav">
      <button
        className={`kh-sub-tab${!activeSubdivision ? ' active' : ''}`}
        style={!activeSubdivision ? { color: 'var(--gold)', borderColor: 'var(--gold-border)', background: 'var(--gold-bg)' } : {}}
        onClick={() => onSelectSubdivision(null)}
      >
        All
        <span className="kh-sub-tab-count">{Object.values(subdivisionCounts).reduce((a, b) => a + b, 0)}</span>
      </button>
      {visibleSubdivisions.map((sub) => {
        const count = subdivisionCounts[sub.id] || 0;
        if (count === 0) return null;
        const isActive = activeSubdivision === sub.id;
        return (
          <button
            key={sub.id}
            id={`kh-sub-${sub.id}`}
            className={`kh-sub-tab${isActive ? ' active' : ''}`}
            style={isActive ? { color: sub.color, borderColor: sub.border, background: sub.bg } : {}}
            onClick={() => onSelectSubdivision(isActive ? null : sub.id)}
            title={sub.description}
          >
            {sub.id === 'data' && (
              <span className="kh-sub-restricted-dot" title="Restricted — Admin / SME only" />
            )}
            {sub.label}
            <span className="kh-sub-tab-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
