"""Estimator-context capabilities — EVA's read side of the live estimate.

The frontend computes the whole estimate (Layer 1 bottom-up, Layer 2 /score,
and the Phase 2 intelligence functions) to render the Output page, and sends
the already-computed results along with each chat turn. Everything in this
module is therefore a pure SELECTOR over that snapshot: no estimator
mathematics is reimplemented here, so the estimator stays the single source
of truth and EVA can never disagree with what the user sees on screen.

Why selectors and not LangChain tools: the data is already present in the
request, so a bind_tools round-trip would add latency and a failure mode for
no benefit. `score_project` (estimate_tool.py) still uses real tool-calling
because it genuinely has to EXTRACT parameters from free text. The capability
names here deliberately match the spec's tool names.
"""

from ..ingestion.access_roles import RATE_CARD_RESTRICTED_ROLES


def sanitize_estimator_context(ctx: dict | None, caller_role: str) -> dict | None:
    """Strip rate-card figures for roles that may not see them (R5).

    The snapshot's per-role `blendedRate` IS rate-card data — the same thing
    access_roles.derive_access_roles() withholds from the Estimator and
    Senior Management personas. Aggregate effort/FTE/total cost stay: the
    estimator UI already shows those to every role. `caller_role` here is
    the gateway-verified session role, never anything the client claimed.
    """
    if not ctx:
        return None
    if caller_role not in RATE_CARD_RESTRICTED_ROLES:
        return ctx

    scrubbed = dict(ctx)
    bottom_up = dict(scrubbed.get("bottomUp") or {})
    top_roles = []
    for row in bottom_up.get("topRoles") or []:
        row = dict(row)
        row.pop("blendedRate", None)
        top_roles.append(row)
    if top_roles:
        bottom_up["topRoles"] = top_roles
    scrubbed["bottomUp"] = bottom_up
    return scrubbed


def _fmt_money(value) -> str:
    return f"${value:,.0f}" if isinstance(value, (int, float)) else "unavailable"


def _fmt_days(value) -> str:
    return f"{value:,.0f} days" if isinstance(value, (int, float)) else "unavailable"


def get_current_estimate(ctx: dict) -> dict | None:
    """Headline figures — effort, cost, FTE, duration, complexity, scope."""
    inputs = ctx.get("inputs") or {}
    bu = ctx.get("bottomUp") or {}
    ml = ctx.get("ml")
    cov = ctx.get("coverage") or {}

    parts = [
        f"total_effort={_fmt_days(bu.get('totalEffortDays'))} "
        f"(base {_fmt_days(bu.get('baseEffortDays'))} + contingency {_fmt_days(bu.get('contingencyDays'))})",
        f"total_cost={_fmt_money(bu.get('totalCost'))}",
        f"total_fte={bu.get('totalFte')}",
        f"duration_months={inputs.get('durationMonths')}",
        f"complexity={inputs.get('complexity')}",
        f"industry={inputs.get('industry')}",
        f"contingency_pct={inputs.get('contingencyPct')}",
        f"onshore_pct={inputs.get('onshorePct')}",
        f"components_selected={inputs.get('selectedComponentCount')}/{inputs.get('totalComponentCount')}",
        f"integration_coverage_ratio={cov.get('integrationCoverageRatio')}x",
        f"data_migration_coverage_ratio={cov.get('migrationCoverageRatio')}x",
    ]
    if ml:
        parts.append(f"ml_risk_band={ml.get('riskBand')}")
        parts.append(f"ml_overrun_probability={ml.get('overrunProbability')}")
    else:
        parts.append("ml_risk=UNAVAILABLE (the ML risk service did not return a result)")

    return {"title": "Current estimate (bottom-up)", "text": "; ".join(parts)}


def get_estimate_health(ctx: dict) -> dict | None:
    health = (ctx.get("intelligence") or {}).get("health")
    if not health:
        return None
    concerns = health.get("concerns") or []
    text = (
        f"status={health.get('status')}; confidence={health.get('confidence')}%; "
        f"underlying_ml_risk_band={health.get('mlRiskBand')}; "
        f"concerns={concerns if concerns else 'none triggered'}; "
        f"recommendation={health.get('recommendation')}"
    )
    return {"title": "Estimate Health (rule-based composite)", "text": text}


def get_cost_drivers(ctx: dict) -> dict | None:
    """Layer 1 — what makes the estimate expensive."""
    bu = ctx.get("bottomUp") or {}
    by_module = ((ctx.get("intelligence") or {}).get("costDrivers") or {}).get("byModule") or []
    roles = bu.get("topRoles") or []
    if not roles and not by_module:
        return None

    role_txt = "; ".join(
        f"{r.get('role')}: {_fmt_days(r.get('effortDays'))}, {_fmt_money(r.get('cost'))}"
        + (f", blended_rate={_fmt_money(r.get('blendedRate'))}/day" if "blendedRate" in r else "")
        + f" ({r.get('pctOfTotalCost')}% of cost)"
        for r in roles
    )
    module_txt = "; ".join(
        f"{m.get('module')}: {_fmt_days(m.get('effortDays'))} ({m.get('pctOfTotal')}% of effort)"
        for m in by_module
    )
    return {
        "title": "Top cost drivers (deterministic bottom-up)",
        "text": f"BY ROLE — {role_txt}. BY MODULE — {module_txt}",
    }


