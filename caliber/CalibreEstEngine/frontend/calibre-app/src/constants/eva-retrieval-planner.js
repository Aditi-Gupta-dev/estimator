/**
 * EVA Retrieval Planner — Task Layer Prompt
 *
 * This is the planner prompt that runs BEFORE RAG retrieval.
 * It converts a user turn + session facts into a structured JSON query plan
 * which then drives the vector-store fetch and metadata pre-filter.
 *
 * Pipeline position:
 *   User turn
 *     → [PLANNER]  (this file)  → JSON retrieval plan
 *     → [RETRIEVER]             → ranked <context> chunks
 *     → [EVA_SYSTEM_PROMPT]     → grounded answer
 *
 * Version : 1.0
 * Owner   : Calibre COE / Admin
 */

// ── Intent enum ───────────────────────────────────────────────────────────────
export const INTENT = {
  RETRIEVE:     'RETRIEVE',
  ESTIMATE:     'ESTIMATE',
  CALIBRATE:    'CALIBRATE',
  ASSESS_RISK:  'ASSESS_RISK',
  NAVIGATE:     'NAVIGATE',
  CLARIFY:      'CLARIFY',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
};

// ── Document class enum ───────────────────────────────────────────────────────
export const DOCUMENT_CLASS = {
  GUIDELINE:    'guideline',
  TEMPLATE:     'template',
  POV:          'pov',
  CASE_STUDY:   'casestudy',
  BENCHMARK:    'benchmark',
  RATE_CARD:    'ratecard',
  ACTUAL:       'actual',
  FAQ:          'faq',
  PLAYBOOK:     'playbook',
  WHITEPAPER:   'whitepaper',
};

// ── Subdivision enum (matches KnowledgeHub folder) ────────────────────────────
export const SUBDIVISION = {
  TEMPLATES: 'templates',
  DATA:      'data',
};

// ── Known unit IDs ─────────────────────────────────────────────────────────────
export const UNIT_IDS = ['esu', 'adm', 'itis', 'bps', 'ti', 'ion', 'bfsi', 'iae', 'cyber', 'ai', 'datacloud', '_global'];

// ── k bounds ──────────────────────────────────────────────────────────────────
export const K_NARROW    = 3;   // factual point lookup
export const K_DEFAULT   = 5;   // standard retrieval
export const K_BROAD     = 8;   // methodology / comparison
export const K_MAX       = 8;   // hard cap

// ══════════════════════════════════════════════════════════════════════════════
//  PLANNER SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════════════════

