import { IconLayoutDashboard } from '@tabler/icons-react';
import { BUSINESS_UNITS } from '../../constants/business-units';
import { KHSidebarUnit } from './KHSidebarUnit';

export function KHSidebar({
  selectedUnitId,
  onSelectUnit,
  allUnitStats,
  activeSubdivision,
  onSelectSubdivision,
  visibleSubdivisions = [],
  subdivisionCounts = {},
}) {
  const totalItems = BUSINESS_UNITS.reduce((sum, bu) => sum + (allUnitStats[bu.id]?.total || 0), 0);

  return (
    <aside className="kh-sidebar" id="kh-sidebar">
      {/* All Units */}
      <div className="kh-sidebar-label">Knowledge Hub</div>
      <div
        id="kh-nav-all"
        className={`kh-sidebar-all${selectedUnitId === 'all' ? ' active' : ''}`}
        onClick={() => onSelectUnit('all')}
      >
        <IconLayoutDashboard size={15} />
        All Units
        <span className="kh-sidebar-all-count">{totalItems}</span>
      </div>

      {/* Business Units */}
      <div className="kh-sidebar-label">Business Units</div>
      {BUSINESS_UNITS.map((bu) => (
        <KHSidebarUnit
          key={bu.id}
          bu={bu}
          stats={allUnitStats[bu.id]}
          isActive={selectedUnitId === bu.id}
          onClick={() => onSelectUnit(bu.id)}
        />
      ))}

      {/* Subdivisions quick filter */}
      {visibleSubdivisions.length > 0 && (
        <>
          <div className="kh-sidebar-label">By Category</div>
          <div
            className={`kh-quick-filter${!activeSubdivision ? ' active' : ''}`}
            onClick={() => onSelectSubdivision(null)}
          >
            📚 All Categories
          </div>
          {visibleSubdivisions.map((sub) => {
            const count = subdivisionCounts[sub.id] || 0;
            const emoji = {
              guidelines: '📄',
              templates: '📊',
              playbooks: '▶',
              faqs: '❓',
              pov: '💡',
              casestudies: '📋',
              data: '💹',
            }[sub.id] || '📁';
            return (
              <div
                key={sub.id}
                className={`kh-quick-filter${activeSubdivision === sub.id ? ' active' : ''}`}
                onClick={() => onSelectSubdivision(activeSubdivision === sub.id ? null : sub.id)}
                style={activeSubdivision === sub.id ? { color: sub.color, borderLeftColor: sub.color } : {}}
              >
                {emoji} {sub.label}
                {count > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{count}</span>}
              </div>
            );
          })}
        </>
      )}
    </aside>
  );
}
