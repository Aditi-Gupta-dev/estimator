import {
  IconDownload, IconEye, IconSparkles, IconClock, IconBook,
  IconChartBar, IconPlayerPlay,
} from '@tabler/icons-react';
import { CONTENT_TYPE_MAP, BU_MAP, FILE_TYPE_CONFIG } from '../../constants/business-units';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 86400) return 'Today';
  if (diff < 172800) return 'Yesterday';
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function SpecialBadge({ item }) {
  if (item.type === 'video' && item.videoDuration) {
    return (
      <span className="kh-card-spec-badge">
        <IconPlayerPlay size={10} /> {item.videoDuration}
      </span>
    );
  }
  if (item.type === 'playbook' && item.chapterCount) {
    return (
      <span className="kh-card-spec-badge">
        <IconBook size={10} /> {item.chapterCount} chapters
      </span>
    );
  }
  if (item.type === 'data' && item.rowCount) {
    return (
      <span className="kh-card-spec-badge">
        <IconChartBar size={10} /> {item.rowCount.toLocaleString()} rows
      </span>
    );
  }
  return null;
}

export function KHContentCard({
  item, isSelected, onSelect, onPreview, onDownload, onAskEVA, downloadCount,
}) {
  const ct = CONTENT_TYPE_MAP[item.type] || {};
  const bu = BU_MAP[item.unitId] || {};
  const ft = FILE_TYPE_CONFIG[item.fileType] || {};
  const totalDl = (item.downloadsCount || 0) + (downloadCount || 0);

  const previewLabel = item.type === 'video' ? '▶ Watch' : item.type === 'playbook' ? '📖 Read' : '👁 Preview';
  const dlLabel = item.type === 'video' ? 'Download MP4' : `Download ${(item.fileType || '').toUpperCase()}`;

  return (
    <div
      id={`kh-card-${item.id}`}
      className={`kh-card${isSelected ? ' selected' : ''}${item.isNew ? ' new-item' : ''}`}
      onClick={() => onSelect(item)}
      style={{ '--card-color': bu.color || 'var(--cyan)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 8px 28px ${bu.glowColor || 'rgba(0,212,255,0.15)'}`;
        e.currentTarget.style.borderColor = (bu.color || '#00D4FF') + '55';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = isSelected ? '0 0 0 2px var(--cyan-glow)' : '';
        e.currentTarget.style.borderColor = isSelected ? 'var(--cyan-border)' : '';
      }}
    >
      {/* Accent strip */}
      <div className="kh-card-accent-strip" style={{ background: bu.color || ct.color || 'var(--cyan)' }} />

      <div className="kh-card-inner">
        {/* Type badge + unit badge + file type */}
        <div className="kh-card-top">
          <div className="kh-card-badges">
            <span
              className="kh-type-badge"
              style={{ color: ct.color, background: ct.bg, borderColor: ct.border }}
            >
              {ct.label || item.type}
            </span>
            <span
              className="kh-unit-badge"
              style={{
                color: bu.color || 'var(--cyan)',
                background: bu.glowColor || 'var(--cyan-bg)',
                borderColor: (bu.color || '#00D4FF') + '44',
              }}
            >
              {bu.code || item.unitId}
            </span>
          </div>
          <span className={`kh-file-badge ${item.fileType}`}>
            {(item.fileType || '').toUpperCase()}
          </span>
        </div>

        {/* Title + version */}
        <div>
          <div className="kh-card-title">{item.title}</div>
          {item.subtitle && (
            <div className="kh-card-version">{item.subtitle}</div>
          )}
          <SpecialBadge item={item} />
        </div>

        {/* Description */}
        <div className="kh-card-desc">{item.description}</div>

        {/* Footer meta */}
        <div className="kh-card-footer">
          <div className="kh-card-meta">
            <IconClock size={10} />
            {timeAgo(item.updatedAt)}
            <span className="kh-card-meta-sep">·</span>
            {item.owner}
          </div>
          <div className="kh-card-downloads">
            <IconDownload size={10} />
            {totalDl}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="kh-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="kh-card-action-btn"
          onClick={() => onPreview(item)}
          title={previewLabel}
        >
          {item.type === 'video' ? <IconPlayerPlay size={12} /> : <IconEye size={12} />}
          {previewLabel}
        </button>
        <button
          className="kh-card-action-btn primary"
          onClick={() => onDownload(item)}
          title={`${dlLabel} · ${item.fileSize}`}
        >
          <IconDownload size={12} />
          Download
        </button>
        <button
          className="kh-card-action-btn eva-btn"
          onClick={() => onAskEVA(item)}
          title="Ask EVA about this"
        >
          <IconSparkles size={12} />
          EVA
        </button>
      </div>
    </div>
  );
}
