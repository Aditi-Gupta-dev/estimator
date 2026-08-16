import { useMemo } from 'react';
import { IconFlask, IconPlus, IconX } from '@tabler/icons-react';
import { COMPONENTS } from '../../constants/estimator-template';
import { useScenarioSimulator } from '../../hooks/useScenarioSimulator';
import { EstimatorGlobalParamsForm } from './EstimatorGlobalParamsForm';
import { EstimatorComponentGrid } from './EstimatorComponentGrid';
import { ScenarioComparisonCard } from './ScenarioComparisonCard';

// Reuses the exact same forms the main Global Parameters / Module Estimator
// steps use, bound to an independent scenario copy of the inputs instead of
// the live estimator state — so every parameter the spec calls out
// (complexity, duration, integration/DM volumes, contingency, onshore %,
// component selection) is editable without inventing bespoke controls, and
// without touching the committed estimate.
export function ScenarioSimulatorPanel({ baseline, baselineResult, onClose }) {
  const sim = useScenarioSimulator(baseline);
  const { activeScenario } = sim;

  const scenarioComponentRows = useMemo(
    () => COMPONENTS.map((c) => ({ ...c, ...activeScenario.overrides[c.component] })),
    [activeScenario.overrides],
  );
  const scenarioSelectedCount = useMemo(
    () => Object.values(activeScenario.overrides).filter((o) => o.included).length,
    [activeScenario.overrides],
  );

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconFlask size={18} color="var(--gold)" />
        Scenario Simulator
        <span className="est-tag est-tag-formula">Copies the current estimate — never overwrites it</span>
      </h2>

      <div className="est-scenario-tabs">
        {sim.scenarios.map((s) => (
          <button
            key={s.id}
            className={`est-scenario-tab${s.id === sim.activeScenarioId ? ' active' : ''}`}
            onClick={() => sim.setActiveScenarioId(s.id)}
          >
            {s.name}
            {sim.scenarios.length > 1 && (
              <IconX
                size={12}
                className="est-scenario-tab-close"
                onClick={(e) => { e.stopPropagation(); sim.removeScenario(s.id); }}
              />
            )}
          </button>
        ))}
        <button className="est-scenario-tab est-scenario-tab-add" onClick={sim.createScenario}>
          <IconPlus size={13} /> New Scenario
        </button>
        <button className="est-link-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Close Simulator</button>
      </div>

      <div className="est-field-group" style={{ maxWidth: 320 }}>
        <label className="est-field-label">Scenario Name</label>
        <input
          className="est-input"
          value={activeScenario.name}
          onChange={(e) => sim.renameScenario(activeScenario.id, e.target.value)}
        />
      </div>

      <EstimatorGlobalParamsForm
        industry={activeScenario.industry}
        setIndustry={(v) => sim.setScenarioIndustry(activeScenario.id, v)}
        overallComplexity={activeScenario.overallComplexity}
        setOverallComplexity={(v) => sim.setScenarioComplexity(activeScenario.id, v)}
        sectionA={activeScenario.sectionA}
        updateSectionA={(key, value) => sim.updateScenarioSectionA(activeScenario.id, key, value)}
      />

      <EstimatorComponentGrid
        componentRows={scenarioComponentRows}
        updateOverride={(name, field, value) => sim.updateScenarioOverride(activeScenario.id, name, field, value)}
        setIncludedForComponents={(names, included) => sim.setScenarioIncludedForComponents(activeScenario.id, names, included)}
        selectedCount={scenarioSelectedCount}
      />

      <ScenarioComparisonCard baselineResult={baselineResult} scenario={activeScenario} />
    </div>
  );
}
