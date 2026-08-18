import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  IconX, IconClipboardList, IconDots, IconLoader2, IconFilter, IconSend,
  IconBellRinging, IconUserPlus, IconHistory, IconPlayerPlay, IconCheck,
  IconBan, IconMessageCircle2, IconBriefcase, IconEdit, IconSparkles,
} from '@tabler/icons-react';
import * as estimatesApi from '../../services/estimatesApi';
import * as authApi from '../../services/authApi';
import * as projectsApi from '../../services/projectsApi';
import * as deltasApi from '../../services/deltasApi';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';
import { DeltaDetailModal } from './DeltaDetailModal';
import '../../styles/document-governance.css';
import '../../styles/estimates.css';

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
};
const MINE_STATUSES = ['all', 'draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected'];
const DECISIONS = [
  { value: 'approved', label: 'Approve', Icon: IconCheck, cls: 'approve' },
  { value: 'changes_requested', label: 'Request Changes', Icon: IconMessageCircle2, cls: 'changes' },
  { value: 'rejected', label: 'Reject', Icon: IconBan, cls: 'reject' },
];

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

const DELTA_STATUS_LABEL = {
  pending: 'AI analysis pending', running: 'AI analyzing…', completed: 'AI delta ready', failed: 'AI analysis failed',
};

/* ── Version history + review trail modal — read-only, no editing of an
   old version is even possible since nothing here writes anything. */
