import { useRef } from 'react';
import { IconCloudUpload, IconFile } from '@tabler/icons-react';

export function KHUploadDropZone({ upload }) {
  const inputRef = useRef(null);
  const { file, fileError, isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, handleFileInput } = upload;

  return (
    <div
      className={`kh-drop-zone${isDragging ? ' dragging' : ''}${file ? ' has-file' : ''}${fileError ? ' error' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
      id="kh-drop-zone"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.csv,.mp4,.zip"
        onChange={handleFileInput}
        style={{ display: 'none' }}
        id="kh-file-input"
      />

      {file ? (
        <div className="kh-drop-file-info">
          <div className="kh-drop-file-icon" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
            <IconFile size={18} />
          </div>
          <div>
            <div className="kh-drop-file-name">{file.name}</div>
            <div className="kh-drop-file-size">
              {(file.size / 1024 / 1024).toFixed(1)} MB · {(upload.fileType || '').toUpperCase()}
            </div>
          </div>
          <button
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
            onClick={(e) => { e.stopPropagation(); upload.reset?.(); }}
          >
            ✕ Change
          </button>
        </div>
      ) : (
        <>
          <div className="kh-drop-icon">
            <IconCloudUpload size={24} />
          </div>
          <div className="kh-drop-title">
            {isDragging ? 'Drop your file here' : 'Drag & drop your file here'}
          </div>
          <div className="kh-drop-sub">or <span style={{ color: 'var(--eva)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>click to browse</span></div>
          <div className="kh-drop-types">PDF · XLSX · DOCX · PPTX · CSV · MP4 · ZIP · Max 50 MB</div>
        </>
      )}

      {fileError && <div className="kh-drop-error">⚠ {fileError}</div>}
    </div>
  );
}