def get_risk_drivers(ctx: dict) -> dict | None:
    """Layer 2 — what makes the estimate potentially inaccurate/risky."""
    drivers = (ctx.get("intelligence") or {}).get("riskDrivers") or []
    if not drivers:
        return None
    text = "; ".join(
        f"{d.get('label')} [{d.get('direction')}, contribution={d.get('contribution')}]: {d.get('explanation')}"
        for d in drivers
    )
    return {"title": "Top risk drivers (ML model explanation)", "text": text}


def get_estimate_benchmark(ctx: dict) -> dict | None:
    bm = (ctx.get("intelligence") or {}).get("benchmark")
    if not bm:
        return None
    if bm.get("insufficientData") or not bm.get("comparableCount"):
        return {
            "title": "Historical benchmark",
            "text": "insufficient_data=true — no comparable historical projects were returned "
                    "for this configuration, so this estimate cannot be benchmarked reliably.",
        }

    projects = "; ".join(
        f"{p.get('projectId')} ({p.get('industry')}, {p.get('complexity')}): "
        f"deviation={p.get('deviationPct')}%, overran={p.get('overran')}, health={p.get('health')}"
        for p in bm.get("similarProjects") or []
    )
    text = (
        f"comparable_projects={bm.get('comparableCount')}; "
        f"median_comparable_deviation_pct={bm.get('medianDeviationPct')}; "
        f"comparable_overrun_rate={bm.get('comparableOverrunRate')}; "
        f"this_estimate_deviation_gap_vs_median_pts={bm.get('deviationGapPts')}; "
        f"model_band_historical_overrun_rate={bm.get('modelHistoricalOverrunRate')} "
        f"(n={bm.get('modelHistoricalNProjects')}, a broader statistic than the comparables above). "
        f"COMPARABLES — {projects}"
    )
    return {"title": "Historical benchmark", "text": text}


def get_estimate_completeness(ctx: dict) -> dict | None:
    comp = (ctx.get("intelligence") or {}).get("completeness")
    if not comp:
        return None
    failed = comp.get("failedChecks") or []
    text = (
        f"completeness_score={comp.get('score')}%; "
        f"failed_checks={failed if failed else 'none — all checks passed'}"
    )
    return {"title": "Estimate completeness (deterministic checklist)", "text": text}


def get_estimate_anomalies(ctx: dict) -> dict | None:
    anomalies = (ctx.get("intelligence") or {}).get("anomalies")
    if not anomalies:
        return None
    items = anomalies.get("items") or []
    text = f"status={anomalies.get('status')}; findings={items if items else 'no major anomalies detected'}"
    if anomalies.get("dataCaveat"):
        text += f"; caveat={anomalies['dataCaveat']}"
    return {"title": "Anomaly review (rule-based)", "text": text}


def format_scenario_block(result: dict) -> str:
    """Renders an executed scenario so CURRENT and SCENARIO stay visibly
    distinct (spec §22) — the model must never blur the two."""
    cur, scn, delta = result["current"], result["scenario"], result["delta"]
    changes = result.get("changesApplied") or {}
    return (
        f"changes_applied={changes}. "
        f"CURRENT: effort={cur['bottomUp']['totalEffortDays']} days, "
        f"cost={_fmt_money(cur['bottomUp']['totalCost'])}, fte={cur['bottomUp']['totalFte']}, "
        f"risk_band={cur['ml']['riskBand']}, overrun_probability={cur['ml']['overrunProbability']}, "
        f"health={cur['intelligence']['health']['status']}. "
        f"SCENARIO: effort={scn['bottomUp']['totalEffortDays']} days, "
        f"cost={_fmt_money(scn['bottomUp']['totalCost'])}, fte={scn['bottomUp']['totalFte']}, "
        f"risk_band={scn['ml']['riskBand']}, overrun_probability={scn['ml']['overrunProbability']}, "
        f"health={scn['intelligence']['health']['status']}. "
        f"DELTA: effort={delta['effortDays']:+} days, cost={delta['cost']:+}, "
        f"overrun_probability={delta['overrunProbability']:+}, "
        f"risk_band_changed={delta['riskBandChanged']}. "
        f"The scenario is a comparison only — the user's saved estimate is unchanged."
    )


def format_risk_reduction_block(improvements: list[dict]) -> str:
    if not improvements:
        return (
            "No evaluated change reduced overrun probability for this estimate. "
            "Every candidate was actually executed; none improved the risk, so there is "
            "nothing to recommend here — do not invent an alternative."
        )
    lines = "; ".join(
        f"{i + 1}. {imp['label']}: overrun probability "
        f"{imp['currentOverrunProbability']} -> {imp['scenarioOverrunProbability']} "
        f"(band {imp['scenarioRiskBand']}, effort {imp['effortDaysDelta']:+} days, "
        f"cost {imp['costDelta']:+})"
        for i, imp in enumerate(improvements)
    )
    return f"Options that measurably reduced risk when actually executed — {lines}"


