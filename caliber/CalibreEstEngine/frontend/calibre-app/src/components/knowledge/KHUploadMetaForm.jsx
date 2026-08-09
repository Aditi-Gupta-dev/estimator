import { BU_MAP, CONTENT_TYPE_MAP } from '../../constants/business-units';

// ── BU id → folder code ───────────────────────────────────────────────────────
const BU_FOLDER = {
  esu: 'ESU', adm: 'ADM', itis: 'ITIS', bps: 'BPS', ti: 'TI',
  ion: 'iON', bfsi: 'BFSI', iae: 'IAE', _global: '_global',
  cyber: 'CYBER', ai: 'AI', datacloud: 'DATACLOUD',
};

// ── Live routing preview ──────────────────────────────────────────────────────
function RoutingPreview({ unitId, docType }) {
  if (!unitId && !docType) return null;

  const buFolder  = BU_FOLDER[unitId] || (unitId ? '????' : null);
  const isTemplate = docType?.toLowerCase() === 'template';
  const subFolder = isTemplate ? 'templates' : 'data';
  const ct        = CONTENT_TYPE_MAP[docType];

  const fullPath  = buFolder
    ? `KnowledgeHub / ${buFolder} / ${subFolder} /`
    : `KnowledgeHub / ???? / ${subFolder} /`;

  const isComplete = buFolder && buFolder !== '????' && docType;

  return (
    <div style={{
      margin: '10px 0 4px',
      padding: '10px 14px',
      borderRadius: 8,
      background: isTemplate ? 'rgba(52,211,153,0.07)' : 'rgba(96,165,250,0.07)',
      border: `1px solid ${isTemplate ? 'rgba(52,211,153,0.3)' : 'rgba(96,165,250,0.3)'}`,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    }}>
      {/* Folder icon */}
      <span style={{ fontSize: 18, flexShrink: 0 }}>
        {isTemplate ? '📋' : '📁'}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Routing rule label */}
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: isTemplate ? '#34D399' : '#60A5FA',
          marginBottom: 3,
        }}>
          {isTemplate ? 'Estimation Template → templates/' : `${ct?.label || 'Artifact'} → data/`}
        </div>

        {/* Path */}
        <div style={{
          fontFamily: 'monospace',
          fontSize: 12,
          color: isComplete ? 'var(--text-primary)' : 'var(--text-muted)',
          wordBreak: 'break-all',
        }}>
          {fullPath}
        </div>
      </div>

      {/* Complete / incomplete badge */}
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: isComplete ? 'rgba(52,211,153,0.15)' : 'rgba(255,179,71,0.15)',
        color: isComplete ? '#34D399' : '#FFB347',
        flexShrink: 0,
      }}>
        {isComplete ? 'READY' : buFolder ? 'SELECT TYPE' : 'SELECT BU'}
      </span>
    </div>
  );
}

