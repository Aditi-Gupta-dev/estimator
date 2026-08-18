import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconUsers, IconDatabase, IconCpu, IconServer, IconInfoCircle, IconGauge,
} from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { useEstimatorContext } from '../../contexts/EstimatorContextProvider';
import { dashboardFor } from '../../constants/dashboards';
import { CAPABILITIES } from '../../constants/capabilities';

const SYSTEM_URL = 'http://localhost:3001/api/system/overview';

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
const fmtMoney = (n) => (typeof n === 'number' ? `$${Math.round(n / 1000).toLocaleString()}k` : '—');

/** Reuses the estimator's KPI vocabulary so dashboards look native to Calibre
 *  rather than introducing a fourth tile style. */
function Kpi({ label, value, sub }) {
  return (
    <div className="est-kpi">
      <div className="est-kpi-label">{label}</div>
      <div className="est-kpi-value">{value}</div>
      {sub && <div className="est-kpi-sub">{sub}</div>}
    </div>
  );
}

/** States a capability the product genuinely lacks, instead of showing a
 *  plausible-looking zero or an invented number. */
function UnavailableNote({ label, reason }) {
  return (
    <div className="dash-unavailable">
      <IconInfoCircle size={14} />
      <div>
        <strong>{label}</strong>
        <div className="est-note">{reason}</div>
      </div>
    </div>
  );
}

// ── Admin: real platform data from the gateway ──────────────────────────────
function SystemOverviewSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(SYSTEM_URL, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div className="est-chart-card">
        <h2 className="est-section-h2"><IconServer size={18} color="var(--gold)" />Platform</h2>
        <div className="est-note">Couldn&apos;t load platform data ({error}). Is the gateway running?</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="est-chart-card">
        <h2 className="est-section-h2"><IconServer size={18} color="var(--gold)" />Platform</h2>
        <div className="est-note">Loading platform data…</div>
      </div>
    );
  }

  const { users, knowledgeHub, services, modelMetrics } = data;
  const roleLine = Object.entries(users.byRole || {})
    .map(([r, n]) => `${r}: ${n}`).join(' · ');
  const uc1 = modelMetrics?.uc1 || modelMetrics?.UC1 || null;
  const uc2 = modelMetrics?.uc2 || modelMetrics?.UC2 || null;

  return (
    <>
      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconUsers size={18} color="var(--gold)" />
          Platform
          <span className="est-tag est-tag-formula">Live</span>
        </h2>
        <div className="est-kpi-grid">
          <Kpi label="Users" value={fmt(users.total)} sub={roleLine} />
          <Kpi label="Active Users" value={fmt(users.active)} />
          <Kpi label="Knowledge Hub Files" value={fmt(knowledgeHub.filesOnDisk)} sub="on disk" />
          <Kpi
            label="Indexed for EVA"
            value={services.eva?.available ? fmt(services.eva.documents) : '—'}
            sub={services.eva?.available ? `${fmt(services.eva.embedded_chunks)} chunks embedded` : 'EVA offline'}
          />
        </div>
      </div>

      <div className="est-chart-card">
        <h2 className="est-section-h2">
          <IconCpu size={18} color="var(--gold)" />
          Model & Services
          <span className="est-tag est-tag-ml">Measured, not marketed</span>
        </h2>
        <div className="est-kpi-grid">
          <Kpi
            label="UC-1 Deviation Model"
            value={services.estimator?.available ? services.estimator.uc1_model : '—'}
            sub={uc1?.test_r2 != null ? `R² ${uc1.test_r2}` : 'accuracy unavailable'}
          />
          <Kpi
            label="UC-2 Overrun Model"
            value={services.estimator?.available ? services.estimator.uc2_model : '—'}
            sub={uc2?.test_auc != null ? `AUC ${uc2.test_auc}` : 'accuracy unavailable'}
          />
          <Kpi
            label="Comparator Projects"
            value={services.estimator?.available ? fmt(services.estimator.comparator_projects) : '—'}
          />
          <Kpi
            label="Services Up"
            value={`${[services.gateway, services.estimator, services.eva].filter((s) => s?.available).length}/3`}
            sub="gateway · estimator · EVA"
          />
        </div>
        <div className="est-note">
          These accuracy figures are deliberately modest. The ML layer is a historical calibration
          signal, not a precise predictor — treat it as decision support alongside estimator judgement.
        </div>
      </div>
    </>
  );
}

