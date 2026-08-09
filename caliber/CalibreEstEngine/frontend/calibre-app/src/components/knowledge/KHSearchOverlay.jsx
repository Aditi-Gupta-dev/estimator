import { CONTENT_TYPE_MAP, BU_MAP } from '../../constants/business-units';
import { searchContent } from '../../constants/knowledge-content';
import { IconSparkles } from '@tabler/icons-react';

export function KHSearchOverlay({ query, onSelectItem, onClose, openEVA }) {
  if (!query || query.trim().length < 2) return null;

  const results = searchContent(query).slice(0, 10);
  const grouped = {};
  results.forEach((item) => {
    const type = item.type;
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(item);
  });

  return (
    <div className="kh-search-overlay" id="kh-search-overlay">
      {Object.entries(grouped).map(([type, items]) => {
        const ct = CONTENT_TYPE_MAP[type] || {};
        return (
          <div key={type}>
            <div className="kh-search-overlay-section" style={{ color: ct.color }}>
              {ct.label || type} ({items.length})
            </div>
            {items.map((item) => {
              const bu = BU_MAP[item.unitId] || {};
              return (
                <div
                  key={item.id}
                  className="kh-search-overlay-item"
                  onClick={() => { onSelectItem(item); onClose(); }}
                >
                  <span
                    className="kh-unit-badge"
                    style={{ color: bu.color, background: bu.glowColor, borderColor: bu.color + '44', flexShrink: 0 }}
                  >
                    {bu.code || item.unitId}
                  </span>
                  <span className="kh-search-overlay-title">{item.title}</span>
                  <span className="kh-search-overlay-meta">{(item.fileType || '').toUpperCase()} · {item.fileSize}</span>
                </div>
              );
            })}
          </div>
        );
      })}

      {results.length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          No results for "{query}"
        </div>
      )}

      <div
        className="kh-search-overlay-eva"
        onClick={() => { openEVA?.(`Help me find: ${query}`); onClose(); }}
      >
        <IconSparkles size={13} color="var(--eva)" />
        <span className="kh-search-overlay-eva-text">Ask EVA: "{query}"</span>
      </div>
    </div>
  );
}
