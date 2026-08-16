import {
  useState, useCallback, useRef, useEffect,
} from 'react';
import { buildScorePayload, scoreEstimate } from '../lib/estimatorEngine';

// Debounce window for the /score network call — Layer 1 (bottomUp/coverage)
// is cheap and recomputed synchronously by consumers on every keystroke;
// only the ML call is throttled, per the "don't call /score on every
// keystroke" performance requirement.
const DEBOUNCE_MS = 700;

let scenarioSeq = 0;
function nextScenarioId() {
  scenarioSeq += 1;
  return `scenario-${scenarioSeq}`;
}

function cloneScenarioInputs(baseline) {
  return {
    industry: baseline.industry,
    overallComplexity: baseline.overallComplexity,
    sectionA: { ...baseline.sectionA },
    overrides: Object.fromEntries(
      Object.entries(baseline.overrides).map(([name, row]) => [name, { ...row }]),
    ),
  };
}

function makeScenario(baseline, name) {
  return {
    id: nextScenarioId(),
    name,
    ...cloneScenarioInputs(baseline),
    status: 'idle', // 'idle' | 'scoring' | 'ready' | 'error'
    result: null,
    error: null,
  };
}

// Manages one or more scenario drafts cloned from the current committed
// estimate (`baseline`). Each scenario's inputs can be edited independently
// (reusing EstimatorGlobalParamsForm/EstimatorComponentGrid bound to that
// scenario instead of the main estimator state); changes are re-scored via
// the same scoreEstimate() pipeline used everywhere else, debounced and
// cached so identical inputs never trigger a duplicate /score call. Nothing
// here ever touches the real, committed estimate — scenarios are purely
// in-memory and discarded when the panel closes.
export function useScenarioSimulator(baseline) {
  const [state, setState] = useState(() => {
    const s = makeScenario(baseline, 'Scenario 1');
    return { scenarios: [s], activeScenarioId: s.id };
  });

  const cacheRef = useRef(new Map()); // payload JSON -> scored result, shared across scenarios
  const timersRef = useRef({}); // scenarioId -> debounce timeout handle
  const lastScoredKeyRef = useRef({}); // scenarioId -> payload key of its last successful score
  const pendingKeyRef = useRef({}); // scenarioId -> payload key currently debouncing/in-flight

  const updateScenario = useCallback((id, patch) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const patchScenarioInputs = useCallback((id, patchFn) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, ...patchFn(s) } : s)),
    }));
  }, []);

  const setActiveScenarioId = useCallback((id) => {
    setState((prev) => ({ ...prev, activeScenarioId: id }));
  }, []);

  const createScenario = useCallback(() => {
    setState((prev) => {
      const s = makeScenario(baseline, `Scenario ${prev.scenarios.length + 1}`);
      return { scenarios: [...prev.scenarios, s], activeScenarioId: s.id };
    });
  }, [baseline]);

  const removeScenario = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    delete lastScoredKeyRef.current[id];
    delete pendingKeyRef.current[id];

    setState((prev) => {
      const scenarios = prev.scenarios.filter((s) => s.id !== id);
      if (scenarios.length === 0) {
        const s = makeScenario(baseline, 'Scenario 1');
        return { scenarios: [s], activeScenarioId: s.id };
      }
      const activeScenarioId = prev.activeScenarioId === id ? scenarios[0].id : prev.activeScenarioId;
      return { scenarios, activeScenarioId };
    });
  }, [baseline]);

  const renameScenario = useCallback((id, name) => {
    updateScenario(id, { name });
  }, [updateScenario]);

  const updateScenarioSectionA = useCallback((id, key, value) => {
    patchScenarioInputs(id, (s) => ({ sectionA: { ...s.sectionA, [key]: value } }));
  }, [patchScenarioInputs]);

  const updateScenarioOverride = useCallback((id, componentName, field, value) => {
    patchScenarioInputs(id, (s) => ({
      overrides: { ...s.overrides, [componentName]: { ...s.overrides[componentName], [field]: value } },
    }));
  }, [patchScenarioInputs]);

  const setScenarioIncludedForComponents = useCallback((id, componentNames, included) => {
    patchScenarioInputs(id, (s) => {
      const next = { ...s.overrides };
      componentNames.forEach((name) => { next[name] = { ...next[name], included }; });
      return { overrides: next };
    });
  }, [patchScenarioInputs]);

  const setScenarioComplexity = useCallback((id, value) => {
    patchScenarioInputs(id, () => ({ overallComplexity: value }));
  }, [patchScenarioInputs]);

  const setScenarioIndustry = useCallback((id, value) => {
    patchScenarioInputs(id, () => ({ industry: value }));
  }, [patchScenarioInputs]);

  // Watches every scenario's current inputs and (re)plans a debounced,
  // cached /score call whenever they've changed since the last completed
  // score. Guarded with pendingKeyRef so a scenario mid-debounce doesn't
  // re-trigger itself when its own "scoring" status update causes this
  // effect to re-run, and so a late-arriving response for since-superseded
  // inputs is discarded rather than overwriting newer results.
  useEffect(() => {
    state.scenarios.forEach((scenario) => {
      const { payload } = buildScorePayload({
        overrides: scenario.overrides,
        sectionA: scenario.sectionA,
        industry: scenario.industry,
        overallComplexity: scenario.overallComplexity,
      });
      const key = JSON.stringify(payload);

      if (lastScoredKeyRef.current[scenario.id] === key) return;
      if (pendingKeyRef.current[scenario.id] === key) return;

      pendingKeyRef.current[scenario.id] = key;
      clearTimeout(timersRef.current[scenario.id]);

      if (cacheRef.current.has(key)) {
        lastScoredKeyRef.current[scenario.id] = key;
        pendingKeyRef.current[scenario.id] = null;
        updateScenario(scenario.id, { status: 'ready', result: cacheRef.current.get(key), error: null });
        return;
      }

      updateScenario(scenario.id, { status: 'scoring' });
      timersRef.current[scenario.id] = setTimeout(async () => {
        try {
          const scored = await scoreEstimate({
            overrides: scenario.overrides,
            sectionA: scenario.sectionA,
            industry: scenario.industry,
            overallComplexity: scenario.overallComplexity,
          });
          cacheRef.current.set(key, scored);
          if (pendingKeyRef.current[scenario.id] === key) {
            lastScoredKeyRef.current[scenario.id] = key;
            pendingKeyRef.current[scenario.id] = null;
            updateScenario(scenario.id, { status: 'ready', result: scored, error: null });
          }
        } catch (err) {
          if (pendingKeyRef.current[scenario.id] === key) {
            pendingKeyRef.current[scenario.id] = null;
            updateScenario(scenario.id, {
              status: 'error', result: null, error: err.message || 'Failed to score scenario.',
            });
          }
        }
      }, DEBOUNCE_MS);
    });
  }, [state.scenarios, updateScenario]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach((t) => clearTimeout(t));
  }, []);

  const activeScenario = state.scenarios.find((s) => s.id === state.activeScenarioId) || state.scenarios[0];

  return {
    scenarios: state.scenarios,
    activeScenarioId: state.activeScenarioId,
    activeScenario,
    setActiveScenarioId,
    createScenario,
    removeScenario,
    renameScenario,
    updateScenarioSectionA,
    updateScenarioOverride,
    setScenarioIncludedForComponents,
    setScenarioComplexity,
    setScenarioIndustry,
  };
}
