import { useEffect } from 'react';
import { IconArrowLeft, IconCalculator } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import '../styles/estimator.css';
import { useEstimator } from '../hooks/useEstimator';
import { useEstimatorContext } from '../contexts/EstimatorContextProvider';
import { buildEstimatorContext } from '../lib/estimatorContext';
import { EstimatorGlobalParamsForm } from '../components/estimator/EstimatorGlobalParamsForm';
import { EstimatorComponentGrid } from '../components/estimator/EstimatorComponentGrid';
import { EstimatorResultsView } from '../components/estimator/EstimatorResultsView';

const TABS = [
  { id: 1, label: '1. Global Parameters' },
  { id: 2, label: '2. Module Estimator' },
  { id: 3, label: '3. Estimate Output' },
];

export function OracleFusionEstimatorPage() {
  const navigate = useNavigate();
  const estimator = useEstimator();
  const {
    step, setStep, industry, setIndustry, overallComplexity, setOverallComplexity,
    sectionA, updateSectionA, overrides, componentRows, updateOverride, setIncludedForComponents, selectedCount,
    isLoading, error, result, runEstimate,
  } = estimator;
  const { publishEstimatorContext, clearEstimatorContext } = useEstimatorContext();

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
            Oracle Fusion Template Estimator
          </h1>
          <p className="est-subtitle">
            Bottom-up estimate built from a 67-component catalog — select only what applies to this
            engagement — calibrated against 500 executed Oracle Fusion programmes via the UC-1/UC-2
            risk-scoring models.
          </p>
        </div>
      </header>

      <div className="est-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`est-tab${step === t.id ? ' active' : ''}`}
            onClick={() => setStep(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
            />
          )}
        </>
      )}
    </div>
  );
}
