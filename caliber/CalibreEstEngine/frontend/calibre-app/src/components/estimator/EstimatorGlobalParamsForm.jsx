import { IconLayersSubtract } from '@tabler/icons-react';
import { COMPLEXITY_LEVELS, INDUSTRIES, SECTION_A_LABELS, SECTION_A_PARAMS } from '../../constants/estimator-template';

export function EstimatorGlobalParamsForm({
  industry, setIndustry,
  overallComplexity, setOverallComplexity,
  sectionA, updateSectionA,
  onNext,
}) {
  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconLayersSubtract size={18} color="var(--gold)" />
        Assumptions — Section A: Project Parameters
      </h2>

      <div className="est-field-row">
        <div className="est-field-group">
          <label className="est-field-label">Industry Domain (for ML calibration)</label>
          <select className="est-select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
          </select>
        </div>
        <div className="est-field-group">
          <label className="est-field-label">Overall Complexity (for ML calibration)</label>
          <select className="est-select" value={overallComplexity} onChange={(e) => setOverallComplexity(e.target.value)}>
            {COMPLEXITY_LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="est-param-grid">
        {Object.keys(SECTION_A_PARAMS).map((key) => {
          const p = SECTION_A_PARAMS[key];
          // All Section A counts (including duration_months) are whole numbers —
          // the estimator service's request model requires integers.
          const step = 1;
          return (
            <div className="est-field-group" key={key}>
              <label className="est-field-label">{SECTION_A_LABELS[key] || key}</label>
              <input
                type="number"
                className="est-input"
                value={sectionA[key]}
                min={p.min}
                max={p.max}
                step={step}
                onChange={(e) => updateSectionA(key, Number(e.target.value))}
              />
              <div className="est-field-hint">{p.unit} · range {p.min}–{p.max}</div>
            </div>
          );
        })}
      </div>

      {onNext && <button className="est-run-btn" onClick={onNext}>Next: Module Estimator →</button>}
    </div>
  );
}
