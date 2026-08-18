import { useState, useEffect, useCallback } from 'react';
import {
  IconX, IconLoader2, IconSparkles, IconRefresh, IconAlertTriangle,
} from '@tabler/icons-react';
import * as deltasApi from '../../services/deltasApi';
import '../../styles/document-governance.css';
import '../../styles/estimates.css';

const STATUS_LABEL = {
  pending: 'Pending', running: 'Analyzing…', completed: 'Completed', failed: 'Failed',
};

function DeltaStatusDot({ status }) {
  return (
    <span className={`dg-status-dot dg-delta-${status}`}>
      <span className="dg-dot" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function fmtNumeric(d) {
  if (d.delta === null) return `${d.previous ?? '—'} → ${d.current ?? '—'}`;
  const sign = d.delta > 0 ? '+' : '';
  const pct = d.deltaPct !== null && d.deltaPct !== undefined ? ` (${d.deltaPct > 0 ? '+' : ''}${d.deltaPct}%)` : '';
  return `${d.previous} → ${d.current}  (${sign}${d.delta}${pct})`;
}

const CATEGORY_LABEL = {
  effort: 'Effort', cost: 'Cost', risk: 'Risk', roleEffort: 'Role Effort',
  roleCost: 'Role Cost', roleRate: 'Role Rate', parameter: 'Parameter',
};

/** Version-to-version AI delta — Part 15's explicit requirement: the
 * deterministic numbers and the AI's interpretation are two visually
 * distinct sections. Nothing here should let a reader think the AI
 * calculated a number — every figure in the DETERMINISTIC section comes
 * straight from deltaEngine.js; the AI ANALYSIS section is styled
 * differently (gold-tinted card) and every claim there is either tagged
 * FACT (restating a deterministic number) or INFERENCE (the model's
 * reasoning) by the backend's own schema contract. */
export function DeltaDetailModal({
  deltaId, delta: initialDelta, estimateName, onClose, onRetried,
}) {
  const [delta, setDelta] = useState(initialDelta || null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    const id = deltaId || initialDelta?.id;
    if (!id) return;
    deltasApi.getDelta(id).then(setDelta).catch((err) => setError(err.message));
  }, [deltaId, initialDelta]);

  useEffect(() => { load(); }, [load]);

  // Poll while pending/running — the analysis runs asynchronously server-side.
  useEffect(() => {
    if (!delta || (delta.status !== 'pending' && delta.status !== 'running')) return undefined;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [delta, load]);

  const handleRetry = async () => {
    setRetrying(true);
    setError('');
    try {
      const updated = await deltasApi.retryDelta(delta.id);
      setDelta(updated);
      onRetried?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  };

  const det = delta?.deterministicDelta;
  const ai = delta?.aiAnalysis;

  return (
    <div className="dg-form-overlay" onClick={onClose}>
      <div className="dg-form-modal" style={{ width: 'min(680px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="dg-form-header">
          <h3>AI Delta Analysis {estimateName ? `— ${estimateName}` : ''}</h3>
          <button className="dg-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="dg-form-body">
          {error && <div className="dg-error-banner" role="alert">{error}</div>}
          {!delta && !error && <div className="dg-loading"><IconLoader2 size={18} className="login-spinner" />Loading…</div>}

          {delta && (
            <>
              <div className="dg-form-row">
                <label>Status</label>
                <div className="dg-form-transition" style={{ justifyContent: 'space-between' }}>
                  <DeltaStatusDot status={delta.status} />
                  {delta.status === 'failed' && (
                    <button className="es-decision-btn" disabled={retrying} onClick={handleRetry}>
                      <IconRefresh size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: -2 }} />
                      {retrying ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                </div>
              </div>

              {(delta.status === 'pending' || delta.status === 'running') && (
                <div className="est-note">The AI is analyzing this version change — this updates automatically.</div>
              )}

              {delta.status === 'failed' && (
                <div className="es-feedback">
                  <IconAlertTriangle size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                  AI interpretation could not complete ({delta.errorMessage || 'unknown error'}). The deterministic numbers
                  below are still accurate — only the AI narrative is missing.
                </div>
              )}

              {det && (
                <>
                  <div className="es-delta-section-label">Deterministic — calculated by the estimator engine</div>
                  {det.changeReason && <div className="es-version-meta" style={{ marginBottom: 8 }}>Estimator&apos;s stated reason: &ldquo;{det.changeReason}&rdquo;</div>}
                  {det.numericDeltas.length === 0 && det.addedItems.length === 0 && det.removedItems.length === 0 && det.modifiedItems.length === 0 ? (
                    <div className="dg-empty" style={{ padding: 12 }}>No material differences detected between these versions.</div>
                  ) : (
                    <div className="es-version-item">
                      {det.numericDeltas.map((d, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <div className="es-delta-numeric-row" key={`${d.category}-${d.field}-${i}`}>
                          <span className="es-delta-numeric-field">{CATEGORY_LABEL[d.category] || d.category}: {d.field}</span>
                          <span className={`es-delta-numeric-value${d.delta > 0 ? ' up' : d.delta < 0 ? ' down' : ''}`}>{fmtNumeric(d)}</span>
                        </div>
                      ))}
                      {det.addedItems.map((item) => (
                        <div className="es-delta-numeric-row" key={`added-${item.name}`}>
                          <span className="es-delta-numeric-field">Added: {item.name}</span>
                          <span className="es-delta-numeric-value up">scope added</span>
                        </div>
                      ))}
                      {det.removedItems.map((item) => (
                        <div className="es-delta-numeric-row" key={`removed-${item.name}`}>
                          <span className="es-delta-numeric-field">Removed: {item.name}</span>
                          <span className="es-delta-numeric-value down">scope removed</span>
                        </div>
                      ))}
                      {det.modifiedItems.map((item) => (
                        <div className="es-delta-numeric-row" key={`modified-${item.name || item.field}`}>
                          <span className="es-delta-numeric-field">Modified: {item.name || item.field}</span>
                          <span className="es-delta-numeric-value">
                            {(item.changes || []).map((c) => `${c.field}: ${c.previous} → ${c.current}`).join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {ai && (
                <>
                  <div className="es-delta-section-label">
                    <IconSparkles size={12} strokeWidth={2} color="var(--gold)" />
                    AI Analysis — interpretation, not calculation
                  </div>
                  <div className="es-ai-card">
                    <div style={{ marginBottom: 10 }}>{ai.summary}</div>

                    <div className="es-version-meta" style={{ marginBottom: 4 }}><span className="es-ai-fact-tag">Fact</span>What changed</div>
                    <ul className="est-completeness-list">
                      {ai.key_changes.map((k) => <li key={k}>{k}</li>)}
                    </ul>

                    <div className="es-version-meta" style={{ margin: '10px 0 4px' }}><span className="es-ai-inference-tag">Inference</span>Likely drivers</div>
                    <ul className="est-completeness-list">
                      {ai.likely_drivers.map((k) => <li key={k}>{k}</li>)}
                    </ul>

                    <div className="es-version-meta" style={{ margin: '10px 0 4px' }}><span className="es-ai-inference-tag">Inference</span>Impact</div>
                    <div style={{ fontSize: 12.5 }}>{ai.impact}</div>

                    {ai.risks?.length > 0 && (
                      <>
                        <div className="es-version-meta" style={{ margin: '10px 0 4px' }}><span className="es-ai-inference-tag">Inference</span>Risks</div>
                        <ul className="est-completeness-list">
                          {ai.risks.map((k) => <li key={k} className="est-check-warn">{k}</li>)}
                        </ul>
                      </>
                    )}

                    {ai.recommendations?.length > 0 && (
                      <>
                        <div className="es-version-meta" style={{ margin: '10px 0 4px' }}><span className="es-ai-inference-tag">Inference</span>Recommendations</div>
                        <ul className="est-completeness-list">
                          {ai.recommendations.map((k) => <li key={k}>{k}</li>)}
                        </ul>
                      </>
                    )}

                    <div className="es-version-meta" style={{ marginTop: 10 }}>
                      Confidence: <strong style={{ textTransform: 'capitalize' }}>{ai.confidence}</strong>
                      {ai.scope_creep_indicated && <span className="est-check-warn" style={{ marginLeft: 10 }}>⚠ Possible scope creep</span>}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="dg-form-footer">
          <button className="dg-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
