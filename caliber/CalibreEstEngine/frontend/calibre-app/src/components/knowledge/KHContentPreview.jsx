import { IconDownload, IconLink, IconSparkles, IconEdit, IconPlayerPlay, IconEye } from '@tabler/icons-react';
import { CONTENT_TYPE_MAP, BU_MAP, FILE_TYPE_CONFIG } from '../../constants/business-units';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 86400) return 'Today';
  if (diff < 172800) return 'Yesterday';
  const days = Math.floor(diff / 86400);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

export function KHContentPreview({ item, onDownload, onPreview, onOpenModal, onAskEVA }) {
  const { can } = useRoleContext();
  const canEdit = can(CAPABILITIES.KNOWLEDGE_REVIEW);
  const ct = CONTENT_TYPE_MAP[item.type] || {};
  const bu = BU_MAP[item.unitId] || {};
  const ft = FILE_TYPE_CONFIG[item.fileType] || {};
  const previewLabel = item.type === 'video' ? '▶ Watch' : '👁 Preview';
  const dlLabel = `Download ${(item.fileType || '').toUpperCase()} · ${item.fileSize}`;

  return (
    <div className="kh-preview">
      {/* File info block */}
      <div className="kh-preview-file">
        <div
          className="kh-preview-file-icon"
          style={{ background: `${ft.color}22`, color: ft.color, border: `1px solid ${ft.color}44` }}
        >
          {(item.fileType || '').toUpperCase()}
        </div>
        <div>
          <div className="kh-preview-title">{item.title}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
            {item.subtitle} · {item.fileSize}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className="kh-type-badge" style={{ color: ct.color, background: ct.bg, borderColor: ct.border }}>
          {ct.label || item.type}
        </span>
        <span
          className="kh-unit-badge"
          style={{ color: bu.color, background: bu.glowColor, borderColor: bu.color + '44' }}
        >
          {bu.code || item.unitId}
        </span>
      </div>

      {/* Description */}
      <div className="kh-preview-desc">{item.description}</div>

      {/* Meta rows */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        {[
          { label: 'Owner', val: `${item.owner} (${item.ownerRole})` },
          { label: 'Updated', val: timeAgo(item.updatedAt) },
          { label: 'Version', val: item.version || '—' },
          { label: 'Downloads', val: item.downloadsCount || 0 },
        ].map((row) => (
          <div key={row.label} className="kh-preview-meta-row" style={{ padding: '8px 12px' }}>
            <span className="kh-preview-meta-label">{row.label}</span>
            <span className="kh-preview-meta-val">{row.val}</span>
          </div>
        ))}
      </div>

      {/* Tags */}
      {item.tags?.length > 0 && (
        <div className="kh-preview-tags">
          {item.tags.map((tag) => (
            <span key={tag} className="kh-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* EVA Insight */}
      {item.evaInsight && (
        <div className="kh-preview-eva-insight">
          <div className="kh-preview-eva-insight-label">
            <IconSparkles size={9} /> EVA Insight
          </div>
          {item.evaInsight}
        </div>
      )}

      {/* Download button */}
      <div className="kh-preview-actions">
        <button className="kh-preview-dl-btn" onClick={() => onDownload(item)}>
          <IconDownload size={15} />
          {dlLabel}
        </button>

        <div className="kh-preview-secondary-actions">
          <button className="kh-preview-sec-btn" onClick={() => onPreview(item)}>
            {item.type === 'video' ? <IconPlayerPlay size={13} /> : <IconEye size={13} />}
            {previewLabel}
          </button>
          <button className="kh-preview-sec-btn eva" onClick={() => onAskEVA(item)}>
            <IconSparkles size={13} />
            Ask EVA
          </button>
          {canEdit && (
            <button
              className="kh-preview-sec-btn"
              style={{ color: 'var(--amber)', borderColor: 'var(--amber-border)', background: 'var(--amber-bg)' }}
              onClick={() => onOpenModal(item)}
            >
              <IconEdit size={13} />
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
