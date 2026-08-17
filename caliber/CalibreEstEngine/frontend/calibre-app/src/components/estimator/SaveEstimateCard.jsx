import { useState } from 'react';
import { IconDeviceFloppy, IconCircleCheck } from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';
import * as estimatesApi from '../../services/estimatesApi';

/** The one missing wire between the already-authoritative compute pipeline
 * (this page's `result`) and the already-built persistence layer
 * (estimatesApi.createEstimate) — without it, "Submit for Review" has
 * nothing to submit. Saves a DRAFT; review/approval happens afterward from
 * the My Estimates panel, not here. */
export function SaveEstimateCard({
  industry, overallComplexity, sectionA, overrides, onSaved, onOpenMyEstimates,
}) {
  const { user, can } = useRoleContext();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  if (!can(CAPABILITIES.ESTIMATE_SAVE)) return null;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const estimate = await estimatesApi.createEstimate({
        name: name.trim() || 'Untitled estimate',
        businessUnit: user?.unit || null,
        inputs: {
          industry, overallComplexity, sectionA, overrides,
        },
      });
      setSaved(estimate);
      onSaved?.(estimate);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconCircleCheck size={18} color="var(--green)" />
          Saved as Draft
        </h2>
        <div className="est-note">
          &quot;{saved.name}&quot; was saved (v{saved.currentVersion}). Submit it for review, ping the
          reviewer, and track feedback from the My Estimates panel.
        </div>
        <button className="est-run-btn" style={{ marginTop: 10 }} onClick={() => onOpenMyEstimates?.()}>
          Open My Estimates →
        </button>
      </div>
    );
  }

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconDeviceFloppy size={18} color="var(--gold)" />
        Save This Estimate
      </h2>
      <div className="est-note" style={{ marginBottom: 10 }}>
        Save this run so it can be submitted for review and tracked through approval.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="dg-search-input"
          style={{ maxWidth: 320, paddingLeft: 12 }}
          placeholder="Estimate name (e.g. Acme Corp — Fusion HCM)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="est-run-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save as Draft'}
        </button>
      </div>
      {error && <div className="dg-error-banner" role="alert" style={{ margin: '10px 0 0' }}>{error}</div>}
    </div>
  );
}
