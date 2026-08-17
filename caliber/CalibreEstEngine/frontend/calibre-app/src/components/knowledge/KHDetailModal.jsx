import { useEffect } from 'react';
import {
  IconX, IconDownload, IconLink, IconSparkles, IconEdit, IconPlayerPlay,
} from '@tabler/icons-react';
import { CONTENT_TYPE_MAP, BU_MAP, FILE_TYPE_CONFIG } from '../../constants/business-units';
import { getRelatedContent } from '../../constants/knowledge-content';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 86400) return 'Today';
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function KHDetailModal({ item, onClose, onDownload, onAskEVA, onSelectRelated }) {
  const { can } = useRoleContext();
  const canEdit = can(CAPABILITIES.KNOWLEDGE_REVIEW);

  const ct = CONTENT_TYPE_MAP[item?.type] || {};
  const bu = BU_MAP[item?.unitId] || {};
  const ft = FILE_TYPE_CONFIG[item?.fileType] || {};
  const related = getRelatedContent(item);

  // Close on ESC
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!item) return null;

  const dlLabel = `Download ${(item.fileType || '').toUpperCase()} · ${item.fileSize}`;

  return (
    <div
      className="kh-modal-backdrop"
      id="kh-detail-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      <div className="kh-modal">
        {/* Header */}
        <div className="kh-modal-header">
          <span className="kh-type-badge" style={{ color: ct.color, background: ct.bg, borderColor: ct.border }}>
            {ct.label || item.type}
          </span>
          <span
            className="kh-unit-badge"
            style={{ color: bu.color, background: bu.glowColor, borderColor: bu.color + '44' }}
          >
            {bu.code || item.unitId}
          </span>
          <span className="kh-modal-title">{item.title}</span>
          <button className="kh-modal-close" onClick={onClose} aria-label="Close modal">
            <IconX size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="kh-modal-body">
          {/* Description */}
          <div>
            <div className="kh-modal-section-label">Description</div>
            <p className="kh-modal-desc">{item.description}</p>
          </div>

          {/* Metadata grid */}
          <div>
            <div className="kh-modal-section-label">Metadata</div>
            <div className="kh-modal-meta-grid">
              {[
                { key: 'Owner', val: item.owner },
                { key: 'Role', val: item.ownerRole },
                { key: 'Version', val: item.version || '—' },
                { key: 'Format', val: `${(item.fileType || '').toUpperCase()} · ${item.fileSize}` },
                { key: 'Updated', val: timeAgo(item.updatedAt) },
                { key: 'Downloads', val: item.downloadsCount || 0 },
                { key: 'Department', val: item.department === 'both' ? 'Sales & Delivery' : item.department },
                { key: 'Unit', val: bu.fullName || item.unitId },
              ].map((m) => (
                <div key={m.key} className="kh-modal-meta-item">
                  <div className="kh-modal-meta-key">{m.key}</div>
                  <div className="kh-modal-meta-val">{m.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          {item.tags?.length > 0 && (
            <div>
              <div className="kh-modal-section-label">Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {item.tags.map((tag) => (
                  <span key={tag} className="kh-tag">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* EVA Insight */}
          {item.evaInsight && (
            <div>
              <div className="kh-modal-section-label">EVA Insight</div>
              <div className="kh-preview-eva-insight">
                <div className="kh-preview-eva-insight-label">
                  <IconSparkles size={9} /> EVA
                </div>
                {item.evaInsight}
              </div>
            </div>
          )}

          {/* Related content */}
          {related.length > 0 && (
            <div>
              <div className="kh-modal-section-label">Related Content</div>
              <div className="kh-modal-related">
                {related.map((rel) => {
                  const rct = CONTENT_TYPE_MAP[rel.type] || {};
                  const rbu = BU_MAP[rel.unitId] || {};
                  return (
                    <div
                      key={rel.id}
                      className="kh-modal-related-item"
                      onClick={() => { onSelectRelated?.(rel); onClose(); }}
                    >
                      <span className="kh-type-badge" style={{ color: rct.color, background: rct.bg, borderColor: rct.border }}>
                        {rct.label}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{rel.title}</span>
                      <span style={{ fontSize: 11, color: rbu.color, fontWeight: 600 }}>
                        {rbu.code || rel.unitId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="kh-modal-footer">
          <button className="kh-modal-dl-btn" onClick={() => onDownload(item)}>
            <IconDownload size={15} />
            {dlLabel}
          </button>
          <button
            className="kh-modal-btn"
            onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/estimate/guide#${item.id}`); }}
          >
            <IconLink size={14} />
            Copy link
          </button>
          <button className="kh-modal-btn eva" onClick={() => { onAskEVA(item); onClose(); }}>
            <IconSparkles size={14} />
            Ask EVA
          </button>
          {canEdit && (
            <button className="kh-modal-btn edit">
              <IconEdit size={14} />
              Edit metadata
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
