import { useState, useCallback, useMemo } from 'react';
import { COMPONENTS, SECTION_A_PARAMS } from '../constants/estimator-template';
import { scoreEstimate } from '../lib/estimatorEngine';

function defaultSectionA() {
  const sa = {};
  Object.keys(SECTION_A_PARAMS).forEach((key) => { sa[key] = SECTION_A_PARAMS[key].value; });
  return sa;
}

function newEstimateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `est-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultOverrides() {
  const overrides = {};
  COMPONENTS.forEach((c) => {
    // included defaults to false — the estimator only wants values for the
    // components that actually apply to this engagement, not all 67.
    overrides[c.component] = { complexity: c.default_complexity, volume: c.default_volume, included: false };
  });
  return overrides;
}

export function useEstimator() {
  const [step, setStep] = useState(1); // 1 = Global Parameters, 2 = Module Estimator, 3 = Output

  const [industry, setIndustry] = useState('BFSI');
  const [overallComplexity, setOverallComplexity] = useState('H');
  const [sectionA, setSectionA] = useState(defaultSectionA);
  const [overrides, setOverrides] = useState(defaultOverrides);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const updateSectionA = useCallback((key, value) => {
    setSectionA((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateOverride = useCallback((componentName, field, value) => {
    setOverrides((prev) => ({
      ...prev,
      [componentName]: { ...prev[componentName], [field]: value },
    }));
  }, []);

  // Bulk-set `included` for a set of components at once — used by the
  // per-module and "select all" / "clear all" toggles in the grid.
  const setIncludedForComponents = useCallback((componentNames, included) => {
    setOverrides((prev) => {
      const next = { ...prev };
      componentNames.forEach((name) => {
        next[name] = { ...next[name], included };
      });
      return next;
    });
  }, []);

  const selectedCount = useMemo(
    () => Object.values(overrides).filter((o) => o.included).length,
    [overrides],
  );

  // Layer 1 + Layer 2 pipeline itself lives in lib/estimatorEngine.js
  // (scoreEstimate) — shared with the Scenario Simulator and Risk
  // Reduction feature so none of them re-implement the /score contract.
  const runEstimate = useCallback(async () => {
    if (selectedCount === 0) {
      setError('Select at least one component before running the estimate.');
      setStep(3);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const scored = await scoreEstimate({
        overrides, sectionA, industry, overallComplexity,
      });
      // Stable id for this run — lets EVA (and its planner's
      // active_estimate_id slot) refer to a specific estimate.
      setResult({ ...scored, estimateId: newEstimateId() });
      setStep(3);
    } catch (err) {
      setError(err.message || 'Failed to reach the estimator service.');
      setStep(3);
    } finally {
      setIsLoading(false);
    }
  }, [industry, overallComplexity, sectionA, overrides, selectedCount]);

  const componentRows = useMemo(
    () => COMPONENTS.map((c) => ({ ...c, ...overrides[c.component] })),
    [overrides],
  );

  // Loads an EXISTING input set into the wizard — the Phase 4 "Revise
  // Estimate" flow (Part 16): re-opens the real estimator UI pre-filled
  // with a CHANGES_REQUESTED estimate's current inputs instead of
  // duplicating the wizard inside the review panel. Overrides is merged
  // onto the full 67-component default shape so a saved estimate that
  // predates a template addition still hydrates cleanly.
  const hydrate = useCallback((inputs) => {
    if (!inputs) return;
    setIndustry(inputs.industry ?? 'BFSI');
    setOverallComplexity(inputs.overallComplexity ?? 'H');
    setSectionA({ ...defaultSectionA(), ...(inputs.sectionA || {}) });
    setOverrides({ ...defaultOverrides(), ...(inputs.overrides || {}) });
    setResult(null);
    setStep(1);
  }, []);

  return {
    step, setStep,
    industry, setIndustry,
    overallComplexity, setOverallComplexity,
    sectionA, updateSectionA,
    overrides, updateOverride, setIncludedForComponents, selectedCount,
    componentRows,
    isLoading, error, result,
    runEstimate, hydrate,
  };
}