function HistoryModal({ estimateId, name, onClose }) {
  const [versions, setVersions] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [deltas, setDeltas] = useState([]);
  const [error, setError] = useState('');
  const [openDeltaId, setOpenDeltaId] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      estimatesApi.getEstimateHistory(estimateId),
      estimatesApi.listReviews(estimateId).catch(() => []), // may 403 for a non-reviewer bystander; history alone still renders
      deltasApi.listDeltasForEstimate(estimateId).catch(() => []),
    ]).then(([v, r, d]) => { if (alive) { setVersions(v); setReviews(r); setDeltas(d); } })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [estimateId]);

  const reviewsByVersionId = useMemo(() => {
    const map = {};
    reviews.forEach((r) => { (map[r.versionId] ||= []).push(r); });
    return map;
  }, [reviews]);

  const deltaByCurrentVersionId = useMemo(() => {
    const map = {};
    deltas.forEach((d) => { map[d.currentVersionId] = d; });
    return map;
  }, [deltas]);

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" style={{ width: 'min(600px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>Version History — {name}</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          {error && <div className="dg-error-banner" role="alert">{error}</div>}
          {!versions && !error && <div className="dg-loading"><IconLoader2 size={18} className="login-spinner" />Loading…</div>}
          {versions && (
            <div className="es-version-list">
              {versions.map((v) => (
                <div className="es-version-item" key={v.id}>
                  <div className="es-version-head">
                    <span className="es-version-tag">V{v.version}</span>
                    <span className="es-version-meta">saved {fmtDate(v.createdAt)}</span>
                  </div>
                  {v.changeReason && <div className="es-version-meta" style={{ marginTop: 4 }}>Change reason: {v.changeReason}</div>}
                  {(reviewsByVersionId[v.id] || []).map((r) => (
                    <div className="es-review-row" key={r.id}>
                      <StatusDot status={r.decision} /> — {fmtDate(r.createdAt)}
                      {r.comments && <div style={{ marginTop: 3 }}>&ldquo;{r.comments}&rdquo;</div>}
                    </div>
                  ))}
                  {deltaByCurrentVersionId[v.id] && (
                    <div className="es-review-row">
                      <button
                        className="dg-menu-item"
                        style={{ padding: '4px 0', color: 'var(--gold)' }}
                        onClick={() => setOpenDeltaId(deltaByCurrentVersionId[v.id].id)}
                      >
                        <IconSparkles size={13} strokeWidth={2} />
                        {DELTA_STATUS_LABEL[deltaByCurrentVersionId[v.id].status]} — View AI Delta (vs V{v.version - 1})
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>

      {openDeltaId && (
        <DeltaDetailModal
          deltaId={openDeltaId}
          estimateName={name}
          onClose={() => setOpenDeltaId(null)}
          onRetried={() => deltasApi.listDeltasForEstimate(estimateId).then(setDeltas).catch(() => {})}
        />
      )}
    </div>
  );
}

/* ── Create Project modal (approved estimate -> project baseline) ───────── */
function CreateProjectModal({ estimate, onClose, onDone }) {
  const [name, setName] = useState(`${estimate.name} — Project`);
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const { project, created } = await projectsApi.createProjectFromEstimate(estimate.id, {
        name, description, domain,
      });
      setResult({ project, created });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="dg-form-overlay" onClick={onClose}>
        <div className="dg-form-modal" onClick={(e) => e.stopPropagation()}>
          <div className="dg-form-header">
            <h3>{result.created ? 'Project Created' : 'Project Already Exists'}</h3>
            <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
          </div>
          <div className="dg-form-body">
            <div className="est-note">
              {result.created
                ? `"${result.project.projectKey}" was created with baseline V${estimate.currentVersion}.`
                : `An active project ("${result.project.projectKey}") already exists for this estimate.`}
            </div>
          </div>
          <div className="dg-form-footer">
            <button className="dg-btn-save" onClick={() => onDone(result.project)}>Open Projects →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>Create Project</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          <div className="dg-form-row">
            <label>Baseline Estimate</label>
            <div className="dg-form-doc-title">{estimate.name} — V{estimate.currentVersion} (approved)</div>
          </div>
          <div className="dg-form-row">
            <label>Project Name</label>
            <input className="dg-search-input" style={{ paddingLeft: 12 }} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="dg-form-row">
            <label>Description</label>
            <textarea className="dg-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="dg-form-row">
            <label>Domain</label>
            <input className="dg-search-input" style={{ paddingLeft: 12 }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Oracle Fusion ERP" />
          </div>
          {error && <div className="dg-error-banner" role="alert">{error}</div>}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="dg-btn-save" disabled={saving || !name.trim()} onClick={handleConfirm}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Reviewer-decision modal (Approve / Reject / Request Changes) ───────── */
function DecisionModal({ estimate, onClose, onDone }) {
  const [decision, setDecision] = useState(null);
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const requiresComment = decision === 'rejected' || decision === 'changes_requested';

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      await estimatesApi.decideReview(estimate.id, {
        decision, comments: comments.trim() || undefined, reviewedVersion: estimate.currentVersion,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>Review Decision</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          <div className="dg-form-row">
            <label>Estimate</label>
            <div className="dg-form-doc-title">{estimate.name} — V{estimate.currentVersion}</div>
          </div>
          <div className="dg-form-row">
            <label>Decision</label>
            <div className="es-decision-row">
              {DECISIONS.map(({ value, label, Icon, cls }) => (
                <button
                  key={value}
                  className={`es-decision-btn${decision === value ? ` selected ${cls}` : ''}`}
                  onClick={() => setDecision(value)}
                >
                  <Icon size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: -2 }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="dg-form-row">
            <label>Comments {requiresComment ? '(required)' : '(optional)'}</label>
            <textarea
              className="dg-textarea"
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={requiresComment ? 'Explain what needs to change…' : 'Optional note to the estimator…'}
            />
          </div>
          {error && <div className="dg-error-banner" role="alert">{error}</div>}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="dg-btn-save"
            disabled={saving || !decision || (requiresComment && !comments.trim())}
            onClick={handleConfirm}
          >
            {saving ? 'Submitting…' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Assign-reviewer modal (admin only) ──────────────────────────────────── */
function AssignReviewerModal({ estimate, reviewers, onClose, onDone }) {
  const [reviewerUserId, setReviewerUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const eligible = reviewers.filter((u) => u.status === 'active' && (u.role === 'admin' || u.role === 'super'));

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      await estimatesApi.assignReviewer(estimate.id, reviewerUserId);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>Assign Reviewer</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          <div className="dg-form-row">
            <label>Estimate</label>
            <div className="dg-form-doc-title">{estimate.name} ({estimate.businessUnit || 'no unit'})</div>
          </div>
          <div className="dg-form-row">
            <label>Reviewer</label>
            <select className="dg-select" value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)}>
              <option value="">Select a reviewer…</option>
              {eligible.map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {u.role} ({u.unit || 'no unit'})</option>
              ))}
            </select>
          </div>
          <div className="est-note">Reviewers outside this estimate&apos;s business unit will be rejected server-side.</div>
          {error && <div className="dg-error-banner" role="alert">{error}</div>}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="dg-btn-save" disabled={saving || !reviewerUserId} onClick={handleConfirm}>
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────────────── */
export function EstimatesPanel({
  onClose, initialTab = 'mine', onOpenProjects, onReviseEstimate,
}) {
  const { user, can } = useRoleContext();
  const canApprove = can(CAPABILITIES.ESTIMATE_APPROVE);
  const canAssign = can(CAPABILITIES.REVIEWER_ASSIGN);
  const canCreateProject = can(CAPABILITIES.PROJECT_CREATE);

  const [tab, setTab] = useState(initialTab === 'queue' && canApprove ? 'queue' : 'mine');
  const [mine, setMine] = useState([]);
  const [queue, setQueue] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [createProjectTarget, setCreateProjectTarget] = useState(null);
  const [decisionTarget, setDecisionTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const tasks = [estimatesApi.listEstimates()];
      if (canApprove) tasks.push(estimatesApi.listReviewQueue());
      if (canAssign) tasks.push(authApi.listUsers());
      const results = await Promise.all(tasks);
      setMine(results[0]);
      let i = 1;
      if (canApprove) { setQueue(results[i]); i += 1; }
      if (canAssign) { setUsers(results[i]); i += 1; }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [canApprove, canAssign]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (id, fn) => {
    setMenuOpenId(null);
    setBusyId(id);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const filteredMine = mine.filter((e) => filterStatus === 'all' || e.status === filterStatus);

  return (
    <>
      <div className="dg-backdrop" onClick={onClose} />
      <aside className="dg-panel" aria-label="Estimate Review & Approval">
        <div className="dg-panel-header">
          <div className="dg-panel-title">
            <div className="dg-panel-icon"><IconClipboardList size={18} strokeWidth={2} /></div>
            <div>
              <div className="dg-panel-name">Estimates &amp; Reviews</div>
              <div className="dg-panel-sub">signed in as {user?.name}</div>
            </div>
          </div>
          <button className="dg-close-btn" onClick={onClose} aria-label="Close panel"><IconX size={18} /></button>
        </div>

        <div className="es-tabs">
          <button className={`es-tab${tab === 'mine' ? ' active' : ''}`} onClick={() => setTab('mine')}>
            My Estimates {mine.length > 0 && `(${mine.length})`}
          </button>
          {canApprove && (
            <button className={`es-tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
              Review Queue {queue.length > 0 && `(${queue.length})`}
            </button>
          )}
        </div>

        {error && <div className="dg-error-banner" role="alert">{error}</div>}

        <div className="dg-table-wrapper">
          {isLoading ? (
            <div className="dg-loading"><IconLoader2 size={20} className="login-spinner" strokeWidth={2} />Loading…</div>
          ) : tab === 'mine' ? (
            <>
              <div className="dg-toolbar" style={{ padding: '0 0 12px' }}>
                <select className="dg-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  {MINE_STATUSES.map((s) => (
                    <option key={s} value={s}>{s === 'all' ? 'All Statuses' : STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <div className="dg-result-count">
                  <IconFilter size={12} strokeWidth={2} />
                  {filteredMine.length} shown
                </div>
              </div>
              <table className="dg-table">
                <thead>
                  <tr><th>Estimate</th><th>Status</th><th>Version</th><th>Updated</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredMine.length === 0 ? (
                    <tr><td colSpan={5} className="dg-empty">No estimates yet — save one from the estimator.</td></tr>
                  ) : (
                    filteredMine.map((e) => (
                      <tr key={e.id} className="dg-row">
                        <td>
                          <div className="dg-doc-title">{e.name}</div>
                          <div className="dg-doc-meta">{e.businessUnit || 'no unit'}{e.ownerUserId !== user.id ? ' · not your own' : ''}</div>
                        </td>
                        <td><StatusDot status={e.status} /></td>
                        <td className="dg-chunk-count">V{e.currentVersion}</td>
                        <td className="dg-doc-meta">{fmtDate(e.updatedAt)}</td>
                        <td>
                          <div className="dg-actions-cell">
                            <div className="dg-menu-wrapper">
                              <button
                                className="dg-menu-btn"
                                onClick={() => setMenuOpenId(menuOpenId === e.id ? null : e.id)}
                                aria-label="Estimate actions"
                                disabled={busyId === e.id}
                              >
                                {busyId === e.id ? <IconLoader2 size={15} className="login-spinner" /> : <IconDots size={15} strokeWidth={2} />}
                              </button>
                              {menuOpenId === e.id && (
                                <div className="dg-menu">
                                  {e.status === 'draft' && e.ownerUserId === user.id && (
                                    <button className="dg-menu-item" onClick={() => runAction(e.id, () => estimatesApi.submitEstimate(e.id))}>
                                      <IconSend size={13} strokeWidth={2} /> Submit for Review
                                    </button>
                                  )}
                                  {e.status === 'changes_requested' && e.ownerUserId === user.id && (
                                    <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); onReviseEstimate?.(e.id); }}>
                                      <IconEdit size={13} strokeWidth={2} /> Revise Estimate
                                    </button>
                                  )}
                                  {(e.status === 'submitted' || e.status === 'under_review') && e.ownerUserId === user.id && (
                                    <button className="dg-menu-item" onClick={() => runAction(e.id, () => estimatesApi.pingReviewer(e.id))}>
                                      <IconBellRinging size={13} strokeWidth={2} /> Ping Reviewer
                                    </button>
                                  )}
                                  {canAssign && (e.status === 'submitted' || e.status === 'under_review') && (
                                    <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); setAssignTarget(e); }}>
                                      <IconUserPlus size={13} strokeWidth={2} /> Assign Reviewer
                                    </button>
                                  )}
                                  {e.status === 'approved' && canCreateProject && (
                                    <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); setCreateProjectTarget(e); }}>
                                      <IconBriefcase size={13} strokeWidth={2} /> Create Project
                                    </button>
                                  )}
                                  <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); setHistoryTarget(e); }}>
                                    <IconHistory size={13} strokeWidth={2} /> Version History
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <table className="dg-table">
              <thead>
                <tr><th>Estimate</th><th>Status</th><th>Assignment</th><th>Assigned</th><th></th></tr>
              </thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr><td colSpan={5} className="dg-empty">No estimates assigned to you.</td></tr>
                ) : (
                  queue.map(({ assignment, estimate: e }) => (
                    e && (
                      <tr key={assignment.id} className="dg-row">
                        <td>
                          <div className="dg-doc-title">{e.name}</div>
                          <div className="dg-doc-meta">{e.businessUnit || 'no unit'} · V{e.currentVersion}</div>
                        </td>
                        <td><StatusDot status={e.status} /></td>
                        <td className="dg-doc-meta" style={{ textTransform: 'capitalize' }}>{assignment.status.replace('_', ' ')}</td>
                        <td className="dg-doc-meta">{fmtDate(assignment.assignedAt)}</td>
                        <td>
                          <div className="dg-actions-cell">
                            <div className="dg-menu-wrapper">
                              <button
                                className="dg-menu-btn"
                                onClick={() => setMenuOpenId(menuOpenId === assignment.id ? null : assignment.id)}
                                aria-label="Review actions"
                                disabled={busyId === e.id}
                              >
                                {busyId === e.id ? <IconLoader2 size={15} className="login-spinner" /> : <IconDots size={15} strokeWidth={2} />}
                              </button>
                              {menuOpenId === assignment.id && (
                                <div className="dg-menu">
                                  {assignment.status === 'assigned' && e.status === 'submitted' && (
                                    <button className="dg-menu-item" onClick={() => runAction(e.id, () => estimatesApi.startReview(e.id))}>
                                      <IconPlayerPlay size={13} strokeWidth={2} /> Start Review
                                    </button>
                                  )}
                                  {assignment.status === 'in_review' && e.status === 'under_review' && (
                                    <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); setDecisionTarget(e); }}>
                                      <IconCheck size={13} strokeWidth={2} /> Decide (Approve / Reject / Changes)
                                    </button>
                                  )}
                                  <button className="dg-menu-item" onClick={() => { setMenuOpenId(null); setHistoryTarget(e); }}>
                                    <IconHistory size={13} strokeWidth={2} /> Version History
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </aside>

      {historyTarget && (
        <HistoryModal estimateId={historyTarget.id} name={historyTarget.name} onClose={() => setHistoryTarget(null)} />
      )}
      {createProjectTarget && (
        <CreateProjectModal
          estimate={createProjectTarget}
          onClose={() => setCreateProjectTarget(null)}
          onDone={() => { setCreateProjectTarget(null); onOpenProjects?.(); }}
        />
      )}
      {decisionTarget && (
        <DecisionModal
          estimate={decisionTarget}
          onClose={() => setDecisionTarget(null)}
          onDone={() => { setDecisionTarget(null); load(); }}
        />
      )}
      {assignTarget && (
        <AssignReviewerModal
          estimate={assignTarget}
          reviewers={users}
          onClose={() => setAssignTarget(null)}
          onDone={() => { setAssignTarget(null); load(); }}
        />
      )}
    </>
  );
}
