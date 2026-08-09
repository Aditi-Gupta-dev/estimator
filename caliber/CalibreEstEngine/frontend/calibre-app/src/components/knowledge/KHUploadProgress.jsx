import { IconCheck, IconFolder, IconFolderFilled } from '@tabler/icons-react';

export function KHUploadProgress({ progress, status, fileName, savedPath, subFolder }) {
  const isDone       = status === 'success';
  const isTemplate   = subFolder === 'templates';
  const folderLabel  = isTemplate ? 'templates/' : 'data/';
  const folderColor  = isTemplate ? '#34D399' : '#60A5FA';

  return (
    <div className="kh-upload-progress">
      {isDone ? (
        <div className="kh-progress-success">
          <div className="kh-progress-success-icon">
            <IconCheck size={26} />
          </div>

          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 }}>
            Upload Complete!
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            <strong>{fileName}</strong> has been added to the Knowledge Hub
          </div>

          {/* Routing destination badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 14px',
            borderRadius: 8,
            background: isTemplate ? 'rgba(52,211,153,0.1)' : 'rgba(96,165,250,0.1)',
            border: `1px solid ${isTemplate ? 'rgba(52,211,153,0.35)' : 'rgba(96,165,250,0.35)'}`,
            fontSize: 12,
            color: folderColor,
            fontWeight: 600,
          }}>
            <IconFolderFilled size={14} color={folderColor} />
            Saved to&nbsp;
            <span style={{ fontFamily: 'monospace' }}>
              {savedPath || `KnowledgeHub/{BU}/${folderLabel}`}
            </span>
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            {isTemplate
              ? '📋 Template type → templates/ folder'
              : '📁 Non-template type → data/ folder'}
          </div>
        </div>
      ) : (
        <>
          <div className="kh-progress-pct">{progress}%</div>
          <div className="kh-progress-track" style={{ width: '100%' }}>
            <div className="kh-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="kh-progress-text">
            Uploading <strong>{fileName}</strong>…
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Determining destination folder…
          </div>
        </>
      )}
    </div>
  );
}
