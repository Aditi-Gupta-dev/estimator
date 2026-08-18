import { useState, useEffect, useCallback } from 'react';
import {
  IconX, IconBriefcase, IconDots, IconLoader2, IconPlayerPlay, IconPlayerPause,
  IconCheck, IconBan, IconPlus, IconSparkles,
} from '@tabler/icons-react';
import * as projectsApi from '../../services/projectsApi';
import * as deltasApi from '../../services/deltasApi';
import { useRoleContext } from '../../contexts/RoleContext';
import { DeltaDetailModal } from './DeltaDetailModal';
import '../../styles/document-governance.css';
import '../../styles/estimates.css';

const STATUS_LABEL = {
  planned: 'Planned', active: 'Active', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
};
const DELTA_STATUS_LABEL = {
  pending: 'Pending', running: 'Analyzing…', completed: 'Ready', failed: 'Failed',
};

// Client-side hint only — mirrors DocumentGovernancePanel's NEXT_ACTIONS
// pattern. The server (projectStatus.js's canTransition) is the real
// authority; a stale view attempting an illegal jump gets a clear 422 back,
// not a silent no-op.
const NEXT_ACTIONS = {
  planned: [
    { status: 'active', label: 'Start Project', Icon: IconPlayerPlay },
    { status: 'cancelled', label: 'Cancel', Icon: IconBan },
  ],
  active: [
    { status: 'on_hold', label: 'Put On Hold', Icon: IconPlayerPause },
    { status: 'completed', label: 'Mark Completed', Icon: IconCheck },
    { status: 'cancelled', label: 'Cancel', Icon: IconBan },
  ],
  on_hold: [{ status: 'active', label: 'Resume', Icon: IconPlayerPlay }],
  completed: [],
  cancelled: [],
};

