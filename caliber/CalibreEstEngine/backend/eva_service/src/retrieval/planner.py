"""EVA Retrieval Planner — ported 1:1 from
frontend/calibre-app/src/constants/eva-retrieval-planner.js (source of
truth). Converts a user turn + session facts into a structured JSON
retrieval plan that drives the SQLite metadata pre-filter and vector fetch.

Pipeline position:
  User turn -> [PLANNER] (this module) -> JSON retrieval plan
            -> [RETRIEVER] -> ranked <context> chunks -> [EVA_SYSTEM_PROMPT]

Kept in sync manually with the JS source; this is the one duplication the
implementation plan calls out explicitly (JS constants aren't importable
from Python).
"""
import json
import re
from dataclasses import dataclass, field

import logging

log = logging.getLogger("eva_service.planner")


# ── Intent enum ──────────────────────────────────────────────────────────────
class INTENT:
    RETRIEVE = "RETRIEVE"
    ESTIMATE = "ESTIMATE"
    CALIBRATE = "CALIBRATE"
    ASSESS_RISK = "ASSESS_RISK"
    NAVIGATE = "NAVIGATE"
    CLARIFY = "CLARIFY"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"

    ALL = {RETRIEVE, ESTIMATE, CALIBRATE, ASSESS_RISK, NAVIGATE, CLARIFY, OUT_OF_SCOPE}


# ── Document class enum (matches KnowledgeHub sidecar `type`) ────────────────
DOCUMENT_CLASSES = {
    "guideline", "template", "pov", "casestudy", "benchmark",
    "ratecard", "actual", "faq", "playbook", "whitepaper",
}

SUBDIVISIONS = {"templates", "data"}

# Real BU folders (fixed — the JS source was missing cyber/ai/datacloud,
# corrected here and in eva-retrieval-planner.js alongside this port).
UNIT_IDS = [
    "esu", "adm", "itis", "bps", "ti", "ion", "bfsi", "iae",
    "cyber", "ai", "datacloud", "_global",
]

K_NARROW = 3
K_DEFAULT = 5
K_BROAD = 8
K_MAX = 8

EVA_PLANNER_PROMPT = """
Convert the user turn into a Calibre retrieval plan. Output ONE JSON object. No prose,
no markdown fences.

SESSION FACTS
  role: {caller_role}            # estimator | sme | admin | super
  active_unit: {unit_id}         # may be null
  active_estimate_id: {estimate_id}   # may be null
  turn_history_summary: {rolling_summary}   # <=80 tokens

DECIDE
1. intent - one of:
     RETRIEVE | ESTIMATE | CALIBRATE | ASSESS_RISK | NAVIGATE | CLARIFY | OUT_OF_SCOPE
2. needs_retrieval - false when the turn is navigational, a pure arithmetic follow-up on
   figures already in the conversation, a clarification of your own last message, or
   answerable from turn_history_summary alone. Default to false when genuinely borderline;
   a wrong false costs one extra turn, a wrong true costs a full retrieval cycle.
3. filters - deterministic metadata pre-filter. Emit ONLY fields you can justify from the
   turn or session facts. Never guess unit_id. Omit rather than guess.
4. queries - 1 to 3 short retrieval strings. Decompose only genuinely multi-part asks
   (e.g. "compare ESU Oracle vs ADM Oracle effort norms" -> 2 queries). Strip stopwords and
   conversational framing; keep domain nouns and template names verbatim.
5. k - chunks to retrieve per query. 3 for a narrow factual lookup, 5 default,
   8 for methodology or comparison. Never exceed 8.
6. requires_actuals - true only if the answer depends on historical delivery data.
7. missing_inputs - named fields the user must supply before an estimate is computable.
   If this array is non-empty, set intent to CLARIFY.
8. wants_score_tool - true only when the user is asking to actually SCORE/COMPUTE a
   project's deviation % or overrun risk (numeric inputs given or clearly implied), not
   just describing or asking about estimation methodology in general. Only meaningful
   for intent ESTIMATE or ASSESS_RISK; false otherwise.

SCHEMA
{{
  "intent": "RETRIEVE",
  "needs_retrieval": true,
  "filters": {{
    "unit_id": "esu",
    "subdivision": "data",
    "program_type": "oracle",
    "file_type": null,
    "document_class": "guideline"
  }},
  "queries": ["oracle fusion CRP cycle effort drivers"],
  "k": 5,
  "requires_actuals": false,
  "missing_inputs": [],
  "wants_score_tool": false,
  "reasoning": "one clause, max 15 words"
}}

RULES
- Output ONLY the JSON object. No prose, no markdown code fences, no trailing text.
- filters.unit_id: use the session active_unit if the user hasn't specified a different one.
  If both are null, omit the field entirely - never guess.
- filters.subdivision: "templates" only when the user explicitly requests a template or
  workbook. All other document classes map to "data".
- queries: strip filler words ("can you", "please", "I need to", "tell me about").
  Keep template names, BU names, programme types, and methodology terms verbatim.
- missing_inputs: name the specific field (e.g. "delivery_model", "scope_modules",
  "offshore_ratio", "contract_type") - not generic phrases like "more information".
- wants_score_tool: true requires concrete project numbers in the turn or recent
  turn_history_summary (module/entity/integration counts, duration, team size, etc.) —
  a vague "what's the risk of ERP projects" is false.
- reasoning: one clause, max 15 words, no hedging. Justify the intent and needs_retrieval
  decision only.
""".strip()


