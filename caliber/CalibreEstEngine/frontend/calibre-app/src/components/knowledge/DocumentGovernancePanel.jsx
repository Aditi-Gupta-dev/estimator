import { useState, useEffect, useCallback } from 'react';
import {
  IconX, IconFiles, IconSearch, IconDots, IconLoader2, IconFilter,
  IconEye, IconEyeOff, IconArchive, IconRotate, IconBan, IconTag,
  IconShieldLock, IconFileCheck, IconAlertTriangle,
} from '@tabler/icons-react';
import * as documentsApi from '../../services/documentsApi';
import { useRoleContext } from '../../contexts/RoleContext';
import '../../styles/document-governance.css';

/* Mirrors storage/document_status.py's transition table — client-side only
   to decide which buttons make sense to show. The server (can_transition)
   is the actual authority; an attempt against a stale view still comes back
   as a clear rejection, not a silent no-op. */
const NEXT_ACTIONS = {
  draft: [
    { status: 'in_review', label: 'Send to Review', Icon: IconEye },
    { status: 'published', label: 'Publish', Icon: IconFileCheck },
    { status: 'rejected', label: 'Reject', Icon: IconBan },
  ],
  in_review: [
    { status: 'published', label: 'Publish', Icon: IconFileCheck },
    { status: 'rejected', label: 'Reject', Icon: IconBan },
    { status: 'draft', label: 'Return to Draft', Icon: IconEyeOff },
  ],
  published: [
    { status: 'archived', label: 'Archive', Icon: IconArchive },
    { status: 'draft', label: 'Unpublish', Icon: IconEyeOff },
  ],
  archived: [{ status: 'draft', label: 'Restore to Draft', Icon: IconRotate }],
  rejected: [{ status: 'draft', label: 'Restore to Draft', Icon: IconRotate }],
};

const STATUS_LABEL = {
  draft: 'Draft', in_review: 'In Review', published: 'Published',
  archived: 'Archived', rejected: 'Rejected',
};
const STATUSES = ['all', 'draft', 'in_review', 'published', 'archived', 'rejected'];
const SENSITIVITY_LEVELS = ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'RATE_CARD'];

