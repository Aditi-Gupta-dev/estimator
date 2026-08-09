import { IconDownload, IconEye, IconSparkles, IconPlayerPlay, IconBook } from '@tabler/icons-react';
import { CONTENT_TYPE_MAP, BU_MAP } from '../../constants/business-units';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 86400) return 'Today';
  if (diff < 172800) return 'Yesterday';
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function KHContentListItem({ item, isSelected, onSelect, onPreview, onDownload, onAskEVA, downloadCount }) {
  const ct = CONTENT_TYPE_MAP[item.type] || {};
  const bu = BU_MAP[item.unitId] || {};
  const totalDl = (item.downloadsCount || 0) + (downloadCount || 0);

  return (
    <div
      id={`kh-list-${item.id}`}
      className={`kh-list-row${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect(item)}
    >
      {/* Type badge */}
      <span
        className="kh-type-badge"
        style={{ color: ct.color, background: ct.bg, borderColor: ct.border, flexShrink: 0 }}
      >
        {ct.label || item.type}
      </span>

      {/* File type */}
      <span className={`kh-file-badge ${item.fileType}`} style={{ flexShrink: 0 }}>
        {(item.fileType || '').toUpperCase()}
      </span>

      {/* Title */}
      <div className="kh-list-row-left">
        <span className="kh-list-row-title">{item.title}</span>
        {item.type === 'video' && item.videoDuration && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            <IconPlayerPlay size={9} /> {item.videoDuration}
          </span>
        )}
        {item.type === 'playbook' && item.chapterCount && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            <IconBook size={9} /> {item.chapterCount} ch
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="kh-list-row-meta">
        <span style={{ color: bu.color, fontWeight: 600 }}>{bu.code || item.unitId}</span>
        <span>·</span>
        <span>{item.owner}</span>
        <span>·</span>
        <span>{timeAgo(item.updatedAt)}</span>
        <span>·</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconDownload size={9} />
          {totalDl}
        </span>
      </div>

      {/* Actions */}
      <div className="kh-list-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="kh-list-action-btn dl"
          title={`Download ${(item.fileType || '').toUpperCase()} · ${item.fileSize}`}
          onClick={() => onDownload(item)}
        >
          <IconDownload size={13} />
        </button>
        <button
          className="kh-list-action-btn"
          title={item.type === 'video' ? 'Watch' : 'Preview'}
          onClick={() => onPreview(item)}
        >
          {item.type === 'video' ? <IconPlayerPlay size={13} /> : <IconEye size={13} />}
        </button>
        <button
          className="kh-list-action-btn eva"
          title="Ask EVA"
          onClick={() => onAskEVA(item)}
        >
          <IconSparkles size={13} />
        </button>
      </div>
    </div>
  );
}
