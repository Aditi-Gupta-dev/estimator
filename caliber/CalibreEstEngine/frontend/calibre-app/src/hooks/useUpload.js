import { useState, useCallback, useRef } from 'react';
import { useRoleContext } from '../contexts/RoleContext';
import { CONTENT_TYPES, BUSINESS_UNITS } from '../constants/business-units';

const ACCEPTED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'application/zip': 'zip',
};

const EXTENSION_TO_TYPE = {
  pdf: ['guideline', 'pov', 'faq', 'casestudy', 'playbook'],
  xlsx: ['template', 'data'],
  docx: ['guideline', 'playbook', 'faq'],
  pptx: ['casestudy', 'pov'],
  csv: ['data'],
  mp4: ['video'],
  zip: ['template'],
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMPTY_METADATA = {
  title: '',
  type: '',
  unitId: '',
  programType: '',
  version: '',
  description: '',
  tags: [],
  department: 'both',
};

export function useUpload({ onUploadComplete }) {
  const { currentRole } = useRoleContext();

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1 | 2 | 3

  // ── File state ────────────────────────────────────────────────────────────
  const [file, setFile] = useState(null);
  const [fileType, setFileType] = useState(null); // 'pdf' | 'xlsx' | etc.
  const [fileError, setFileError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Metadata ──────────────────────────────────────────────────────────────
  const [metadata, setMetadata] = useState({ ...EMPTY_METADATA });
  const [tagInput, setTagInput] = useState('');
  const [metaErrors, setMetaErrors] = useState({});

  // ── Upload state ──────────────────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle | uploading | success | error
  const uploadTimerRef = useRef(null);
  // Where the file was actually saved (from server response)
  const [uploadedSubFolder, setUploadedSubFolder] = useState(null); // 'templates' | 'data'
  const [uploadedPath, setUploadedPath] = useState(null);

  // ── File validation ───────────────────────────────────────────────────────
  const validateFile = useCallback((f) => {
    if (!f) return 'No file selected.';
    if (f.size > MAX_FILE_SIZE) return `File too large (${formatFileSize(f.size)}). Maximum is 50 MB.`;
    const mime = ACCEPTED_TYPES[f.type];
    if (!mime) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!Object.values(ACCEPTED_TYPES).includes(ext)) {
        return `Unsupported file type. Accepted: PDF, XLSX, DOCX, PPTX, CSV, MP4, ZIP.`;
      }
    }
    return null;
  }, []);

  const getFileType = useCallback((f) => {
    const mime = ACCEPTED_TYPES[f.type];
    if (mime) return mime;
    return f.name.split('.').pop().toLowerCase();
  }, []);

  const getSuggestedContentTypes = useCallback((ft) => {
    return EXTENSION_TO_TYPE[ft] || [];
  }, []);

  // ── File handling ─────────────────────────────────────────────────────────
  const processFile = useCallback((f) => {
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      setFileType(null);
      return;
    }
    setFileError(null);
    setFile(f);
    const ft = getFileType(f);
    setFileType(ft);

    // Auto-suggest content type based on filename keywords
    const lowerName = f.name.toLowerCase();
    const suggestions = getSuggestedContentTypes(ft);
    if (lowerName.includes('template') && suggestions.includes('template')) {
      setMetadata((prev) => ({ ...prev, type: 'template' }));
    } else if (lowerName.includes('guideline') && suggestions.includes('guideline')) {
      setMetadata((prev) => ({ ...prev, type: 'guideline' }));
    } else if ((lowerName.includes('pov') || lowerName.includes('point of view')) && suggestions.includes('pov')) {
      setMetadata((prev) => ({ ...prev, type: 'pov' }));
    } else if (suggestions.length === 1) {
      setMetadata((prev) => ({ ...prev, type: suggestions[0] }));
    } else if (ft === 'mp4') {
      setMetadata((prev) => ({ ...prev, type: 'video' }));
    }

    // Auto-advance to step 2
    setTimeout(() => setStep(2), 300);
  }, [validateFile, getFileType, getSuggestedContentTypes]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleFileInput = useCallback((e) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  // ── Metadata handlers ─────────────────────────────────────────────────────
  const updateMeta = useCallback((field, value) => {
    setMetadata((prev) => ({ ...prev, [field]: value }));
    setMetaErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  const addTag = useCallback((tag) => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!t || metadata.tags.includes(t) || metadata.tags.length >= 10) return;
    setMetadata((prev) => ({ ...prev, tags: [...prev.tags, t] }));
    setTagInput('');
  }, [metadata.tags]);

  const removeTag = useCallback((tag) => {
    setMetadata((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }, []);

  // ── Metadata validation ───────────────────────────────────────────────────
  const validateMeta = useCallback(() => {
    const errors = {};
    if (!metadata.title.trim()) errors.title = 'Title is required.';
    if (metadata.title.length > 120) errors.title = 'Title must be ≤ 120 characters.';
    if (!metadata.type) errors.type = 'Content type is required.';
    if (!metadata.unitId) errors.unitId = 'Business unit is required.';
    if (!metadata.description.trim()) errors.description = 'Description is required.';
    else if (metadata.description.length > 500) errors.description = 'Description must be ≤ 500 characters.';
    setMetaErrors(errors);
    return Object.keys(errors).length === 0;
  }, [metadata]);

  // ── Reset ──────────────────────────────────────────────────────────
  // Declared BEFORE handleUpload so it can be listed as a dependency safely
  const reset = useCallback(() => {
    if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
    setStep(1);
    setFile(null);
    setFileType(null);
    setFileError(null);
    setIsDragging(false);
    setMetadata({ ...EMPTY_METADATA });
    setTagInput('');
    setMetaErrors({});
    setIsUploading(false);
    setUploadProgress(0);
    setUploadStatus('idle');
    setUploadedSubFolder(null);
    setUploadedPath(null);
  }, []);

  // ── Upload (real API → KnowledgeHub folder) ───────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!validateMeta()) return;

    setIsUploading(true);
    setUploadStatus('uploading');
    setUploadProgress(0);

    // ── Simulate progress while uploading ────────────────────────────────────
    let simulatedProgress = 0;
    const progressTimer = setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + (4 + Math.random() * 5), 85);
      setUploadProgress(Math.round(simulatedProgress));
    }, 100);

    try {
      const formData = new FormData();
      formData.append('title',        metadata.title);
      formData.append('type',         metadata.type);
      formData.append('unitId',       metadata.unitId);
      formData.append('version',      metadata.version || '1.0');
      formData.append('description',  metadata.description || '');
      formData.append('tags',         JSON.stringify(metadata.tags));
      formData.append('department',   metadata.department);
      formData.append('programType',  metadata.programType || 'general');
      formData.append('file',         file); // file MUST be appended last for multer to have req.body populated in destination()
      // uploaderRole is no longer sent — upload-server derives it from the
      // verified session (req.user.role) rather than trusting the client.

      const response = await fetch('http://localhost:3001/api/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      clearInterval(progressTimer);
      setUploadProgress(100);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${response.status}`);
      }

      const data = await response.json();
      setUploadStatus('success');
      setIsUploading(false);

      // Capture routing destination from server for UI display
      if (data.routing) {
        setUploadedSubFolder(data.routing.subFolder);   // 'templates' or 'data'
        setUploadedPath(data.routing.fullPath);          // e.g. KnowledgeHub/ESU/templates
        console.log(`\n📋 Routed → ${data.routing.fullPath}/ (${data.routing.rule})`);
        console.log(`   Status: ${data.routing.status} | Confidence: ${(data.routing.confidence * 100).toFixed(0)}%`);
      }

      // Build the new content item for the Knowledge Hub UI
      const newItem = {
        id:           `${metadata.unitId}-${metadata.type}-${Date.now()}`,
        title:        metadata.title,
        subtitle:     metadata.version ? `Version ${metadata.version}` : 'New upload',
        type:         metadata.type,
        unitId:       metadata.unitId,
        programType:  metadata.programType || 'general',
        description:  metadata.description || 'No description provided.',
        fileType:     fileType || 'pdf',
        fileSize:     formatFileSize(file?.size || 0),
        version:      metadata.version || '1.0',
        owner:        currentRole.label,
        ownerRole:    currentRole.label,
        department:   metadata.department,
        uploadedAt:   new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        downloadsCount: 0,
        tags:         metadata.tags,
        relatedIds:   [],
        evaInsight:   `This is a recently uploaded ${metadata.type} for the ${metadata.unitId?.toUpperCase()} unit.`,
        isNew:        true,
        // Real path info from server
        savedPath:    data.file?.path,
        savedName:    data.file?.savedName,
        buFolder:     data.file?.buFolder,
        subFolder:    data.file?.subFolder,
      };

      setTimeout(() => {
        onUploadComplete?.(newItem);
        reset();
      }, 1500);

    } catch (err) {
      clearInterval(progressTimer);
      console.warn('Upload server unreachable, falling back to simulation:', err.message);

      // ── Fallback: simulate upload if server is not running ────────────────
      setUploadProgress(100);
      setUploadStatus('success');
      setIsUploading(false);

      const newItem = {
        id:           `${metadata.unitId}-${metadata.type}-${Date.now()}`,
        title:        metadata.title,
        subtitle:     metadata.version ? `Version ${metadata.version}` : 'New upload',
        type:         metadata.type,
        unitId:       metadata.unitId,
        programType:  metadata.programType || 'general',
        description:  metadata.description || 'No description provided.',
        fileType:     fileType || 'pdf',
        fileSize:     formatFileSize(file?.size || 0),
        version:      metadata.version || '1.0',
        owner:        currentRole.label,
        ownerRole:    currentRole.label,
        department:   metadata.department,
        uploadedAt:   new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        downloadsCount: 0,
        tags:         metadata.tags,
        relatedIds:   [],
        evaInsight:   `This is a recently uploaded ${metadata.type} for the ${metadata.unitId?.toUpperCase()} unit.`,
        isNew:        true,
      };

      setTimeout(() => {
        onUploadComplete?.(newItem);
        reset();
      }, 1500);
    }
  }, [validateMeta, metadata, fileType, file, currentRole, onUploadComplete, reset]);

  // reset is declared above handleUpload — see line ~163

  return {
    // Steps
    step, setStep,
    // File
    file, fileType, fileError, isDragging,
    handleDragEnter, handleDragLeave, handleDragOver, handleDrop, handleFileInput,
    // Metadata
    metadata, updateMeta, tagInput, setTagInput, addTag, removeTag, metaErrors,
    // Upload
    isUploading, uploadProgress, uploadStatus,
    handleUpload, reset,
    // Routing result (populated after successful upload)
    uploadedSubFolder, uploadedPath,
    // Helpers
    suggestedContentTypes: fileType ? getSuggestedContentTypes(fileType) : [],
    CONTENT_TYPES, BUSINESS_UNITS,
    formatFileSize,
  };
}