// ── Current estimate — real, from the live estimator session ────────────────
function CurrentEstimateSection({ variant = 'full' }) {
  const { getEstimatorContext, hasContext } = useEstimatorContext();
  const { can } = useRoleContext();
  const navigate = useNavigate();
  const ctx = hasContext ? getEstimatorContext() : null;

  if (!ctx) {
    return (
      <div className="est-chart-card">
        <h2 className="est-section-h2"><IconGauge size={18} color="var(--gold)" />Current Estimate</h2>
        <div className="est-note">
          No estimate in this session yet.
          {can(CAPABILITIES.ESTIMATE_RUN)
            ? ' Run one in the estimator and its summary will appear here.'
            : ' An estimate run by your team will appear here once scored in this session.'}
        </div>
        {can(CAPABILITIES.ESTIMATE_RUN) && (
          <button className="est-run-btn" onClick={() => navigate('/estimate/create')}>
            Open Estimator →
          </button>
        )}
      </div>
    );
  }

  const showCost = can(CAPABILITIES.RATE_CARD_VIEW) || variant === 'executive';
  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconGauge size={18} color="var(--gold)" />
        Current Estimate
        <span className={`est-band-pill est-band-${ctx.ml?.riskBand || 'GREEN'}`}>
          {ctx.ml?.riskBand || 'N/A'}
        </span>
      </h2>
      <div className="est-kpi-grid">
        <Kpi label="Effort" value={`${fmt(ctx.bottomUp.totalEffortDays)}d`} sub="with contingency" />
        {showCost && <Kpi label="Cost" value={fmtMoney(ctx.bottomUp.totalCost)} />}
        <Kpi label="Avg FTE" value={ctx.bottomUp.totalFte ?? '—'} />
        <Kpi
          label="Estimate Health"
          value={ctx.intelligence?.health?.status || '—'}
          sub={ctx.intelligence?.health?.confidence != null
            ? `${ctx.intelligence.health.confidence}% confidence` : undefined}
        />
      </div>
      {variant === 'executive' && ctx.intelligence?.health?.concerns?.length > 0 && (
        <>
          <div className="est-driver-subhead">Top Risks</div>
          <ul className="est-completeness-list">
            {ctx.intelligence.health.concerns.slice(0, 3).map((c) => (
              <li key={c} className="est-check-warn">{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── SME technical review — reuses the Phase 2 intelligence, read-only ───────
function TechnicalReviewSection() {
  const { getEstimatorContext, hasContext } = useEstimatorContext();
  const ctx = hasContext ? getEstimatorContext() : null;
  if (!ctx) return null;

  const { coverage, intelligence } = ctx;
  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconDatabase size={18} color="var(--gold)" />
        Technical Signals
        <span className="est-tag est-tag-formula">From the current estimate</span>
      </h2>
      <div className="est-kpi-grid">
        <Kpi label="Integration Coverage" value={`${coverage.integrationCoverageRatio}x`}
          sub={coverage.integrationCoverageRatio < 1 ? 'below template baseline' : 'at or above baseline'} />
        <Kpi label="Migration Coverage" value={`${coverage.migrationCoverageRatio}x`}
          sub={coverage.migrationCoverageRatio < 1 ? 'below template baseline' : 'at or above baseline'} />
        <Kpi label="Completeness" value={`${intelligence?.completeness?.score ?? '—'}%`} />
        <Kpi label="Anomalies" value={intelligence?.anomalies?.items?.length ?? 0} />
      </div>
      {intelligence?.anomalies?.items?.length > 0 && (
        <ul className="est-completeness-list">
          {intelligence.anomalies.items.map((i) => <li key={i} className="est-check-warn">{i}</li>)}
        </ul>
      )}
    </div>
  );
}

export function RoleDashboard({ onManageUsers, onOpenEstimates, onOpenProjects }) {
  const { currentRoleId, can } = useRoleContext();
  const navigate = useNavigate();
  const config = dashboardFor(currentRoleId);

  const actions = config.quickActions.filter((a) => !a.capability || can(a.capability));

  const handleAction = (a) => {
    if (a.action === 'manage-users') return onManageUsers?.();
    if (a.action === 'my-estimates') return onOpenEstimates?.();
    if (a.action === 'projects') return onOpenProjects?.();
    return navigate(a.to);
  };

  return (
    <div className="dash-grid">
      <div className="dash-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            className="est-run-btn"
            onClick={() => handleAction(a)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {config.sources.includes('systemOverview') && <SystemOverviewSection />}
      {config.sources.includes('currentEstimate') && <CurrentEstimateSection />}
      {config.sources.includes('executiveSummary') && <CurrentEstimateSection variant="executive" />}
      {config.sources.includes('technicalReview') && <TechnicalReviewSection />}

      {config.unavailable?.length > 0 && (
        <div className="est-chart-card">
          <h2 className="est-section-h2">Not available yet</h2>
          {config.unavailable.map((u) => (
            <UnavailableNote key={u.label} label={u.label} reason={u.reason} />
          ))}
        </div>
      )}
    </div>
  );
}