export const EVA_PLANNER_PROMPT = `
Convert the user turn into a Calibre retrieval plan. Output ONE JSON object. No prose,
no markdown fences.

SESSION FACTS
  role: {{caller_role}}            # estimator | unit_sme | admin_coe | super_user
  active_unit: {{unit_id}}         # may be null
  active_estimate_id: {{est_id}}   # may be null
  turn_history_summary: {{rolling_summary}}   # ≤80 tokens

DECIDE
1. intent — one of:
     RETRIEVE | ESTIMATE | CALIBRATE | ASSESS_RISK | NAVIGATE | CLARIFY | OUT_OF_SCOPE
2. needs_retrieval — false when the turn is navigational, a pure arithmetic follow-up on
   figures already in the conversation, a clarification of your own last message, or
   answerable from turn_history_summary alone. Default to false when genuinely borderline;
   a wrong false costs one extra turn, a wrong true costs a full retrieval cycle.
3. filters — deterministic metadata pre-filter. Emit ONLY fields you can justify from the
   turn or session facts. Never guess unit_id. Omit rather than guess.
4. queries — 1 to 3 short retrieval strings. Decompose only genuinely multi-part asks
   (e.g. "compare ESU Oracle vs ADM Oracle effort norms" → 2 queries). Strip stopwords and
   conversational framing; keep domain nouns and template names verbatim.
5. k — chunks to retrieve per query. 3 for a narrow factual lookup, 5 default,
   8 for methodology or comparison. Never exceed 8.
6. requires_actuals — true only if the answer depends on historical delivery data.
7. missing_inputs — named fields the user must supply before an estimate is computable.
   If this array is non-empty, set intent to CLARIFY.
8. wants_score_tool — true only when the user is asking to actually SCORE/COMPUTE a
   project's deviation % or overrun risk (numeric inputs given or clearly implied), not
   just describing or asking about estimation methodology in general. Only meaningful
   for intent ESTIMATE or ASSESS_RISK; false otherwise.

SCHEMA
{
  "intent": "RETRIEVE",
  "needs_retrieval": true,
  "filters": {
    "unit_id": "esu",
    "subdivision": "data",
    "program_type": "oracle",
    "file_type": null,
    "document_class": "guideline"
  },
  "queries": ["oracle fusion CRP cycle effort drivers"],
  "k": 5,
  "requires_actuals": false,
  "missing_inputs": [],
  "wants_score_tool": false,
  "reasoning": "one clause, max 15 words"
}

RULES
- Output ONLY the JSON object. No prose, no markdown code fences, no trailing text.
- filters.unit_id: use the session active_unit if the user hasn't specified a different one.
  If both are null, omit the field entirely — never guess.
- filters.subdivision: "templates" only when the user explicitly requests a template or
  workbook. All other document classes map to "data".
- queries: strip filler words ("can you", "please", "I need to", "tell me about").
  Keep template names, BU names, programme types, and methodology terms verbatim.
- missing_inputs: name the specific field (e.g. "delivery_model", "scope_modules",
  "offshore_ratio", "contract_type") — not generic phrases like "more information".
- wants_score_tool: true requires concrete project numbers in the turn or recent
  turn_history_summary (module/entity/integration counts, duration, team size, etc.) —
  a vague "what's the risk of ERP projects" is false.
- reasoning: one clause, max 15 words, no hedging. Justify the intent and needs_retrieval
  decision only.
`.trim();

// ── Build the full planner prompt with session facts injected ─────────────────
export function buildPlannerPrompt({ userTurn, callerRole, unitId, estimateId, rollingSummary }) {
  return EVA_PLANNER_PROMPT
    .replace('{{caller_role}}',      callerRole      || 'estimator')
    .replace('{{unit_id}}',          unitId          || 'null')
    .replace('{{est_id}}',           estimateId      || 'null')
    .replace('{{rolling_summary}}',  rollingSummary  || 'no prior context')
    + `\n\nUSER TURN\n${userTurn.trim()}`;
}

// ── Validate a parsed planner response ───────────────────────────────────────
export function validatePlannerResponse(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Response is not a JSON object'] };
  }

  // intent
  if (!Object.values(INTENT).includes(raw.intent)) {
    errors.push(`Invalid intent "${raw.intent}". Must be one of: ${Object.values(INTENT).join(', ')}`);
  }

  // needs_retrieval
  if (typeof raw.needs_retrieval !== 'boolean') {
    errors.push('needs_retrieval must be a boolean');
  }

  // queries
  if (!Array.isArray(raw.queries) || raw.queries.length === 0 || raw.queries.length > 3) {
    errors.push('queries must be an array of 1–3 strings');
  }

  // k
  if (typeof raw.k !== 'number' || raw.k < 1 || raw.k > K_MAX) {
    errors.push(`k must be a number between 1 and ${K_MAX}`);
  }

  // requires_actuals
  if (typeof raw.requires_actuals !== 'boolean') {
    errors.push('requires_actuals must be a boolean');
  }

  // wants_score_tool — optional, older/simpler responses may omit it
  if ('wants_score_tool' in raw && typeof raw.wants_score_tool !== 'boolean') {
    errors.push('wants_score_tool must be a boolean when present');
  }

  // missing_inputs
  if (!Array.isArray(raw.missing_inputs)) {
    errors.push('missing_inputs must be an array (can be empty)');
  }

  // CLARIFY consistency: if missing_inputs is non-empty, intent must be CLARIFY
  if (Array.isArray(raw.missing_inputs) && raw.missing_inputs.length > 0 && raw.intent !== INTENT.CLARIFY) {
    errors.push('intent must be CLARIFY when missing_inputs is non-empty');
  }

  // filters — only validate if present
  if (raw.filters) {
    if (raw.filters.unit_id && !UNIT_IDS.includes(raw.filters.unit_id)) {
      errors.push(`filters.unit_id "${raw.filters.unit_id}" is not a known unit`);
    }
    if (raw.filters.subdivision && !Object.values(SUBDIVISION).includes(raw.filters.subdivision)) {
      errors.push(`filters.subdivision must be "templates" or "data"`);
    }
    if (raw.filters.document_class && !Object.values(DOCUMENT_CLASS).includes(raw.filters.document_class)) {
      errors.push(`filters.document_class "${raw.filters.document_class}" is not a known class`);
    }
    if (raw.filters.k > K_MAX) {
      errors.push(`k ${raw.filters.k} exceeds hard cap of ${K_MAX}`);
    }
  }

  // reasoning
  if (raw.reasoning) {
    const wordCount = raw.reasoning.trim().split(/\s+/).length;
    if (wordCount > 15) {
      errors.push(`reasoning exceeds 15 words (${wordCount} words)`);
    }
  }

  return { valid: errors.length === 0, errors, plan: raw };
}

