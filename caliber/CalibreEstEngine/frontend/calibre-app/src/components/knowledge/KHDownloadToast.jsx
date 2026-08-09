import { IconDownload, IconCheck, IconX } from '@tabler/icons-react';

export function KHDownloadToast({ download, onDismiss }) {
  if (!download) return null;

  const isDone = download.done;

  return (
    <div className={`kh-download-toast${isDone ? ' done' : ''}`} id="kh-download-toast">
      <div className="kh-dl-toast-top">
        <div className="kh-dl-toast-icon">
          {isDone ? <IconCheck size={16} /> : <IconDownload size={16} />}
        </div>
        <div className="kh-dl-toast-info">
          <div className="kh-dl-toast-title">{download.title}</div>
          <div className="kh-dl-toast-status">
            {isDone
              ? `Download complete (demo) · ${(download.fileType || '').toUpperCase()} · ${download.fileSize}`
              : `Downloading… ${download.progress}%`}
          </div>
        </div>
        <button className="kh-dl-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <IconX size={10} />
        </button>
      </div>
      {!isDone && (
        <div className="kh-dl-toast-bar">
          <div className="kh-dl-toast-fill" style={{ width: `${download.progress}%` }} />
        </div>
      )}
    </div>
  );
}
