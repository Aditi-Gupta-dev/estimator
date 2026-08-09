import { useEffect } from 'react';
import { IconX, IconUpload, IconCheck, IconChevronRight, IconChevronLeft } from '@tabler/icons-react';
import { useUpload } from '../../hooks/useUpload';
import { KHUploadDropZone } from './KHUploadDropZone';
import { KHUploadMetaForm } from './KHUploadMetaForm';
import { KHUploadProgress } from './KHUploadProgress';
import { KHContentCard } from './KHContentCard';

function StepIndicator({ current }) {
  const steps = ['Select File', 'Metadata', 'Preview & Publish'];
  return (
    <div className="kh-upload-steps">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <>
            <div key={n} className={`kh-upload-step ${state}`}>
              <div className="kh-upload-step-num">
                {n < current ? <IconCheck size={10} /> : n}
              </div>
              {label}
            </div>
            {i < steps.length - 1 && (
              <div key={`sep-${i}`} className="kh-upload-step-connector" />
            )}
          </>
        );
      })}
    </div>
  );
}

export function KHUploadModal({ onClose, onUploadComplete }) {
  const upload = useUpload({ onUploadComplete });

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCancel = () => {
    upload.reset();
    onClose();
  };

  return (
    <div
      className="kh-upload-backdrop"
      id="kh-upload-modal"
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload Knowledge Asset"
    >
      <div className="kh-upload-modal">
        {/* Header */}
        <div className="kh-upload-header">
          <div>
            <div className="kh-upload-header-title">Upload Knowledge Asset</div>
            <div className="kh-upload-header-sub">Add content to the Calibre Knowledge Hub</div>
          </div>
          <button className="kh-modal-close" onClick={handleCancel} aria-label="Close upload">
            <IconX size={15} />
          </button>
        </div>

        {/* Steps */}
        <StepIndicator current={upload.step} />

        {/* Body */}
        <div className="kh-upload-body">
          {upload.isUploading || upload.uploadStatus === 'success' ? (
            <KHUploadProgress
              progress={upload.uploadProgress}
              status={upload.uploadStatus}
              fileName={upload.file?.name}
              subFolder={upload.uploadedSubFolder}
              savedPath={upload.uploadedPath}
            />
          ) : upload.step === 1 ? (
            <KHUploadDropZone upload={upload} />
          ) : upload.step === 2 ? (
            <KHUploadMetaForm upload={upload} />
          ) : (
            // Step 3: Preview
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                This is how your asset will appear in the Knowledge Hub:
              </p>
              <div style={{ maxWidth: 340 }}>
                <KHContentCard
                  item={{
                    id: 'preview',
                    title: upload.metadata.title || 'Untitled asset',
                    subtitle: upload.metadata.version ? `Version ${upload.metadata.version}` : 'New upload',
                    type: upload.metadata.type || 'guideline',
                    unitId: upload.metadata.unitId || 'adm',
                    description: upload.metadata.description || 'No description provided.',
                    fileType: upload.fileType || 'pdf',
                    fileSize: upload.file ? `${(upload.file.size / 1024 / 1024).toFixed(1)} MB` : '—',
                    version: upload.metadata.version,
                    owner: 'You',
                    ownerRole: 'Current user',
                    department: upload.metadata.department,
                    updatedAt: new Date().toISOString(),
                    downloadsCount: 0,
                    tags: upload.metadata.tags,
                    evaInsight: '',
                  }}
                  isSelected={false}
                  onSelect={() => {}}
                  onPreview={() => {}}
                  onDownload={() => {}}
                  onAskEVA={() => {}}
                  downloadCount={0}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!upload.isUploading && upload.uploadStatus !== 'success' && (
          <div className="kh-upload-footer">
            <button className="kh-upload-cancel" onClick={handleCancel}>Cancel</button>

            {upload.step > 1 && (
              <button
                className="kh-upload-cancel"
                onClick={() => upload.setStep((s) => s - 1)}
              >
                <IconChevronLeft size={13} /> Back
              </button>
            )}

            {upload.step < 3 ? (
              <button
                className="kh-upload-next"
                onClick={() => {
                  if (upload.step === 1 && !upload.file) return;
                  if (upload.step === 2) {
                    // validate before proceeding
                    const ok = !(!upload.metadata.title || !upload.metadata.type || !upload.metadata.unitId || !upload.metadata.description.trim());
                    if (!ok) { upload.handleUpload(); return; } // trigger validation errors
                    upload.setStep(3);
                    return;
                  }
                  upload.setStep((s) => s + 1);
                }}
                disabled={upload.step === 1 && !upload.file}
              >
                Next <IconChevronRight size={14} />
              </button>
            ) : (
              <button className="kh-upload-next" onClick={upload.handleUpload}>
                <IconUpload size={14} />
                Upload & Publish
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
