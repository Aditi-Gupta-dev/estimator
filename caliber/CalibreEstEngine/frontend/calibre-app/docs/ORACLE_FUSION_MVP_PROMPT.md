# Oracle Fusion MVP — Build Specification & Grounding Prompt

**Purpose of this document:** a single, self-contained brief that can be handed to an engineering agent (or a team) to build the first Calibre MVP — a domain-aware Oracle Fusion Cloud estimation and calibration engine for the ESU business unit. Every number, rule, and threshold below is copied from the five source documents in `KnowledgeHub/ESU/` — nothing here is invented. Where a document conflicts with itself or with another document, that is called out explicitly rather than silently resolved, because those are exactly the decisions the build team needs to make consciously.

**Source documents read to produce this spec:**
- `Oracle_Fusion_Calibration_Guideline.docx` — EST-CAL-GUIDE-001 v1.0
- `Oracle_Fusion_Domain_POV.docx` — OFP-POV-DOMAIN-001 v1.0
- `Oracle_Fusion_Local_AI_Strategy_1.docx` — EST-AI-STRATEGY-001 v1.0 (CONFIDENTIAL / RESTRICTED)
- `Oracle_Fusion_Estimator_v3_1.xlsx` — the current "HL Estimator" workbook referenced throughout the Calibration Guideline
- `Oracle_Fusion_Detailed_Estimator_v2.xlsx` — an earlier estimator variant (different sheet structure — see §7.3)
- Existing Calibre code: `eva-system-prompt.js`, `eva-retrieval-planner.js`, `upload-routing-prompt.js`, `roles.js`, `subdivisions.js`

---

## 1. Mission

Build the first working slice of Calibre's Estimation & Calibration Engine, scoped to **Oracle Fusion Cloud implementations under the ESU business unit only**. Everything else in the platform (other 8 BUs, other program types) stays exactly as it is today — a role-aware shell with mock data. This MVP is the first place real methodology, real benchmark data, and real grounded AI reasoning go live.

The MVP must do four things, matching the four EVA functions already defined in `eva-system-prompt.js`:

1. **RETRIEVE** — answer questions from the Calibration Guideline and the Domain POV.
2. **ESTIMATE** — produce a component-level effort/FTE/cost estimate using the HL Estimator methodology, with domain-specific adjustments applied automatically.
3. **CALIBRATE** — score a completed estimate against the 500-project execution dataset using the five-dimension Benchmark Confidence Score (BCS).
4. **ASSESS** — state a risk narrative and confidence band, grounded in named comparator projects, never fabricated.

## 2. The non-negotiable architecture principle: data sovereignty

This is the single most important constraint in this build, and it comes directly from `Oracle_Fusion_Local_AI_Strategy_1.docx` (classification: CONFIDENTIAL — Internal execution data must not leave organisational boundary):

> All ML inference, model training, fine-tuning, and calibration involving organisational execution data MUST occur entirely within the organisational boundary. No execution data record, embedding, or derived artefact may be transmitted to an external API endpoint for any purpose without explicit DPO and Legal sign-off.

**This directly conflicts with how EVA is currently architected.** `eva-system-prompt.js` assumes RAG chunks go into an LLM (per root `CLAUDE.md`, `OPENAI_API_KEY` — i.e. a public API) for grounded reasoning. If the 500-project execution dataset is treated like any other RAG-retrievable KnowledgeHub asset, raw project actuals — client-adjacent data, SI performance data, margin-correlated effort — would be sent to OpenAI. **That is exactly what the AI Strategy document prohibits.**

The resolution, and it is already designed in the AI Strategy doc (Pattern 2, "SLM as Explanation Layer Only" — read literally as "external-LLM-as-explanation-layer-only" for this MVP): **split what's retrievable from what's queryable.**

| Content | Where it lives | What touches the LLM |
|---|---|---|
| Calibration Guideline text, Domain POV text, Estimator instructions/README | KnowledgeHub RAG (pgvector), same as any other KnowledgeHub asset | Full text, verbatim — this is published internal methodology, not client data |
| 500-project execution dataset (Project Master, Phase-Wise Effort, Component Actuals) | PostgreSQL tables, **never embedded, never chunked, never sent as free text** | **Only derived, aggregated numbers**: P50/P75/P90 effort, BCS score per dimension, comparator count, median deviation %, RAG rating — computed by SQL/a local calibration engine, then formatted into the `<context>` block that EVA's existing R6 (Provenance Separation) rule already expects |
| Rate cards, cost rates | PostgreSQL, restricted | Never — R5 in `eva-system-prompt.js` already forbids this for Estimator/Senior Management; extend the same restriction here for Super User/SME on cross-unit data |

