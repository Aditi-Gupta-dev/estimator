/**
 * Deterministic version-to-version delta comparison (Phase 5, Part 2).
 *
 * Pure function, no I/O, no LLM — the core principle of this phase is that
 * an LLM never calculates a number, it only explains numbers this module
 * already calculated. Operates on the exact shapes estimatesService.js's
 * versionToPublic()/computeBottomUp() already produce (frontend
 * lib/estimatorEngine.js) — no field here is invented:
 *
 *   version.inputs = { industry, overallComplexity, sectionA: {...}, overrides: { [component]: {complexity, volume, included} } }
 *   version.bottomUp = { totalBase, totalAdjusted, contingencyDays, totalWithContingency,
 *                         roleEffort, roleAvgFte, totalAvgFte, costByRole, totalCost, componentEffort }
 *   version.ml = { predictedDeviationPct, rangeLowPct, rangeHighPct, overrunProbability, riskBand, ... }
 *
 * Both versions passed in should be the UNREDACTED internal shape (real
 * blendedRate included) — redaction happens at the API/LLM boundary
 * (rateCardRedaction.js's redactDeltaForRole), not here. The engine's job is
 * to compute correctly, not to decide who may see the result.
 */

function numDelta(category, field, previous, current) {
  if (typeof previous !== 'number' || typeof current !== 'number') return null;
  const delta = current - previous;
  let deltaPct = null;
  if (previous !== 0) deltaPct = Math.round((delta / Math.abs(previous)) * 1000) / 10;
  else if (current !== 0) deltaPct = null; // undefined-from-zero — leave unset rather than claim Infinity%
  else deltaPct = 0;
  return {
    category, field, previous, current, delta: Math.round(delta * 100) / 100, deltaPct,
  };
}

const TOTAL_FIELDS = ['totalBase', 'totalAdjusted', 'contingencyDays', 'totalWithContingency', 'totalAvgFte'];
const ML_FIELDS = ['predictedDeviationPct', 'overrunProbability', 'rangeLowPct', 'rangeHighPct'];

/** @param {object} previousVersion  a versionToPublic()-shaped row — the
 *    version currentVersion.previousVersionId actually points at.
 *  @param {object} currentVersion   the new version being compared.
 *  @returns structured, deterministic delta — the ONLY numeric authority in
 *    this phase's pipeline. */