function StatusDot({ status }) {
  return (
    <span className={`dg-status-dot dg-status-${status}`}>
      <span className="dg-dot" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function SensitivityBadge({ sensitivity }) {
  const s = sensitivity || 'INTERNAL';
  return <span className={`dg-sens-badge dg-sens-${s.toLowerCase()}`}>{s.replace('_', ' ')}</span>;
}

/* ── Confirm-and-reason modal — every mutation goes through this, not a bare
   click. Rate-card publish/reclassify require a non-empty reason; everything
   else's reason is optional but always recorded to the governance audit
   trail (GovernanceEvent) on the server. */
function ActionModal({ doc, action, onClose, onConfirm, saving, error }) {
  const isReclassify = action.kind === 'reclassify';
  const [reason, setReason] = useState('');
  const [sensitivity, setSensitivity] = useState(doc.sensitivity || 'INTERNAL');

  const isRateCardMove = doc.sensitivity === 'RATE_CARD' || (isReclassify && sensitivity === 'RATE_CARD');
  const reasonRequired = isRateCardMove;

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>{isReclassify ? 'Reclassify Sensitivity' : action.label}</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          <div className="dg-form-row">
            <label>Document</label>
            <div className="dg-form-doc-title">{doc.title}</div>
          </div>

          {isReclassify ? (
            <div className="dg-form-row">
              <label>New Sensitivity</label>
              <select className="dg-select" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
                {SENSITIVITY_LEVELS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          ) : (
            <div className="dg-form-row">
              <label>Change</label>
              <div className="dg-form-transition">
                <StatusDot status={doc.status} /> <span>&rarr;</span> <StatusDot status={action.status} />
              </div>
            </div>
          )}

          {isRateCardMove && (
            <div className="dg-warning-note">
              <IconShieldLock size={13} strokeWidth={2} />
              Rate-card content — this requires an explicit reason before it can proceed.
            </div>
          )}

          <div className="dg-form-row">
            <label>Reason {reasonRequired ? '(required)' : '(optional)'}</label>
            <textarea
              className="dg-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change being made?"
              rows={3}
            />
          </div>

          {error && <div className="dg-error-banner" role="alert">{error}</div>}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="dg-btn-save"
            disabled={saving || (reasonRequired && !reason.trim())}
            onClick={() => onConfirm(isReclassify ? { sensitivity, reason } : { status: action.status, reason })}
          >
            {saving ? 'Applying…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiStrip({ audit }) {
  if (!audit) return null;
  const { metrics, orphansOnDisk, duplicateGroups } = audit;
  const d = metrics.documents;
  return (
    <div className="dg-kpi-grid">
      <div className="dg-kpi">
        <div className="dg-kpi-label">Documents</div>
        <div className="dg-kpi-value">{d.total}</div>
        <div className="dg-kpi-sub">{d.published} published · {d.draft} draft</div>
      </div>
      <div className="dg-kpi">
        <div className="dg-kpi-label">Chunks Retrievable</div>
        <div className="dg-kpi-value">{metrics.retrievability_pct}%</div>
        <div className="dg-kpi-sub">{metrics.chunks.retrievable} / {metrics.chunks.total}</div>
      </div>
      <div className="dg-kpi">
        <div className="dg-kpi-label">Files With No Record</div>
        <div className="dg-kpi-value">{orphansOnDisk.length}</div>
        <div className="dg-kpi-sub">on disk, never ingested</div>
      </div>
      <div className="dg-kpi">
        <div className="dg-kpi-label">Duplicate Groups</div>
        <div className="dg-kpi-value">{duplicateGroups.length}</div>
        <div className="dg-kpi-sub">identical content, different paths</div>
      </div>
    </div>
  );
}

export function DocumentGovernancePanel({ onClose }) {
  const { user } = useRoleContext();
  const [documents, setDocuments] = useState([]);
  const [audit, setAudit] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { doc, action: {kind, status?, label} }
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [docs, auditData] = await Promise.all([
        documentsApi.listDocuments(),
        documentsApi.getKnowledgeAudit(),
      ]);
      setDocuments(docs);
      setAudit(auditData);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = documents.filter((d) => {
    const matchSearch = !search || d.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || d.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const openAction = (doc, action) => {
    setMenuOpenId(null);
    setModalError('');
    setPendingAction({ doc, action });
  };

  const handleConfirm = async (payload) => {
    setSaving(true);
    setModalError('');
    try {
      await documentsApi.patchDocument(pendingAction.doc.id, {
        ...payload,
        // Reason is user-supplied evidence, not identity — actor is always
        // the verified session, overwritten server-side regardless of what
        // this request contains (see upload-server's PATCH proxy).
      });
      await load();
      setPendingAction(null);
    } catch (err) {
      // Surfaces the server's real rejection (e.g. an invalid transition)
      // rather than a generic failure — this is exactly what the transition
      // guard in document_status.py is for.
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dg-backdrop" onClick={onClose} />
      <aside className="dg-panel" aria-label="Knowledge Hub Document Governance">
        <div className="dg-panel-header">
          <div className="dg-panel-title">
            <div className="dg-panel-icon"><IconFiles size={18} strokeWidth={2} /></div>
            <div>
              <div className="dg-panel-name">Manage Documents</div>
              <div className="dg-panel-sub">{documents.length} total · signed in as {user?.name}</div>
            </div>
          </div>
          <button className="dg-close-btn" onClick={onClose} aria-label="Close panel">
            <IconX size={18} />
          </button>
        </div>

        <div className="dg-kpi-strip-wrap">
          <KpiStrip audit={audit} />
        </div>

        <div className="dg-toolbar">
          <div className="dg-search-box">
            <IconSearch size={14} className="dg-search-icon" strokeWidth={2} />
            <input
              className="dg-search-input"
              placeholder="Search title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="dg-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All Statuses' : STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div className="dg-result-count">
          <IconFilter size={12} strokeWidth={2} />
          {filtered.length} document{filtered.length !== 1 ? 's' : ''} shown
        </div>

        {error && <div className="dg-error-banner" role="alert">{error}</div>}

        <div className="dg-table-wrapper">
          {isLoading ? (
            <div className="dg-loading">
              <IconLoader2 size={20} strokeWidth={2} className="login-spinner" />
              Loading documents…
            </div>
          ) : (
            <table className="dg-table">
              <thead>
                <tr>
                  <th>Document</th><th>Status</th><th>Sensitivity</th>
                  <th>Chunks</th><th>Recommended</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="dg-empty">No documents match your filters.</td></tr>
                ) : (
                  filtered.map((doc) => {
                    const actions = NEXT_ACTIONS[doc.status] || [];
                    return (
                      <tr key={doc.id} className="dg-row">
                        <td>
                          <div className="dg-doc-cell">
                            <div className="dg-doc-title">{doc.title}</div>
                            <div className="dg-doc-meta">
                              {doc.documentClass} · {doc.buFolder}
                              {!doc.hasSidecarMetadata && ' · no metadata'}
                              {!doc.onDisk && ' · file missing'}
                            </div>
                          </div>
                        </td>
                        <td><StatusDot status={doc.status} /></td>
                        <td><SensitivityBadge sensitivity={doc.sensitivity} /></td>
                        <td className="dg-chunk-count">{doc.chunkCount}</td>
                        <td>
                          <span className={`dg-recommend${doc.recommendedAction.startsWith('Restricted') ? ' dg-recommend-warn' : ''}`}>
                            {doc.issues.length > 0 && <IconAlertTriangle size={11} strokeWidth={2} />}
                            {doc.recommendedAction}
                          </span>
                        </td>
                        <td>
                          <div className="dg-actions-cell">
                            <div className="dg-menu-wrapper">
                              <button
                                className="dg-menu-btn"
                                onClick={() => setMenuOpenId(menuOpenId === doc.id ? null : doc.id)}
                                aria-label="Document actions"
                              >
                                <IconDots size={15} strokeWidth={2} />
                              </button>
                              {menuOpenId === doc.id && (
                                <div className="dg-menu">
                                  {actions.map(({ status, label, Icon }) => (
                                    <button
                                      key={status}
                                      className="dg-menu-item"
                                      onClick={() => openAction(doc, {
                                        kind: 'transition', status,
                                        label: (status === 'published' && doc.sensitivity === 'RATE_CARD')
                                          ? 'Approve & Publish (Rate Card)' : label,
                                      })}
                                    >
                                      <Icon size={13} strokeWidth={2} /> {label}
                                    </button>
                                  ))}
                                  <div className="dg-menu-divider" />
                                  <button
                                    className="dg-menu-item"
                                    onClick={() => openAction(doc, { kind: 'reclassify', label: 'Reclassify Sensitivity' })}
                                  >
                                    <IconTag size={13} strokeWidth={2} /> Reclassify Sensitivity
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </aside>

      {pendingAction && (
        <ActionModal
          doc={pendingAction.doc}
          action={pendingAction.action}
          onClose={() => setPendingAction(null)}
          onConfirm={handleConfirm}
          saving={saving}
          error={modalError}
        />
      )}
    </>
  );
}