Practically: the classical-ML / calibration engine described in the AI Strategy's **Pattern 1** is not optional infrastructure to build "later" — it is the thing that stands between the execution dataset and the LLM. Without it, the only way to answer "how does this estimate compare to history" is to hand the LLM raw project rows, which is prohibited. **Build Pattern 1 before wiring EVA's CALIBRATE/ASSESS functions to real data.**

## 3. Tech stack (per root `CLAUDE.md` + this MVP's needs)

- **Frontend:** the existing `calibre-app` React 19 + Vite shell — reuse `RoleContext`, `EVA` panel, `KnowledgeHubPage`, and the `/estimate/*` route family. Do not fork a new UI.
- **Database:** PostgreSQL (already the org standard — see root `CLAUDE.md`; `pgvector` is not yet installed and needs adding for the RAG layer). SQLite is acceptable only for local dev/offline prototyping of the calibration engine, never for the shared execution dataset.
- **Calibration engine:** Python, scikit-learn + XGBoost + SHAP, served via FastAPI (matches the AI Strategy's own Phase 1 recommendation almost verbatim — see §6).
- **LLM:** whatever backs EVA today (OpenAI per root `CLAUDE.md`) — but only ever receives derived numbers and non-sensitive methodology text, never raw execution rows (§2).

## 4. Scope boundary for the MVP

In scope:
- Business unit: **ESU** only.
- Program type: **`oracle`** only (per `program_type` whitelist already defined in `business-units.js` for ESU).
- All 8 domains from the POV (BFSI, Manufacturing, Retail & CPG, Healthcare, Energy & Utilities, Public Sector, Professional Services, Logistics) — the POV explicitly treats domain as a pre-estimation qualifier applied *within* Oracle Fusion, not a separate BU, so all 8 should be selectable in the MVP's domain-qualification step.
- The HL Estimator v3.1 structure (Cover → Assumptions → Module Estimator → Benchmark Library → Effort Summary → FTE & Role Plan → Assumptions & Risks → Cost Model).
- BCS calibration scoring end to end.

Explicitly out of scope for this MVP (defer to later phases per the AI Strategy's own roadmap, §6):
- Fine-tuned local SLM (Pattern 2) and RAG-over-execution-data (Pattern 3) — build the classical ML layer (Pattern 1) first; add narrative generation via the existing (external) EVA LLM using only derived numbers, which achieves the same user-facing outcome without the GPU infrastructure Pattern 2 requires.
- Federated learning (Pattern 4) — explicitly a 18–24 month, N>2,000-project capability.
- The other 8 BUs and their program types.

## 5. Data model

### 5.1 The Oracle Fusion Execution Dataset (the "actuals" — enterprise-wide, security-critical)

Per the Calibration Guideline §1.1 and the AI Strategy §4, this is five tables, not one:

| Table | Rows (at MVP baseline) | Grain | Key fields (from source) |
|---|---|---|---|
| `project_master` | 500 | 1 row per project | project_id (`OFP-####`, never a real client name), industry/domain, complexity code (L/M/H/VH), module count, legal entities, duration, SI firm (anonymised `SI-A`/`SI-B`…), benchmark total, actual total, deviation %, project health (Smooth/Normal/Troubled/Critical), go-live year |
| `phase_wise_effort` | 5,000 (500 × 10 phases) | 1 row per project per SDLC phase | project_id, phase code, actual phase effort, planned phase effort, deviation %, deviation reason (from a standard reason library) |
| `component_actuals` | ~2,730 | 1 row per project per component | project_id, component name, complexity level, actual days, benchmark days |
| `calibration_benchmarks` | aggregated | derived stats table | deviation percentiles by complexity / phase / industry / SI firm |
| `calibration_factors` | ready-to-use | derived stats table | P25/P50/P75/P90 multipliers per phase and complexity — these are what actually get applied to a new estimate |

**Data quality rules for inclusion (Calibration Guideline §6.2, verbatim — enforce these at ingestion, not as documentation)**:
1. Only projects where all 10 SDLC phase actuals are available may be added; blended T&M projects with no phase breakdown are excluded until reconstructed.
2. Phase actuals must sum to within 5% of total project effort; outliers require a documented explanation.
3. Minimum dataset size for statistically reliable calibration is N=200. Below that, weight internal data at 30% and published benchmarks at 70% (this blending rule should be a config value, not hardcoded).
4. Projects with abnormal external events (pandemic, client acquisition mid-project) are tagged, excluded from core calibration, retained for scenario analysis only.

**Anonymisation requirements before any of this touches the ML pipeline (AI Strategy §6.3, verbatim)**: remove client names → project ID; remove SI firm names if contractually sensitive → `SI-A`/`SI-B`; remove go-live dates if re-identifying; remove free-text fields that could identify a client; run a k-anonymity check (no combination of industry + modules + N-entities + go-live year may uniquely identify one client); store the ID→real-client mapping in a separately controlled system that the ML pipeline never touches.

### 5.2 The estimate itself (per-engagement, matches HL Estimator v3.1 sheets)

- **Assumptions** (Section A: project parameters — duration, modules, entities, integrations simple/complex, DM objects, reports, CEMLI, contingency %, onshore/offshore split; Section B: rate card by role; Section C: complexity multipliers L=0.7/M=1.0/H=1.4/VH=1.9; Section D: SDLC phase % splits).
- **Module Estimator** — one row per component (68 rows in the shipped template) with: module/pillar, component, complexity (L/M/H/VH), volume driver, unit effort (days, OOB benchmark), benchmark source, 5-way phase split, complexity multiplier, base effort, adjusted effort, primary role. **Base Effort = Volume Driver × Unit Effort. Adjusted Effort = Base Effort × Complexity Multiplier.** These are the only two formulas in the entire estimator — everything else rolls up from them.
- **FTE & Role Plan** — 13 roles, monthly FTE ramp across the project duration, `FTE = Effort Days ÷ 20 working days/month`.
- **Cost Model** — effort × blended rate (onshore/offshore weighted) by role band, plus contingency.

### 5.3 The volume-driver distinction (README §4 — this is the single most consequential modeling rule in the whole system)

Components split into two categories and the estimator must never treat them the same way:

- **Category A — Configuration components** (General Ledger, Payroll Run, Security RBAC, etc.): volume = 1 in almost all cases. Increase only when the same component is genuinely deployed multiple times (e.g. Payroll × 3 countries).
- **Category B — Countable/repeating objects** (integrations, migration templates, reports, CEMLI extensions): volume = the actual count, confirmed via a discovery workshop, not a business-team guess. The README gives worked magnitude examples: integrations 17→30 = +78 days; migration objects 15→40 = +100 days; reports 20+10→40+20 = +80 days — three categories alone can swing an estimate by 250+ days. **The MVP's UI must force volume-driver entry for Category B components through a discovery-workshop-confirmed flag, not a free-text guess**, and should warn when a volume changes by more than ~40% between estimate revisions.

## 6. The domain-adjustment layer (from the POV — this is what makes the MVP "Oracle Fusion aware" rather than a generic estimator)

The POV's own final perspective is the design instruction: *"Domain context is not a modifier applied at the end of estimation — it is the starting frame... The estimator who begins with module count and adds domain adjustments afterward will consistently under-estimate."* So the MVP's flow must be: **domain qualification first, module estimate second** — not the reverse.

### 6.1 Five-question domain qualification (POV, "Applying this POV" — implement as the first screen of the estimate wizard)

1. Primary industry / regulatory regime → sets the minimum complexity floor and mandatory compliance workstreams.
2. Legal entities / countries / currencies in scope → drives FCCS/intercompany effort (18 days/entity beyond 3; escalate to VH if >10 entities with complex eliminations).
3. Technology integration landscape (walk the client's actual systems) → validate against the domain's minimum integration count table (§6.3) before accepting the business team's number — the POV states client-stated counts are typically only 40–60% of actual scope.
4. Source data location and condition → apply the domain's DM uplift multiplier (§6.3).
5. Go-live date driver (business readiness vs. external constraint) → if externally constrained, add 15–20% to SIT/UAT.

### 6.2 Domain snapshot data (all 8 domains, condensed from the POV's per-domain tables)

| Domain | Min complexity | Modules | Integrations (S/C) | DM objects | Duration | Uplift vs generic | Highest-risk phase |
|---|---|---|---|---|---|---|---|
| BFSI | H (VH cross-border) | 5–8 | 12–25 / 8–18 | 12–25 | 18–30mo | +35–55% | Build + SIT |
| Manufacturing | H (VH multi-plant) | 5–8 | 15–30 / 10–20 | 18–35 | 18–30mo | +40–60% | Build + Data Migration |
| Retail & CPG | M–H | 4–6 | 15–25 / 5–12 | 12–20 | 12–20mo | +20–35% | SIT + Go-Live |
| Healthcare | H (VH Life Sci GxP) | 4–7 | 8–18 / 5–12 | 12–22 | 16–28mo | +40–60% | Design + UAT |
| Energy & Utilities | H (VH trading ops) | 5–8 | 10–20 / 8–15 | 15–30 | 18–28mo | +35–55% | Data Migration + Build |
| Public Sector | H mandatory | 4–7 | 8–15 / 4–8 | 10–20 | 18–30mo | +30–50% | Discover/Design + OCM |
| Professional Services | M–H | 4–6 | 8–15 / 4–8 | 10–18 | 12–20mo | +20–35% | Build + Design |
| Logistics & SCM | H (VH global) | 4–6 | 20–50 / 10–20 | 12–22 | 14–22mo | +30–50% | Integration & SIT |

Each domain also carries: a fixed list of always-in-scope modules plus domain-specific scope additions (e.g. BFSI adds Regulatory Reporting Config, IFRS 9/17 Provisioning; Manufacturing adds MES/Shop-Floor Integration, PLM Integration); a per-driver uplift table with named estimator actions (e.g. "Core banking integration: budget 20–35 days per interface, not 6–14"); a phase-adjustment delta table (all 8 domains' adjusted SDLC % splits are in the POV's comparative summary); and a "top 5 under-priced risks" list per domain, each with a concrete day-range fix. **All of this is structured, tabular, and near-deterministic — implement it as lookup tables in the database, not as something the LLM has to recall from a document.** The LLM's job is to explain *why* a lookup fired, not to know the numbers.

### 6.3 Minimum integration count validation (POV, verbatim instruction)

*"Always validate client-stated integration counts against these domain minimums before finalising an estimate. Client-stated counts are typically 40–60% of actual implementation scope."* Implement as a hard UI warning (not a block) when the entered simple/complex integration count is below the domain's stated minimum.

## 7. The calibration & scoring engine (Calibration Guideline — implement exactly as specified, this is the most numerically precise document of the five)

### 7.1 Three-level calibration (a periodic COE activity against the execution dataset, not a per-estimate action)

| Level | What's updated | Frequency | Rule |
|---|---|---|---|
| L1 — Unit Effort | Module Estimator col F (unit effort per component) | Quarterly | Filter component actuals by module + matching complexity (M/H) + min 20 observations → replace benchmark unit effort with P50 → flag components where P90/P50 > 2.0 as high-variance (never estimate these at P50 for fixed-price work) |
| L2 — Complexity Multipliers | Assumptions Section C | Bi-annual | actual/benchmark ratio by complexity code, P50 per group. **Do not update VH unless ≥15 VH observations** — sample too small below that |
| L3 — SDLC Phase Splits | Assumptions Section D | Annual | avg(actual phase effort) ÷ avg(actual total effort); verify phases still sum to 100%; sanity-check against 3 recently completed projects, verify actuals fall within P25–P75 of the recalibrated output |

### 7.2 Benchmark Confidence Score (BCS) — five weighted dimensions

This is the core "ASSESS" output and must be computed exactly this way — it is not a place for LLM judgment:

| # | Dimension | Weight | Formula | Green | Amber | Red |
|---|---|---|---|---|---|---|
| 1 | Effort Density vs Benchmark | 30% | Total est. days ÷ (N modules × project months), vs comparator pool P50 | within ±15% | 15–35% below | >35% below |
| 2 | Phase Distribution Alignment | 20% | each phase % vs calibrated Section D split | all phases within ±5pp | 1–2 phases >10pp off | >2 phases >10pp off |
| 3 | Integration Effort Coverage | 20% | Est. integration days ÷ `(N_simple×6 + N_complex×14) × CX_mult` | ≥85% coverage | 65–85% | <65% |
| 4 | Data Migration Coverage | 15% | Est. DM days ÷ `N_objects×4.5×CX_mult` | ≥85% coverage | 65–85% | <65% |
| 5 | Contingency Adequacy | 15% | Contingency % vs complexity-specific P50 minimum | ≥P50 rate | P25–P50 | <P25 rate |

Score each dimension Green=3/Amber=2/Red=1 (Blue/Conservative scores as Green=3, but should be separately flagged as "may be over-staffed"), multiply by weight, sum. **BCS thresholds and required actions**:

| BCS | Rating | Historical on-budget probability | Required action |
|---|---|---|---|
| 2.5–3.0 | GREEN | >65% | Proceed to submission |
| 2.0–2.4 | AMBER | 40–65% | Mandatory peer review; re-score after revision |
| 1.5–1.9 | RED | 25–40% | Estimation CoE review + Delivery Director sign-off required |
| <1.5 | CRITICAL | <25% | Must not submit; full re-estimation; escalate to Head of Delivery |

Comparator pool selection rule (verbatim): match complexity ±1 level, module count ±2, industry if ≥10 available else all industries, minimum 20 comparators or broaden filters. **This pool selection, the density/coverage math, and the BCS arithmetic are all deterministic SQL/Python — none of it should be delegated to the LLM.**

### 7.3 Contingency minimums (apply before submission, verbatim table)

| Complexity | P50 | P75 | Fixed-price |
|---|---|---|---|
| L — Low | 15% | 20% | 25% |
| M — Medium | 18% | 25% | 30% |
| H — High | 22% | 30% | 40% |
| VH — Very High | 30% | 40% | 50% |

### 7.4 Stream coverage formulas (verbatim, used in BCS dimensions 3 & 4)

```
Simple integrations   = N_Simple  × 6.0  × CX_Mult
Complex integrations  = N_Complex × 14.0 × CX_Mult
Data migration        = N_Objects × 4.5  × CX_Mult
Reporting (standard)  = N_Reports × 1.5   (no CX multiplier)
CEMLI / Extensions    = N_CEMLI   × 8.0  × CX_Mult
```
Note the POV recommends a **1.4× logistics-specific multiplier** on the simple-integration formula for that one domain ("logistics programmes should budget `(N_simple×4 + N_complex×14) × 1.4`, not 1.0×") — domain adjustment tables (§6.2) should be able to override these base coefficients per domain, not just the complexity multiplier.

### 7.5 A real inconsistency to resolve before building (found, not invented)

The shipped `Oracle_Fusion_Estimator_v3_1.xlsx` **`Effort Summary` tab is disconnected from `Module Estimator`.** Its "Base Effort" column is hardcoded literal numbers (`24`, `24`, `24`, `12`, `96`…) that do not reference any Module Estimator row, and its "Complexity Adj." column is `=C5*1.15` — a flat 15% uplift applied uniformly to every module, which has nothing to do with the actual per-component L/M/H/VH multipliers (0.7×/1.0×/1.4×/1.9×) computed correctly in Module Estimator. The totals genuinely don't reconcile (Module Estimator totals 1,491/1,835.7 base/adjusted days; Effort Summary totals 794/913.1). **Do not port the Effort Summary tab's formulas into the MVP.** The backend must recompute every roll-up (by module, by phase) directly from Module Estimator's row-level `volume × unit_effort × complexity_multiplier`, using each row's own 5-way phase-split columns — never trust a pre-aggregated tab as source of truth, in this workbook or any future one ingested the same way.

### 7.6 A second inconsistency: three competing phase taxonomies

- Calibration Guideline: **10 phases** (Ph0 Inception … Ph9 Hypercare), used in the BCS worked example and the domain phase-adjustment tables in the POV.
- Assumptions tab / Effort Summary (v3.1): **9 phases** (merges SIT+UAT into one "Integration & Testing" line).
- Module Estimator row columns: **5 phases** (Discover / Design / Build / Test / Deploy) — "Deploy" appears to absorb Data Migration, Training, Go-Live, and Hypercare for most rows, but Data Migration rows have their own distinct 5-column split that doesn't map cleanly onto the other two taxonomies either.

**Pick the Calibration Guideline's 10-phase taxonomy as canonical** — it's what the BCS scoring and the POV's domain adjustment tables are actually built around — and store an explicit mapping table (`phase_taxonomy_map`) from the Module Estimator's 5 columns and the Assumptions tab's 9 rows onto it, rather than silently picking whichever one a given screen happens to read from.

## 8. RAG / retrieval design — extending, not replacing, the existing EVA prompt layers

The codebase already has a 3-layer prompt architecture (`eva-retrieval-planner.js` → retriever → `eva-system-prompt.js`). This MVP extends it, it does not replace it:

- **Planner** (`eva-retrieval-planner.js`): already has `unit_id`, `subdivision`, `program_type`, `document_class` filters. Add one field: `domain` (bfsi | manufacturing | retail | healthcare | energy | public_sector | professional_services | logistics | null), populated from the active estimate's domain qualification (§6.1), not guessed by the LLM — same "never guess unit_id" rule in the planner prompt should extend to `domain`.
- **Retriever**: two separate paths, matching §2's data-sovereignty split —
  - Path A (RAG, safe to embed): Calibration Guideline + Domain POV text, chunked per subdivision (`guidelines`, per existing `subdivisions.js`) and per domain section.
  - Path B (SQL/calibration engine, never embedded): execution dataset queries, returning only P50/P75/P90, BCS score, comparator count, deviation %, phase-level flags — formatted as `[C#]` context chunks with `source: 'calibration-engine'` so `eva-system-prompt.js`'s existing provenance rules (R6) can label them `[benchmark]` or `[actual]` correctly.
- **System prompt** (`eva-system-prompt.js`): no changes needed to R1–R8 — they already require citations, provenance separation, and abstention-over-fabrication, which is exactly the discipline this MVP's numbers need. What's missing is Oracle-Fusion-specific *content* to reason over: add a companion prompt fragment (new file, e.g. `oracle-fusion-scoring-prompt.js`, same pattern as `upload-routing-prompt.js`) that injects the BCS rubric (§7.2), the contingency table (§7.3), and the active domain's uplift table (§6.2) into the `<context>` block as `[template-default]`-provenance facts, so EVA can explain *why* a BCS dimension scored Amber without inventing the thresholds.

## 9. RBAC extensions

Existing `PERMISSIONS` in `roles.js` already has `estimate.*`, `benchmark.*`, `calibrate.*` scoped correctly. Add one new permission the current matrix doesn't have, because the execution dataset is more sensitive than a normal KnowledgeHub `data` asset:

```js
'dataset.execution.view.raw':   ['admin'],           // raw project_master / phase_wise_effort / component_actuals rows
'dataset.execution.view.agg':   ['admin', 'super'],  // aggregated calibration_benchmarks / calibration_factors only
```
Estimator and Senior Management should see BCS scores and risk narratives (derived output) but never the underlying comparator project rows — consistent with the AI Strategy's "even anonymised data can be re-identified" risk and with the existing R5 rule's spirit.

## 10. Build sequencing (adapted directly from the AI Strategy's own roadmap, re-scoped to Oracle Fusion/ESU only)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 | 1–2 | Ingest the 5 ESU documents: Guideline + POV into KnowledgeHub RAG (Path A); Estimator v3.1's Assumptions/Module Estimator/Benchmark Library parsed into the Postgres schema (§5); execution dataset schema created (empty until real project actuals exist — seed with the Guideline's worked examples for dev/testing only, clearly flagged as synthetic) |
| 2 | 3–4 | Domain qualification wizard (§6.1) + Module Estimator UI (reusing `KnowledgeHub`/`ROICostCalculatorPage`-style component patterns already in `calibre-app`) computing Base/Adjusted Effort correctly (fixing §7.5's bug from day one) |
| 3 | 5–6 | Classical ML / calibration engine (AI Strategy Pattern 1): XGBoost + SHAP, FastAPI endpoint, BCS scoring exactly per §7.2 |
| 4 | 7–8 | EVA integration: extend planner with `domain`, add `oracle-fusion-scoring-prompt.js`, wire CALIBRATE/ASSESS to the FastAPI calibration engine's output (never raw rows) |
| 5 | 9+ | Pilot with real (anonymised) ESU Oracle Fusion actuals as they become available; defer Pattern 2 (local SLM) and Pattern 3 (RAG-over-execution-data) until Pattern 1 is validated against real outcomes, per the AI Strategy's own "do NOT start with an LLM API" / "classical ML first" guidance |

## 11. Definition of done for the MVP

- [ ] An estimator can complete the 5-question domain qualification and see the applicable complexity floor, module list additions, and integration-count minimums before entering a single component row.
- [ ] Module Estimator UI computes Base/Adjusted Effort/FTE/Cost correctly and *independently* of any hardcoded roll-up (no repeat of §7.5).
- [ ] A completed estimate can be scored against the execution dataset and returns a BCS with all 5 dimensions, correct RAG thresholds, and the exact required-action text per §7.2's table.
- [ ] EVA can explain a BCS result in natural language, citing `[C#]` sources, never stating a number that isn't traceable to the calibration engine or the guideline — i.e. R1–R8 hold under real data, not just mock data.
- [ ] No raw `project_master` / `phase_wise_effort` / `component_actuals` row is ever serialized into an LLM prompt — verify by tracing the actual API payload sent to the LLM provider during a CALIBRATE call, not just by code review.
- [ ] Estimator and Senior Management personas cannot query raw execution-dataset rows through any route, including EVA (per §9).
