/**
 * EVA Response System — interim keyword-matched replies
 *
 * IMPORTANT: These are placeholder responses used while the live LLM/RAG
 * backend is being connected. All replies adhere to EVA's R7 (brevity) and
 * R8 (explicit uncertainty) rules — no marketing language, no exclamation marks,
 * no leading phrases like "Great question" or "Certainly".
 *
 * When the LLM backend is live, `sendMessage` in useEVA.js will call
 * buildEVAPrompt() → POST /api/eva instead of matching against this file.
 */

// ── Legacy trigger classifiers (kept for backward compatibility) ──────────────
export const CLASSIFIERS = {
  t1: { label: 'Retrieve',  color: 't1', trigger: 't1' },
  t2: { label: 'Estimate',  color: 't2', trigger: 't2' },
  t3: { label: 'Calibrate', color: 't3', trigger: 't3' },
  t4: { label: 'Calibrate', color: 't4', trigger: 't4' },
  t5: { label: 'Retrieve',  color: 't5', trigger: 't5' },
};

// ── Keyword-matched interim responses ─────────────────────────────────────────
export const RESPONSES = [
  {
    trigger: 't1',
    match: ['how', 'what', 'method', 'methodology', 'explain', 'guide', 'learn',
            'understand', 'difference', 'type', 'rom', 'bottom', 'analogous',
            'parametric', 'glossary', 'mean', 'start', 'template', 'best practice'],
    reply: `Calibre supports **4 estimation techniques**:\n\n| Technique | Accuracy Band | When to use |\n|---|---|---|\n| ROM | −25% to +75% | Early feasibility, no WBS |\n| Analogous | ±10–20% | Similar past project available |\n| Parametric | ±10–15% | Statistical drivers known |\n| Bottom-Up | ±5–10% | Full WBS, highest confidence |\n\nWhich technique applies to your current programme? I can retrieve the relevant guideline or template.`,
  },
  {
    trigger: 't2',
    match: ['estimate', 'create', 'new', 'project', 'build', 'calculate', 'effort',
            'cost', 'price', 'quote', 're-estimate', 'reestimate', 'view', 'open',
            'show', 'oracle', 'fusion', 'erp', 'crm', 'mes', 'sap', 'salesforce'],
    reply: `To produce an estimate, I need:\n\n• **BU** — which business unit (ESU, ADM, ITIS, IAE…)\n• **Programme type** — ERP, custom dev, infra, integration…\n• **Scope inputs** — functional points, modules, or workstreams\n• **Delivery model** — onsite / offshore / hybrid ratio\n\nProvide those and I will apply the applicable standard template [template-default] and return an effort range with a confidence band [R8].`,
  },
  {
    trigger: 't3',
    match: ['compare', 'benchmark', 'baseline', 'variance', 'accuracy', 'against',
            'historical', 'actuals', 'better', 'worse', 'validate', 'calibrat'],
    reply: `Calibration requires:\n\n1. **Your submitted estimate** — total effort in person-days, by workstream\n2. **Reference set** — I will pull the applicable baseline from KnowledgeHub [benchmark] or historical actuals [actual]\n3. **Variance threshold** — default is ±15%; flag if you need a tighter band\n\nShare the estimate and I will run the comparison and state confidence [R8].`,
  },
  {
    trigger: 't4',
    match: ['calibrate', 'tune', 'adjust', 'weight', 'parameter', 'model',
            'improve', 'engine', 'tweak', 'configure', 'train'],
    reply: `Model calibration (adjusting weights, tuning parameters) is restricted to **Admin / COE** and **Unit SME** roles.\n\nIf you want to flag a systematic bias or submit actuals for calibration, contact your **Unit SME** — that is the correct route.`,
  },
  {
    trigger: 't5',
    match: ['context', 'maintain', 'data', 'reference', 'unit', 'definition',
            'knowledge', 'library', 'base', 'rate card', 'ratecard', 'maintain'],
    reply: `Knowledge context management (rate libraries, reference data, context ingestion) is restricted to **Admin / COE** and **Unit SME** roles.\n\nEstimators can query published context by asking: "Show me the [BU] guidelines for [topic]."`,
  },
];

// ── Default fallback (R2 — abstention over fabrication) ───────────────────────
export const DEFAULT_REPLY = {
  trigger: null,
  reply: `EVA handles four functions: **Retrieve**, **Estimate**, **Calibrate**, **Assess**.\n\nState your request in terms of one of those functions — or ask about a specific BU, template, or programme type — and I will route it correctly or flag what context is needed.`,
};

// ── Role-specific suggestion chips ────────────────────────────────────────────
export const SUGGESTIONS = {
  // Executive persona: framed around decisions, not estimator mechanics —
  // and deliberately free of scenario/rate-card prompts, which this role is
  // not authorised to run or see.
  senior_mgmt: [
    'Summarise the current estimate for me',
    'What is the risk on this estimate?',
    'How does this compare with historical projects?',
    'What are the biggest risks in this estimate?',
    'What does AMBER mean?',
  ],
  admin: [
    'Show pending calibration reviews',
    'What is parametric estimation?',
    'Compare recent estimates vs benchmarks',
    'How do I review a Super User draft?',
    'Which BU templates need updating?',
  ],
  sme: [
    'What estimation requests need my review?',
    'How do I validate a Bottom-Up estimate?',
    'Show IAE estimation guidelines',
    'What is acceptable variance for ERP projects?',
    'How do I submit actuals for calibration?',
  ],
  estimator: [
    'How do I start a new estimate?',
    'What technique suits an ERP implementation?',
    'What is ROM estimation?',
    'How accurate is bottom-up estimating?',
    'What inputs do I need for an IAE estimate?',
  ],
  super: [
    'Show estimates pending my review',
    'How do I review and approve a draft estimate?',
    'What is variance analysis?',
    'Compare estimates vs actuals for my BU',
    'What accuracy range is acceptable?',
  ],
  senior: [
    'Show programme estimates under my unit',
    'What is the confidence band on the current estimate?',
    'How do actuals compare to estimates this quarter?',
    'What risks are flagged in the ITIS estimates?',
    'Summarise estimation status for my portfolio',
  ],
};

// ── Restricted access response (R5 — second-line role gate) ───────────────────
export const RESTRICTED_REPLY = (roleLabel, triggerLabel) =>
  `**${triggerLabel}** is restricted to **Admin / COE** and **Unit SME** roles.\n\nCurrent role **${roleLabel}** does not have access. Contact your Admin / COE to request elevation or to perform the action on your behalf.`;