function StatusDot({ status }) {
  return (
    <span className={`dg-status-dot dg-status-${status}`}>
      <span className="dg-dot" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const UPDATE_TYPES = [
  { value: 'progress', label: 'Progress' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'risk', label: 'Risk / Issue' },
  { value: 'note', label: 'Note' },
];

function AddUpdateForm({ onAdd, saving, error }) {
  const [open, setOpen] = useState(false);
  const [updateType, setUpdateType] = useState('progress');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [actualEffortDays, setActualEffortDays] = useState('');
  const [actualDurationMonths, setActualDurationMonths] = useState('');
  const [actualCost, setActualCost] = useState('');
  const [requiresEstimateReview, setRequiresEstimateReview] = useState(false);

  if (!open) {
    return (
      <button className="dg-btn-save" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>
        <IconPlus size={13} strokeWidth={2} style={{ verticalAlign: -2, marginRight: 4 }} />
        Add Update
      </button>
    );
  }

  const handleSubmit = async () => {
    const metadata = {};
    if (actualEffortDays) metadata.actualEffortDays = Number(actualEffortDays);
    if (actualDurationMonths) metadata.actualDurationMonths = Number(actualDurationMonths);
    if (actualCost) metadata.actualCost = Number(actualCost);
    const ok = await onAdd({
      updateType, title, description, requiresEstimateReview,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    });
    if (ok) {
      setTitle(''); setDescription(''); setActualEffortDays(''); setActualDurationMonths('');
      setActualCost(''); setRequiresEstimateReview(false); setOpen(false);
    }
  };

  return (
    <div className="es-version-item">
      <div className="dg-form-row">
        <label>Type</label>
        <select className="dg-select" value={updateType} onChange={(e) => setUpdateType(e.target.value)}>
          {UPDATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className="dg-form-row" style={{ marginTop: 10 }}>
        <label>Title</label>
        <input className="dg-search-input" style={{ paddingLeft: 12 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Development started" />
      </div>
      <div className="dg-form-row" style={{ marginTop: 10 }}>
        <label>Notes</label>
        <textarea className="dg-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, context…" />
      </div>
      <div className="dg-form-2col" style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <div className="dg-form-row" style={{ flex: 1 }}>
          <label>Actual Effort (days)</label>
          <input className="dg-search-input" style={{ paddingLeft: 12 }} type="number" value={actualEffortDays} onChange={(e) => setActualEffortDays(e.target.value)} />
        </div>
        <div className="dg-form-row" style={{ flex: 1 }}>
          <label>Actual Duration (months)</label>
          <input className="dg-search-input" style={{ paddingLeft: 12 }} type="number" value={actualDurationMonths} onChange={(e) => setActualDurationMonths(e.target.value)} />
        </div>
        <div className="dg-form-row" style={{ flex: 1 }}>
          <label>Actual Cost</label>
          <input className="dg-search-input" style={{ paddingLeft: 12 }} type="number" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={requiresEstimateReview} onChange={(e) => setRequiresEstimateReview(e.target.checked)} />
        This update suggests the estimate may need revision
      </label>
      {error && <div className="dg-error-banner" role="alert" style={{ margin: '10px 0 0' }}>{error}</div>}
      <div className="dg-form-footer" style={{ padding: '10px 0 0', borderTop: 'none' }}>
        <button className="dg-btn-cancel" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
        <button className="dg-btn-save" disabled={saving || !title.trim()} onClick={handleSubmit}>
          {saving ? 'Adding…' : 'Add Update'}
        </button>
      </div>
    </div>
  );
}

/** Baseline + status + updates — everything about one project. Reuses
 * dg-form-modal (widened) rather than a separate route/page, consistent
 * with EstimatesPanel's HistoryModal. */
function ProjectDetailModal({ project, onClose, onChanged }) {
  const [baseline, setBaseline] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [deltas, setDeltas] = useState(null);
  const [error, setError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [openDeltaId, setOpenDeltaId] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      projectsApi.getProjectBaseline(project.id),
      projectsApi.listProjectUpdates(project.id),
      deltasApi.listDeltasForProject(project.id).catch(() => []),
    ]).then(([b, u, d]) => { setBaseline(b); setUpdates(u); setDeltas(d); })
      .catch((err) => setError(err.message));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const handleStatus = async (status) => {
    setStatusBusy(true);
    setError('');
    try {
      await projectsApi.setProjectStatus(project.id, status);
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setStatusBusy(false);
    }
  };

  const handleAddUpdate = async (payload) => {
    setAddSaving(true);
    setAddError('');
    try {
      await projectsApi.addProjectUpdate(project.id, payload);
      load();
      return true;
    } catch (err) {
      setAddError(err.message);
      return false;
    } finally {
      setAddSaving(false);
    }
  };

  const actions = NEXT_ACTIONS[project.status] || [];

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" style={{ width: 'min(640px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <div>
            <h3>{project.name}</h3>
            <div className="dg-panel-sub">{project.projectKey} · {project.unit || 'no unit'}{project.domain ? ` · ${project.domain}` : ''}</div>
          </div>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          {error && <div className="dg-error-banner" role="alert">{error}</div>}

          <div className="dg-form-row">
            <label>Status</label>
            <div className="dg-form-transition" style={{ justifyContent: 'space-between' }}>
              <StatusDot status={project.status} />
              <div className="es-decision-row" style={{ flex: 'none' }}>
                {actions.map(({ status, label, Icon }) => (
                  <button key={status} className="es-decision-btn" disabled={statusBusy} onClick={() => handleStatus(status)}>
                    <Icon size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: -2 }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="dg-form-row">
            <label>Baseline</label>
            {!baseline ? (
              <div className="dg-loading"><IconLoader2 size={16} className="login-spinner" /></div>
            ) : (
              <div className="es-version-item">
                <div className="es-version-head">
                  <span className="es-version-tag">V{baseline.version?.version}</span>
                  <span className="es-version-meta">approved {fmtDate(baseline.approvedAt)}</span>
                </div>
                <div className="es-version-meta" style={{ marginTop: 4 }}>
                  Effort: {baseline.version?.bottomUp?.totalWithContingency?.toFixed(0) ?? '—'}d
                  {baseline.version?.bottomUp?.totalCost != null && ` · Cost: $${(baseline.version.bottomUp.totalCost / 1000).toFixed(0)}k`}
                </div>
                {baseline.currentEstimateVersionId !== baseline.baselineEstimateVersionId && (
                  <div className="es-feedback" style={{ marginTop: 8 }}>
                    A newer estimate version now exists — this project&apos;s baseline stays fixed at V{baseline.version?.version}.
                  </div>
                )}
              </div>
            )}
          </div>

          {deltas && deltas.length > 0 && (
            <div className="dg-form-row">
              <label>AI Delta History</label>
              <div className="es-version-list">
                {deltas.map((d) => (
                  <button
                    key={d.id}
                    className="dg-menu-item"
                    style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--gold)' }}
                    onClick={() => setOpenDeltaId(d.id)}
                  >
                    <IconSparkles size={13} strokeWidth={2} />
                    {DELTA_STATUS_LABEL[d.status] || d.status} — {fmtDate(d.createdAt)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dg-form-row">
            <label>Updates</label>
            {!updates ? (
              <div className="dg-loading"><IconLoader2 size={16} className="login-spinner" /></div>
            ) : (
              <div className="es-version-list">
                {updates.length === 0 && <div className="dg-empty" style={{ padding: 16 }}>No updates yet.</div>}
                {updates.map((u) => (
                  <div className="es-version-item" key={u.id}>
                    <div className="es-version-head">
                      <span className="es-version-tag" style={{ textTransform: 'capitalize' }}>{u.updateType}: {u.title}</span>
                      <span className="es-version-meta">{fmtDate(u.createdAt)}</span>
                    </div>
                    {u.description && <div className="es-version-meta" style={{ marginTop: 4 }}>{u.description}</div>}
                    {u.metadata && (
                      <div className="es-version-meta" style={{ marginTop: 4 }}>
                        {u.metadata.actualEffortDays != null && `Actual effort: ${u.metadata.actualEffortDays}d `}
                        {u.metadata.actualDurationMonths != null && `· Actual duration: ${u.metadata.actualDurationMonths}mo `}
                        {u.metadata.actualCost != null && `· Actual cost: $${u.metadata.actualCost.toLocaleString()}`}
                      </div>
                    )}
                    {u.requiresEstimateReview && (
                      <div className="es-feedback" style={{ marginTop: 8 }}>
                        Flagged as a possible estimate change signal.
                      </div>
                    )}
                  </div>
                ))}
                <AddUpdateForm onAdd={handleAddUpdate} saving={addSaving} error={addError} />
              </div>
            )}
          </div>
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>

      {openDeltaId && (
        <DeltaDetailModal
          deltaId={openDeltaId}
          estimateName={project.name}
          onClose={() => setOpenDeltaId(null)}
          onRetried={() => deltasApi.listDeltasForProject(project.id).then(setDeltas).catch(() => {})}
        />
      )}
    </div>
  );
}

export function ProjectsPanel({ onClose }) {
  const { user } = useRoleContext();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailTarget, setDetailTarget] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setProjects(await projectsApi.listProjects());
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="dg-backdrop" onClick={onClose} />
      <aside className="dg-panel" aria-label="Projects">
        <div className="dg-panel-header">
          <div className="dg-panel-title">
            <div className="dg-panel-icon"><IconBriefcase size={18} strokeWidth={2} /></div>
            <div>
              <div className="dg-panel-name">Projects</div>
              <div className="dg-panel-sub">{projects.length} total · signed in as {user?.name}</div>
            </div>
          </div>
          <button className="dg-close-btn" onClick={onClose} aria-label="Close panel"><IconX size={18} /></button>
        </div>

        {error && <div className="dg-error-banner" role="alert">{error}</div>}

        <div className="dg-table-wrapper">
          {isLoading ? (
            <div className="dg-loading"><IconLoader2 size={20} className="login-spinner" strokeWidth={2} />Loading…</div>
          ) : (
            <table className="dg-table">
              <thead>
                <tr><th>Project</th><th>Baseline Estimate</th><th>Status</th><th>Unit / Domain</th><th>Updated</th><th></th></tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr><td colSpan={6} className="dg-empty">No projects yet — create one from an approved estimate.</td></tr>
                ) : (
                  projects.map((p) => (
                    <tr key={p.id} className="dg-row">
                      <td>
                        <div className="dg-doc-title">{p.name}</div>
                        <div className="dg-doc-meta">{p.projectKey}</div>
                      </td>
                      <td className="dg-doc-meta">{p.estimateId.slice(0, 8)}…</td>
                      <td><StatusDot status={p.status} /></td>
                      <td className="dg-doc-meta">{p.unit || '—'}{p.domain ? ` / ${p.domain}` : ''}</td>
                      <td className="dg-doc-meta">{fmtDate(p.updatedAt)}</td>
                      <td>
                        <div className="dg-actions-cell">
                          <button className="dg-menu-btn" onClick={() => setDetailTarget(p)} aria-label="Open project">
                            <IconDots size={15} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </aside>

      {detailTarget && (
        <ProjectDetailModal
          project={detailTarget}
          onClose={() => setDetailTarget(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