// ── Parse raw LLM response → validated plan ──────────────────────────────────
export function parsePlannerResponse(rawText) {
  try {
    // Strip any accidental markdown fences
    const cleaned = rawText
      .replace(/```json\n?/gi, '')
      .replace(/```\n?/gi, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    return validatePlannerResponse(parsed);
  } catch (err) {
    return {
      valid:  false,
      errors: [`JSON parse failed: ${err.message}`],
      plan:   null,
      raw:    rawText,
    };
  }
}

// ── Fallback plan when the LLM call fails or is not yet connected ─────────────
export function buildFallbackPlan({ userTurn, callerRole, unitId }) {
  const lower = userTurn.toLowerCase();

  // Detect CLARIFY — missing inputs for estimation
  const estimationKeywords = ['estimate', 'effort', 'fte', 'cost', 'size', 'scope'];
  const isEstimation = estimationKeywords.some((k) => lower.includes(k));
  const missingInputs = isEstimation
    ? ['delivery_model', 'scope_modules', 'offshore_ratio']
    : [];

  // Detect CALIBRATE
  const isCalibrate = /calibrat|varianc|baseline|actuals|compare/.test(lower);

  // Detect ASSESS_RISK
  const isRisk = /risk|confidence|exposure|gap|concern/.test(lower);

  // k selection
  const k = /method|guideline|compar|overview/.test(lower) ? K_BROAD : K_DEFAULT;

  const intent = missingInputs.length > 0
    ? INTENT.CLARIFY
    : isCalibrate  ? INTENT.CALIBRATE
    : isRisk       ? INTENT.ASSESS_RISK
    : INTENT.RETRIEVE;

  // wants_score_tool heuristic: real scoring requests both name
  // scoring-adjacent concepts AND carry actual numbers (module counts,
  // durations, ratios) — a vague risk question with no numbers stays false.
  const scoreToolKeywords = /score|risk band|overrun|deviation|complexity|modules?|integrations?|entities|team size/i;
  const numberCount = (userTurn.match(/\d/g) || []).length;
  const wantsScoreTool =
    (intent === INTENT.ESTIMATE || intent === INTENT.ASSESS_RISK) &&
    numberCount >= 3 && scoreToolKeywords.test(userTurn);

  return {
    intent,
    needs_retrieval:  !missingInputs.length,
    filters: {
      ...(unitId ? { unit_id: unitId } : {}),
      subdivision:    lower.includes('template') ? SUBDIVISION.TEMPLATES : SUBDIVISION.DATA,
    },
    queries:          [
      userTurn.replace(/\b(can you|please|tell me|i need|what is|how do)\b/gi, '').trim().slice(0, 80),
    ],
    k,
    requires_actuals: isCalibrate,
    missing_inputs:   missingInputs,
    wants_score_tool: wantsScoreTool,
    reasoning:        'Fallback plan — LLM planner not connected.',
    _fallback:        true,
  };
}