def build_planner_prompt(
    user_turn: str,
    caller_role: str | None = None,
    unit_id: str | None = None,
    estimate_id: str | None = None,
    rolling_summary: str | None = None,
) -> str:
    prompt = EVA_PLANNER_PROMPT.format(
        caller_role=caller_role or "estimator",
        unit_id=unit_id or "null",
        estimate_id=estimate_id or "null",
        rolling_summary=rolling_summary or "no prior context",
    )
    return f"{prompt}\n\nUSER TURN\n{user_turn.strip()}"


@dataclass
class PlanValidation:
    valid: bool
    errors: list[str] = field(default_factory=list)
    plan: dict | None = None


def validate_planner_response(raw: dict) -> PlanValidation:
    errors: list[str] = []

    if not isinstance(raw, dict):
        return PlanValidation(False, ["Response is not a JSON object"], None)

    if raw.get("intent") not in INTENT.ALL:
        errors.append(f"Invalid intent \"{raw.get('intent')}\". Must be one of: {', '.join(sorted(INTENT.ALL))}")

    if not isinstance(raw.get("needs_retrieval"), bool):
        errors.append("needs_retrieval must be a boolean")

    queries = raw.get("queries")
    if not isinstance(queries, list) or not (1 <= len(queries) <= 3):
        errors.append("queries must be an array of 1-3 strings")

    k = raw.get("k")
    if not isinstance(k, (int, float)) or k < 1 or k > K_MAX:
        errors.append(f"k must be a number between 1 and {K_MAX}")

    if not isinstance(raw.get("requires_actuals"), bool):
        errors.append("requires_actuals must be a boolean")

    # Optional — older/simpler planner responses may omit it; graph routing
    # treats absence as "unknown" (falls back to intent==ESTIMATE default).
    if "wants_score_tool" in raw and not isinstance(raw.get("wants_score_tool"), bool):
        errors.append("wants_score_tool must be a boolean when present")

    missing_inputs = raw.get("missing_inputs")
    if not isinstance(missing_inputs, list):
        errors.append("missing_inputs must be an array (can be empty)")

    if isinstance(missing_inputs, list) and len(missing_inputs) > 0 and raw.get("intent") != INTENT.CLARIFY:
        errors.append("intent must be CLARIFY when missing_inputs is non-empty")

    filters = raw.get("filters")
    if filters:
        if filters.get("unit_id") and filters["unit_id"] not in UNIT_IDS:
            errors.append(f"filters.unit_id \"{filters['unit_id']}\" is not a known unit")
        if filters.get("subdivision") and filters["subdivision"] not in SUBDIVISIONS:
            errors.append("filters.subdivision must be \"templates\" or \"data\"")
        if filters.get("document_class") and filters["document_class"] not in DOCUMENT_CLASSES:
            errors.append(f"filters.document_class \"{filters['document_class']}\" is not a known class")

    reasoning = raw.get("reasoning")
    if reasoning:
        word_count = len(reasoning.strip().split())
        if word_count > 15:
            errors.append(f"reasoning exceeds 15 words ({word_count} words)")

    return PlanValidation(len(errors) == 0, errors, raw)


