import { useState } from 'react';
import { IconSend, IconCircleCheck } from '@tabler/icons-react';
import * as estimatesApi from '../../services/estimatesApi';
import '../../styles/document-governance.css';

/** Phase 4 Part 16 — the real "Revise Estimate" flow: shown instead of
 * SaveEstimateCard when the wizard was opened to revise a specific
 * CHANGES_REQUESTED estimate (reviseEstimateId set). Submits the edited
 * inputs as a brand-new immutable version of the SAME estimate — never a
 * new estimate — via the existing resubmitEstimate() endpoint. */
export function SubmitRevisionCard({
  reviseEstimateId, reviseEstimateName, currentVersion, industry, overallComplexity, sectionA, overrides, onSubmitted,
}) {
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const estimate = await estimatesApi.resubmitEstimate(reviseEstimateId, {
        inputs: {
          industry, overallComplexity, sectionA, overrides,
        },
        changeReason,
      });
      setSubmitted(estimate);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconCircleCheck size={18} color="var(--green)" />
          Revision Submitted
        </h2>
        <div className="est-note">
          &quot;{reviseEstimateName}&quot; V{submitted.currentVersion} was created and resubmitted for review.
          The previous version remains available in its history, unchanged.
        </div>
        <button className="est-run-btn" style={{ marginTop: 10 }} onClick={() => onSubmitted?.(submitted)}>
          Open My Estimates →
        </button>
      </div>
    );
  }

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconSend size={18} color="var(--gold)" />
        Revise &amp; Resubmit — {reviseEstimateName}
      </h2>
      <div className="est-note" style={{ marginBottom: 10 }}>
        You&apos;re editing V{currentVersion}, which the reviewer sent back with feedback. Submitting here creates
        a new version (V{currentVersion + 1}) of this same estimate — the current version stays untouched — and
        sends it back for review.
      </div>
      <div className="dg-form-row">
        <label>What changed? (required)</label>
        <textarea
          className="dg-textarea"
          rows={3}
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          placeholder="Describe how you addressed the reviewer's feedback…"
        />
      </div>
      <button className="est-run-btn" style={{ marginTop: 10 }} disabled={saving || !changeReason.trim()} onClick={handleSubmit}>
        {saving ? 'Submitting…' : 'Submit Revision for Review'}
      </button>
      {error && <div className="dg-error-banner" role="alert" style={{ margin: '10px 0 0' }}>{error}</div>}
    </div>
  );
}