def review_current_estimate(ctx: dict) -> list[dict]:
    """Composite — one pass assembling every block, for 'review my estimate'.

    Built as a single selector so a review turn doesn't repeatedly re-emit
    overlapping blocks (spec §20).
    """
    blocks = [
        get_current_estimate(ctx),
        get_estimate_health(ctx),
        get_cost_drivers(ctx),
        get_risk_drivers(ctx),
        get_estimate_benchmark(ctx),
        get_estimate_completeness(ctx),
        get_estimate_anomalies(ctx),
    ]
    return [b for b in blocks if b]


# Capability registry — names deliberately match the spec's tool names.
SELECTORS = {
    "get_current_estimate": get_current_estimate,
    "get_estimate_health": get_estimate_health,
    "get_cost_drivers": get_cost_drivers,
    "get_risk_drivers": get_risk_drivers,
    "get_estimate_benchmark": get_estimate_benchmark,
    "get_estimate_completeness": get_estimate_completeness,
    "get_estimate_anomalies": get_estimate_anomalies,
}

_REVIEW_TERMS = ("review", "assess", "audit", "sanity check", "sanity-check", "go through")
_KEYWORDS = {
    "get_estimate_health": ("health", "amber", "green", "red", "risk band", "confidence", "how good", "how healthy"),
    "get_cost_drivers": ("cost driver", "expensive", "driving", "drivers of cost", "biggest cost",
                         "what makes", "role", "module", "breakdown", "where is the effort"),
    "get_risk_drivers": ("risk driver", "risky", "why risk", "overrun", "shap", "risk factor", "biggest risk"),
    "get_estimate_benchmark": ("benchmark", "historical", "comparable", "similar project", "compare",
                               "past project", "industry average"),
    "get_estimate_completeness": ("complete", "completeness", "missing", "gaps", "anything left"),
    "get_estimate_anomalies": ("anomaly", "anomalies", "unusual", "suspicious", "concern", "red flag", "wrong"),
}

_ESTIMATE_INTENTS = ("ESTIMATE", "CALIBRATE", "ASSESS_RISK")

# "Whose estimate?" markers — a question is about the LIVE estimate only when
# it refers to it possessively/deictically. Matched as separate signals from
# the topic nouns below so wording like "my current cost" or "the cost of my
# project" works without enumerating every phrasing.
_POSSESSIVE_MARKERS = (" my ", "my ", " our ", "our ", "this estimate", "the estimate",
                       "current estimate", "this project", "the project")
_TOPIC_NOUNS = (
    "estimate", "cost", "effort", "fte", "duration", "risk", "complexity", "integration",
    "migration", "coverage", "contingency", "scope", "component", "team", "benchmark",
    "completeness", "anomaly", "anomalies", "driver", "amber", "green", "red", "overrun",
    "price", "budget", "days", "resource",
)


def is_estimate_question(message: str, intent: str | None) -> bool:
    """True when the turn is about the estimate the user is currently viewing.

    Deliberately conservative: a general question ("what is RAG?", "how does
    the estimator work?") must NOT drag estimate data into the prompt.
    """
    text = f" {(message or '').lower().strip()} "

    has_possessive = any(m in text for m in _POSSESSIVE_MARKERS)
    has_topic = any(n in text for n in _TOPIC_NOUNS)

    if has_possessive and has_topic:
        return True
    if any(t in text for t in _REVIEW_TERMS) and has_topic:
        return True
    if intent in _ESTIMATE_INTENTS:
        return True
    # Bare follow-ups ("is that high?", "why is it amber?") — short turns
    # whose subject lives in the previous turn. Short-term memory supplies the
    # referent; we just make sure the estimate data is there to resolve it.
    if len(text.split()) <= 8 and any(
        kw in text for kws in _KEYWORDS.values() for kw in kws
    ):
        return True
    return False


def select_estimator_blocks(message: str, intent: str | None, ctx: dict | None) -> list[dict]:
    """Pick the smallest set of context blocks that answers the question.

    Deterministic on purpose (spec §39/§47): 'what is my cost?' should not
    drag benchmark, anomaly and risk-driver data into the prompt.
    """
    if not ctx:
        return []
    if not is_estimate_question(message, intent):
        return []

    text = (message or "").lower()

    if any(t in text for t in _REVIEW_TERMS):
        return review_current_estimate(ctx)

    matched = [
        name for name, keywords in _KEYWORDS.items()
        if any(kw in text for kw in keywords)
    ]
    if not matched:
        block = get_current_estimate(ctx)
        return [block] if block else []

    # Always include the headline figures so percentages/drivers have their
    # absolute values to sit against.
    blocks = []
    base = get_current_estimate(ctx)
    if base:
        blocks.append(base)
    for name in matched:
        block = SELECTORS[name](ctx)
        if block:
            blocks.append(block)
    return blocks