export function compareEstimateDelta(previousVersion, currentVersion) {
  const prevInputs = previousVersion.inputs || {};
  const currInputs = currentVersion.inputs || {};
  const prevBU = previousVersion.bottomUp || {};
  const currBU = currentVersion.bottomUp || {};
  const prevMl = previousVersion.ml || {};
  const currMl = currentVersion.ml || {};

  const changedFields = [];
  const numericDeltas = [];
  const addedItems = [];
  const removedItems = [];
  const modifiedItems = [];

  // ── Assumptions ──────────────────────────────────────────────────────────
  if (prevInputs.industry !== currInputs.industry) {
    changedFields.push('industry');
    modifiedItems.push({
      type: 'assumption', field: 'industry', previous: prevInputs.industry ?? null, current: currInputs.industry ?? null,
    });
  }
  if (prevInputs.overallComplexity !== currInputs.overallComplexity) {
    changedFields.push('overallComplexity');
    modifiedItems.push({
      type: 'assumption', field: 'overallComplexity', previous: prevInputs.overallComplexity ?? null, current: currInputs.overallComplexity ?? null,
    });
  }

  // ── Effort/cost totals ───────────────────────────────────────────────────
  TOTAL_FIELDS.forEach((f) => {
    const d = numDelta('effort', f, prevBU[f], currBU[f]);
    if (d && d.delta !== 0) { numericDeltas.push(d); changedFields.push(f); }
  });
  const costD = numDelta('cost', 'totalCost', prevBU.totalCost, currBU.totalCost);
  if (costD && costD.delta !== 0) { numericDeltas.push(costD); changedFields.push('totalCost'); }

  // ── ML risk signals — "relevant estimation parameters", no cost data ────
  ML_FIELDS.forEach((f) => {
    const d = numDelta('risk', f, prevMl[f], currMl[f]);
    if (d && d.delta !== 0) numericDeltas.push(d);
  });
  if ((prevMl.riskBand ?? null) !== (currMl.riskBand ?? null)) {
    changedFields.push('ml.riskBand');
    numericDeltas.push({
      category: 'risk', field: 'riskBand', previous: prevMl.riskBand ?? null, current: currMl.riskBand ?? null, delta: null, deltaPct: null,
    });
  }

  // ── Role effort / cost / rate — union of role names across both sides ───
  // roleRate deltas are the ONLY category rate-card redaction ever strips
  // (rateCardRedaction.js's redactDeltaForRole) — roleCost/effort stay, same
  // policy as bottomUp.costByRole elsewhere (aggregate cost is not
  // restricted; the underlying $/day rate is).
  const roleNames = new Set([
    ...Object.keys(prevBU.roleAvgFte || {}), ...Object.keys(currBU.roleAvgFte || {}),
  ]);
  roleNames.forEach((role) => {
    const fteD = numDelta('roleEffort', role, (prevBU.roleAvgFte || {})[role], (currBU.roleAvgFte || {})[role]);
    if (fteD && fteD.delta !== 0) numericDeltas.push(fteD);
    const prevRoleCost = (prevBU.costByRole || {})[role];
    const currRoleCost = (currBU.costByRole || {})[role];
    const costDelta = numDelta('roleCost', role, prevRoleCost?.cost, currRoleCost?.cost);
    if (costDelta && costDelta.delta !== 0) numericDeltas.push(costDelta);
    const rateDelta = numDelta('roleRate', role, prevRoleCost?.blendedRate, currRoleCost?.blendedRate);
    if (rateDelta && rateDelta.delta !== 0) numericDeltas.push(rateDelta);
  });

  // ── Scope: which components are in/out, and how ─────────────────────────
  const prevOverrides = prevInputs.overrides || {};
  const currOverrides = currInputs.overrides || {};
  const componentNames = new Set([...Object.keys(prevOverrides), ...Object.keys(currOverrides)]);
  componentNames.forEach((name) => {
    const p = prevOverrides[name];
    const c = currOverrides[name];
    const wasIncluded = !!p?.included;
    const isIncluded = !!c?.included;
    if (!wasIncluded && isIncluded) {
      addedItems.push({
        type: 'component', name, complexity: c.complexity ?? null, volume: c.volume ?? null,
      });
    } else if (wasIncluded && !isIncluded) {
      removedItems.push({
        type: 'component', name, complexity: p.complexity ?? null, volume: p.volume ?? null,
      });
    } else if (wasIncluded && isIncluded) {
      const fieldChanges = [];
      if (p.complexity !== c.complexity) fieldChanges.push({ field: 'complexity', previous: p.complexity, current: c.complexity });
      if (p.volume !== c.volume) fieldChanges.push({ field: 'volume', previous: p.volume, current: c.volume });
      if (fieldChanges.length) modifiedItems.push({ type: 'component', name, changes: fieldChanges });
    }
  });
  if (addedItems.length || removedItems.length) changedFields.push('overrides');

  // ── Scale/scope parameters (Section A) ───────────────────────────────────
  const prevSA = prevInputs.sectionA || {};
  const currSA = currInputs.sectionA || {};
  const paramKeys = new Set([...Object.keys(prevSA), ...Object.keys(currSA)]);
  paramKeys.forEach((key) => {
    const d = numDelta('parameter', key, prevSA[key], currSA[key]);
    if (d && d.delta !== 0) { numericDeltas.push(d); changedFields.push(`sectionA.${key}`); }
  });

  return {
    previousVersionId: previousVersion.id,
    currentVersionId: currentVersion.id,
    changeReason: currentVersion.changeReason || null,
    changedFields,
    numericDeltas,
    addedItems,
    removedItems,
    modifiedItems,
  };
}