def parse_planner_response(raw_text: str) -> PlanValidation:
    try:
        cleaned = re.sub(r"```json\n?", "", raw_text, flags=re.IGNORECASE)
        cleaned = re.sub(r"```\n?", "", cleaned).strip()
        parsed = json.loads(cleaned)
        return validate_planner_response(parsed)
    except (json.JSONDecodeError, TypeError) as err:
        return PlanValidation(False, [f"JSON parse failed: {err}"], None)


_ESTIMATION_KEYWORDS = ["estimate", "effort", "fte", "cost", "size", "scope"]
_CALIBRATE_RE = re.compile(r"calibrat|varianc|baseline|actuals|compare", re.IGNORECASE)
_RISK_RE = re.compile(r"risk|confidence|exposure|gap|concern", re.IGNORECASE)
_BROAD_RE = re.compile(r"method|guideline|compar|overview", re.IGNORECASE)
_FILLER_RE = re.compile(r"\b(can you|please|tell me|i need|what is|how do)\b", re.IGNORECASE)

# Heuristic for wants_score_tool in the no-LLM fallback path: real scoring
# requests both name scoring-adjacent concepts AND carry actual numbers
# (module counts, durations, ratios) — a vague "what's the risk of ERP
# projects" has the keyword but no numbers, so it stays false.
_SCORE_TOOL_KEYWORDS_RE = re.compile(
    r"score|risk band|overrun|deviation|complexity|modules?|integrations?|entities|team size",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(r"\d")
_SCORE_TOOL_MIN_NUMBERS = 3


def _wants_score_tool(user_turn: str) -> bool:
    return (
        len(_NUMBER_RE.findall(user_turn)) >= _SCORE_TOOL_MIN_NUMBERS
        and bool(_SCORE_TOOL_KEYWORDS_RE.search(user_turn))
    )


def build_fallback_plan(user_turn: str, caller_role: str | None = None, unit_id: str | None = None) -> dict:
    """Used when the LLM call fails or returns an invalid plan — never
    hard-fails the request.
    """
    lower = user_turn.lower()

    is_estimation = any(k in lower for k in _ESTIMATION_KEYWORDS)
    missing_inputs = ["delivery_model", "scope_modules", "offshore_ratio"] if is_estimation else []

    is_calibrate = bool(_CALIBRATE_RE.search(lower))
    is_risk = bool(_RISK_RE.search(lower))
    k = K_BROAD if _BROAD_RE.search(lower) else K_DEFAULT

    if missing_inputs:
        intent = INTENT.CLARIFY
    elif is_calibrate:
        intent = INTENT.CALIBRATE
    elif is_risk:
        intent = INTENT.ASSESS_RISK
    else:
        intent = INTENT.RETRIEVE

    filters = {}
    if unit_id:
        filters["unit_id"] = unit_id
    filters["subdivision"] = "templates" if "template" in lower else "data"

    query = _FILLER_RE.sub("", user_turn).strip()[:80]

    return {
        "intent": intent,
        "needs_retrieval": not missing_inputs,
        "filters": filters,
        "queries": [query],
        "k": k,
        "requires_actuals": is_calibrate,
        "missing_inputs": missing_inputs,
        "wants_score_tool": intent in (INTENT.ESTIMATE, INTENT.ASSESS_RISK) and _wants_score_tool(user_turn),
        "reasoning": "Fallback plan - LLM planner unavailable or returned an invalid response.",
        "_fallback": True,
    }


def plan_query(
    llm,
    user_turn: str,
    caller_role: str | None = None,
    unit_id: str | None = None,
    estimate_id: str | None = None,
    rolling_summary: str | None = None,
) -> dict:
    """Shared by routes/plan_route.py (standalone debug endpoint) and
    routes/chat_route.py (runs this as step 1 of its own pipeline). Never
    raises — always returns a usable plan, falling back on any LLM/parse
    failure.
    """
    fallback = build_fallback_plan(user_turn, caller_role, unit_id)

    if llm is None:
        return fallback

    prompt = build_planner_prompt(user_turn, caller_role, unit_id, estimate_id, rolling_summary)

    try:
        response = llm.invoke(prompt)
        result = parse_planner_response(response.content)
    except Exception as err:  # noqa: BLE001 — never hard-fail the request
        log.warning("Planner LLM call failed, using fallback plan: %s", err)
        return fallback

    if not result.valid:
        log.info("Planner response failed validation (%s), using fallback plan", result.errors)
        return fallback

    return result.plan
