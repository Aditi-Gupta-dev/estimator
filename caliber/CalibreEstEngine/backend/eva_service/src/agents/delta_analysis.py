"""AI interpretation of an already-computed, deterministic version delta
(Phase 5). This module NEVER calculates a number — the deterministic delta
it receives (built by upload-server's estimator/deltaEngine.js) is the only
numeric authority in this pipeline. The LLM explains, infers likely drivers,
and flags risk; it does not recompute effort or cost.

Security (Part 3): the caller (upload-server) redacts rate-card figures
(redactDeltaForRole) BEFORE this payload is ever constructed — this module
never receives, and therefore can never leak, a blendedRate figure. That is
enforced by the caller, not by a prompt instruction here; the prompt below
additionally tells the model not to invent or restate rate figures anyway,
as defense in depth, not as the actual control.
"""
import logging
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

log = logging.getLogger("eva_service.delta_analysis")


class DeltaAIAnalysis(BaseModel):
    """Structured output contract (Phase 5 Part 8). Validated by
    with_structured_output — a response that doesn't fit this shape raises,
    and the caller (delta_route.py) surfaces that as a clean failure rather
    than storing unstructured text as if it were trusted data."""

    summary: str = Field(description="One or two plain-language sentences summarizing what changed overall.")
    key_changes: list[str] = Field(
        description=(
            "FACTS ONLY — restate the deterministic numeric/scope changes you were given "
            "(e.g. 'Effort increased from 120 to 155 days (+29.2%)'). Never state a number "
            "that isn't directly present in the deterministic delta you received."
        ),
    )
    likely_drivers: list[str] = Field(
        description="INFERENCES — your reasoning about what likely caused the changes, informed by change_reason and the scope delta. Label speculation as such.",
    )
    impact: str = Field(description="INFERENCE — plain-language assessment of what this change means for the project/estimate.")
    risks: list[str] = Field(default_factory=list, description="INFERENCE — risks this change may introduce or reveal, if any.")
    recommendations: list[str] = Field(default_factory=list, description="INFERENCE — what the estimator/reviewer should consider next.")
    confidence: Literal["low", "medium", "high"] = Field(
        description="Your confidence in the drivers/impact analysis (not the deterministic numbers, which are always certain).",
    )
    scope_creep_indicated: bool = Field(
        description="Whether the added/changed scope appears to go beyond what change_reason describes.",
    )


SYSTEM_PROMPT = """
You analyze a deterministic, already-calculated delta between two versions of a project \
estimate. You do NOT calculate anything — every number you reference must come directly \
from the "Deterministic delta" JSON provided to you. Never invent, derive, or restate a \
number that is not literally present there.

Strictly separate FACTS from INFERENCES:
- key_changes must be FACTS: a plain-language restatement of entries in the deterministic \
delta (e.g. "Effort increased from 120 to 155 days (+29.2%)"), using ONLY values given to you.
- likely_drivers, impact, risks, recommendations are INFERENCES: your reasoning about causes, \
consequences, and next steps. Do not present an inference as if it were a measured fact.

The estimator-provided change_reason is a CLAIM, not ground truth — compare it against the \
actual scope/parameter changes in the deterministic delta and note if they don't line up \
(that mismatch itself is worth flagging as a risk).

You are analyzing project estimation data (effort, cost, scope, roles, assumptions, \
parameters) — this is domain-neutral; do not assume a specific industry vocabulary beyond \
what appears in the data you were given.

Never state, restate, derive, or approximate an hourly/daily rate figure — if the \
deterministic delta does not mention one, do not speculate about rates at all.
""".strip()


def _format_deterministic_delta(delta: dict) -> str:
    lines = [f"Changed fields: {', '.join(delta.get('changedFields') or []) or '(none)'}"]
    for d in delta.get("numericDeltas") or []:
        if d.get("delta") is None:
            lines.append(f"- [{d['category']}] {d['field']}: {d.get('previous')} -> {d.get('current')}")
        else:
            pct = f" ({d['deltaPct']:+.1f}%)" if d.get("deltaPct") is not None else ""
            lines.append(f"- [{d['category']}] {d['field']}: {d.get('previous')} -> {d.get('current')} ({d['delta']:+}{pct})")
    for item in delta.get("addedItems") or []:
        lines.append(f"- ADDED: {item.get('type')} '{item.get('name')}' (complexity={item.get('complexity')}, volume={item.get('volume')})")
    for item in delta.get("removedItems") or []:
        lines.append(f"- REMOVED: {item.get('type')} '{item.get('name')}'")
    for item in delta.get("modifiedItems") or []:
        changes = "; ".join(f"{c['field']}: {c['previous']} -> {c['current']}" for c in item.get("changes", []))
        lines.append(f"- MODIFIED: {item.get('type')} '{item.get('name')}' — {changes or item.get('field', '')}")
    return "\n".join(lines)


def analyze_delta(llm, deterministic_delta: dict, context: dict) -> DeltaAIAnalysis:
    """context: {estimateName, industry, overallComplexity, businessUnit,
    changeReason, projectName, projectKey} — all optional, already scoped
    to what the caller decided is safe to share (Part 8: no unrelated
    users' data, no arbitrary DB contents, no rate-card figures)."""
    user_lines = [
        f"Estimate: {context.get('estimateName') or '(unnamed)'}",
        f"Industry: {context.get('industry') or 'unspecified'} | Overall complexity: {context.get('overallComplexity') or 'unspecified'}",
    ]
    if context.get("projectName"):
        user_lines.append(f"Project: {context['projectName']} ({context.get('projectKey', '')})")
    if context.get("changeReason"):
        user_lines.append(f"Estimator's stated change reason: \"{context['changeReason']}\"")
    user_lines.append("\nDeterministic delta:")
    user_lines.append(_format_deterministic_delta(deterministic_delta))

    structured_llm = llm.with_structured_output(DeltaAIAnalysis)
    return structured_llm.invoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content="\n".join(user_lines)),
    ])
