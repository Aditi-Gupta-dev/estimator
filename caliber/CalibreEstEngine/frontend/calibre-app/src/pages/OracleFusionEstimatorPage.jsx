import { useEffect, useState } from 'react';
import { IconArrowLeft, IconCalculator, IconCheck } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../styles/estimator.css';
import { useEstimator } from '../hooks/useEstimator';
import { useEstimatorContext } from '../contexts/EstimatorContextProvider';
import { buildEstimatorContext } from '../lib/estimatorContext';
import * as estimatesApi from '../services/estimatesApi';
import { EstimatorGlobalParamsForm } from '../components/estimator/EstimatorGlobalParamsForm';
import { EstimatorComponentGrid } from '../components/estimator/EstimatorComponentGrid';
import { EstimatorResultsView } from '../components/estimator/EstimatorResultsView';

const TABS = [
  { id: 1, label: 'Global Parameters' },
  { id: 2, label: 'Module Estimator' },
  { id: 3, label: 'Estimate Output' },
];

export function OracleFusionEstimatorPage({ onOpenMyEstimates }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reviseEstimateId = searchParams.get('reviseEstimateId');
  const estimator = useEstimator();
  const {
    step, setStep, industry, setIndustry, overallComplexity, setOverallComplexity,
    sectionA, updateSectionA, overrides, componentRows, updateOverride, setIncludedForComponents, selectedCount,
    isLoading, error, result, runEstimate, hydrate,
  } = estimator;
  const { publishEstimatorContext, clearEstimatorContext } = useEstimatorContext();

  // Phase 4 Part 16 — "Revise Estimate": the wizard re-opened pre-filled
  // with a CHANGES_REQUESTED estimate's current inputs, so the user edits
  // for real instead of the review panel resubmitting unchanged inputs.
  const [reviseInfo, setReviseInfo] = useState(null); // { name, currentVersion } once loaded
  const [reviseLoadError, setReviseLoadError] = useState('');

  useEffect(() => {
    if (!reviseEstimateId) return;
    let alive = true;
    estimatesApi.getEstimate(reviseEstimateId)
      .then((est) => {
        if (!alive) return;
        if (est.status !== 'changes_requested') {
          setReviseLoadError(`This estimate is "${est.status}", not changes-requested — nothing to revise.`);
          return;
        }
        hydrate(est.latestVersion.inputs);
        setReviseInfo({ name: est.name, currentVersion: est.currentVersion });
      })
      .catch((err) => { if (alive) setReviseLoadError(err.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviseEstimateId]);

  // Keep EVA's snapshot current without firing any request (spec §11) — the
  // next EVA turn simply reads whatever is latest. Cleared on unmount so
  // non-estimator pages send estimatorContext: null.
  useEffect(() => {
    if (!result) {
      clearEstimatorContext();
      return;
    }
    publishEstimatorContext(buildEstimatorContext({
      estimateId: result.estimateId,
      result,
      sectionA,
      overallComplexity,
      industry,
      overrides,
      componentRows,
      selectedCount,
    }));
  }, [
    result, sectionA, overallComplexity, industry, overrides, componentRows, selectedCount,
    publishEstimatorContext, clearEstimatorContext,
  ]);

  useEffect(() => clearEstimatorContext, [clearEstimatorContext]);

  return (
    <div className="est-page">
      <header className="est-header">
        <div className="est-title-group">
          <h1>
            <button className="kh-view-btn" onClick={() => navigate('/home')} style={{ marginRight: 8 }}>
              <IconArrowLeft size={16} />
            </button>
            <IconCalculator size={22} color="var(--gold)" />
            {reviseInfo ? `Revising: ${reviseInfo.name}` : 'Oracle Fusion Template Estimator'}
          </h1>
          <p className="est-subtitle">
            {reviseInfo
              ? `Editing V${reviseInfo.currentVersion}, sent back with reviewer feedback — resubmitting creates V${reviseInfo.currentVersion + 1} of this same estimate.`
              : 'Bottom-up estimate built from a 67-component catalog — select only what applies to this '
                + 'engagement — calibrated against 500 executed Oracle Fusion programmes via the UC-1/UC-2 '
                + 'risk-scoring models.'}
          </p>
        </div>
      </header>

      {reviseLoadError && <div className="est-chart-card est-error">{reviseLoadError}</div>}

      <nav className="est-stepper" aria-label="Estimator steps">
        {TABS.map((t, i) => {
          const state = step === t.id ? 'active' : step > t.id ? 'completed' : 'upcoming';
          return (
            <div className="est-stepper-item" key={t.id}>
              <button
                className={`est-tab ${state}`}
                onClick={() => setStep(t.id)}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span className="est-tab-num">
                  {state === 'completed' ? <IconCheck size={14} strokeWidth={3} /> : t.id}
                </span>
                <span className="est-tab-label">{t.label}</span>
              </button>
              {i < TABS.length - 1 && <span className={`est-tab-connector${step > t.id ? ' filled' : ''}`} />}
            </div>
          );
        })}
      </nav>

      {step === 1 && (
        <EstimatorGlobalParamsForm
          industry={industry} setIndustry={setIndustry}
          overallComplexity={overallComplexity} setOverallComplexity={setOverallComplexity}
          sectionA={sectionA} updateSectionA={updateSectionA}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <EstimatorComponentGrid
          componentRows={componentRows}
          updateOverride={updateOverride}
          setIncludedForComponents={setIncludedForComponents}
          selectedCount={selectedCount}
          onNext={runEstimate}
        />
      )}

      {step === 3 && (
        <>
          {isLoading && <div className="est-empty">Scoring against the estimation risk models…</div>}
          {error && (
            <div className="est-chart-card est-error">
              {error}
              {error.startsWith('Select at least one') ? (
                <div className="est-note" style={{ marginTop: 8 }}>
                  <button className="est-link-btn" onClick={() => setStep(2)}>← Back to Module Estimator</button>
                </div>
              ) : (
                <div className="est-note" style={{ marginTop: 8 }}>
                  Make sure the FastAPI service is running (uvicorn api:app --port 8000 in estimator_agents/src)
                  and the upload-server proxy (port 3001) is up.
                </div>
              )}
            </div>
          )}
          {!isLoading && !error && !result && (
            <div className="est-empty">Set parameters and components, then run the estimate.</div>
          )}
          {!isLoading && !error && result && (
            <EstimatorResultsView
              result={result}
              sectionA={sectionA}
              overallComplexity={overallComplexity}
              industry={industry}
              overrides={overrides}
              componentRows={componentRows}
              selectedCount={selectedCount}
              onOpenMyEstimates={onOpenMyEstimates}
              reviseEstimateId={reviseInfo ? reviseEstimateId : null}
              reviseEstimateName={reviseInfo?.name}
              reviseCurrentVersion={reviseInfo?.currentVersion}
            />
          )}
        </>
      )}
    </div>
  );
}