function prettifyPT(pt) {
  if (!pt || pt === 'general') return 'General';
  return pt.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function KHUploadMetaForm({ upload }) {
  const {
    metadata, updateMeta, tagInput, setTagInput, addTag, removeTag, metaErrors,
    CONTENT_TYPES, BUSINESS_UNITS,
  } = upload;

  const buProgramTypes = metadata.unitId
    ? (BU_MAP[metadata.unitId]?.programTypes || ['general'])
    : [];

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    }
  };

  return (
    <div className="kh-meta-form" id="kh-meta-form">

      {/* ── Live routing preview ─────────────────────────────────────────── */}
      <RoutingPreview unitId={metadata.unitId} docType={metadata.type} />

      {/* Title */}
      <div className="kh-form-field">
        <label className="kh-form-label required" htmlFor="kh-meta-title">Title</label>
        <input
          id="kh-meta-title"
          className={`kh-form-input${metaErrors.title ? ' error' : ''}`}
          value={metadata.title}
          onChange={(e) => updateMeta('title', e.target.value)}
          placeholder="e.g. Oracle Fusion ERP Estimation Template v2.1"
          maxLength={120}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {metaErrors.title && <span className="kh-form-error">{metaErrors.title}</span>}
          <span className="kh-form-char-count">{metadata.title.length}/120</span>
        </div>
      </div>

      {/* Content Type + BU — side by side */}
      <div className="kh-form-row">

        {/* Content Type */}
        <div className="kh-form-field">
          <label className="kh-form-label required" htmlFor="kh-meta-type">
            Content Type
          </label>

          {/* Visual type picker — groups Template separately */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
             {/* Template option (green) */}
             {CONTENT_TYPES.filter((ct) => ct.id === 'template').map((ct) => (
               <div
                 key={ct.id}
                 onClick={() => updateMeta('type', ct.id)}
                 style={{
                   display: 'flex',
                   alignItems: 'center',
                   gap: 8,
                   padding: '7px 10px',
                   borderRadius: 6,
                   cursor: 'pointer',
                   background: metadata.type === ct.id ? ct.bg : 'transparent',
                   border: `1px solid ${metadata.type === ct.id ? ct.border : 'var(--border-subtle)'}`,
                   transition: 'all 0.15s',
                 }}
               >
                 <input
                   type="radio"
                   name="kh-type"
                   value={ct.id}
                   checked={metadata.type === ct.id}
                   readOnly
                   style={{ accentColor: ct.color, cursor: 'pointer' }}
                 />
                 <span style={{ color: ct.color, fontWeight: 700, fontSize: 12 }}>
                   📋 {ct.label}
                 </span>
                 <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                   → templates/
                 </span>
               </div>
             ))}

            {/* Divider */}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 0' }}>
              Other artifacts → data/
            </div>

            {/* All other types (blue) */}
            <select
              id="kh-meta-type"
              className={`kh-form-select${metaErrors.type ? ' error' : ''}`}
              value={metadata.type === 'template' ? '' : metadata.type}
              onChange={(e) => updateMeta('type', e.target.value)}
            >
              <option value="">Select artifact type…</option>
              {CONTENT_TYPES.filter((ct) => ct.id !== 'template').map((ct) => (
                <option key={ct.id} value={ct.id}>{ct.label}</option>
              ))}
            </select>
          </div>

          {metaErrors.type && <span className="kh-form-error">{metaErrors.type}</span>}
        </div>

        {/* Business Unit */}
        <div className="kh-form-field">
          <label className="kh-form-label required" htmlFor="kh-meta-unit">Business Unit</label>
          <select
            id="kh-meta-unit"
            className={`kh-form-select${metaErrors.unitId ? ' error' : ''}`}
            value={metadata.unitId}
            onChange={(e) => updateMeta('unitId', e.target.value)}
          >
            <option value="">Select unit…</option>
            {BUSINESS_UNITS.map((bu) => (
              <option key={bu.id} value={bu.id}>{bu.code} — {bu.fullName}</option>
            ))}
          </select>
          {metaErrors.unitId && <span className="kh-form-error">{metaErrors.unitId}</span>}
        </div>
      </div>

      {/* Program Type */}
      {buProgramTypes.length > 0 && (
        <div className="kh-form-field">
          <label className="kh-form-label" htmlFor="kh-meta-programtype">Program Type</label>
          <select
            id="kh-meta-programtype"
            className="kh-form-select"
            value={metadata.programType}
            onChange={(e) => updateMeta('programType', e.target.value)}
          >
            <option value="">Select program type… (optional)</option>
            {buProgramTypes.map((pt) => (
              <option key={pt} value={pt}>{prettifyPT(pt)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Version + Department */}
      <div className="kh-form-row">
        <div className="kh-form-field">
          <label className="kh-form-label" htmlFor="kh-meta-version">Version</label>
          <input
            id="kh-meta-version"
            className="kh-form-input"
            value={metadata.version}
            onChange={(e) => updateMeta('version', e.target.value)}
            placeholder="e.g. 1.0, v2.1"
          />
        </div>

        <div className="kh-form-field">
          <label className="kh-form-label">Department</label>
          <div className="kh-radio-group">
            {['both', 'sales', 'delivery'].map((d) => (
              <label key={d} className="kh-radio-opt">
                <input
                  type="radio"
                  name="kh-dept"
                  value={d}
                  checked={metadata.department === d}
                  onChange={() => updateMeta('department', d)}
                />
                {d === 'both' ? 'Both' : d.charAt(0).toUpperCase() + d.slice(1)}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="kh-form-field full">
        <label className="kh-form-label required" htmlFor="kh-meta-desc">Description</label>
        <textarea
          id="kh-meta-desc"
          className={`kh-form-textarea${metaErrors.description ? ' error' : ''}`}
          value={metadata.description}
          onChange={(e) => updateMeta('description', e.target.value)}
          placeholder="Describe this asset — what it covers, when to use it, key sections…"
          maxLength={500}
          rows={4}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {metaErrors.description && <span className="kh-form-error">{metaErrors.description}</span>}
          <span className="kh-form-char-count">{metadata.description.length}/500</span>
        </div>
      </div>

      {/* Tags */}
      <div className="kh-form-field full">
        <label className="kh-form-label" htmlFor="kh-meta-tags">Tags</label>
        <div className="kh-tag-input-wrap">
          {metadata.tags.map((tag) => (
            <span key={tag} className="kh-tag-item">
              {tag}
              <button className="kh-tag-remove" onClick={() => removeTag(tag)}>
                <span>✕</span>
              </button>
            </span>
          ))}
          <input
            id="kh-meta-tags"
            className="kh-tag-text-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder={metadata.tags.length < 10 ? 'Type tag + Enter' : 'Max 10 tags'}
            disabled={metadata.tags.length >= 10}
          />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          {metadata.tags.length}/10 tags · Press Enter or comma to add
        </div>
      </div>

    </div>
  );
}
