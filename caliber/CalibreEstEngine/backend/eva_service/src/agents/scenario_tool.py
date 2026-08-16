"""What-if scenario execution — EVA's write-side counterpart to
estimator_context.py's read-side selectors.

Unlike the read selectors (where the data is already in the request), this
genuinely needs LLM tool-calling: "increase integration effort by 10%" has to
be parsed into a structured, validated change set. That extraction is the ONLY
thing the model does here — the arithmetic is executed by the real estimator
engine via upload-server's /internal/estimator/scenario, which imports the
very same computeBottomUp/computeCoverageRatios modules the browser uses.

EVA therefore never predicts a scenario outcome; it requests one and reports
what came back. Structure mirrors estimate_tool.py deliberately (same
defensive branches, same monkeypatchable service-call seam).
"""
import logging
from typing import Literal

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from pydantic import BaseModel, Field, ValidationError

from ..config import settings
from .state import EvaGraphState, trail_step

log = logging.getLogger("eva_service.scenario_tool")


class ScenarioChangesArgs(BaseModel):
    """The closed vocabulary of supported estimate modifications.

    Mirrors upload-server/estimator/scenarioRunner.js's validator. Kept as a
    second definition (not imported) for the same reason ScoreProjectArgs is:
    eva_service and upload-server are independently deployed with no shared
    package. The Node side re-validates everything regardless — this schema
    exists to steer extraction, not to be the security boundary.
    """
    durationMonths: int | None = Field(
        default=None, description="Set absolute project duration in months.")
    durationMonthsDelta: int | None = Field(
        default=None, description='Change duration by N months, e.g. +1 for "extend by a month".')
    contingencyPct: float | None = Field(
        default=None, description="Set absolute contingency percentage.")
    contingencyPctDelta: float | None = Field(
        default=None, description="Change contingency by N percentage points.")
    onshorePct: float | None = Field(
        default=None, description="Set absolute onshore percentage.")
    onshorePctDelta: float | None = Field(
        default=None, description="Change onshore mix by N percentage points.")
    complexity: Literal["L", "M", "H", "VH"] | None = Field(
        default=None, description='Overall complexity CODE ONLY: "L", "M", "H", or "VH".')
    moduleEffortMultiplier: dict[str, float] | None = Field(
        default=None,
        description=(
            'Scale a module\'s effort, e.g. {"Integration": 1.1} for "increase integration '
            'effort by 10%". Module names must match the estimator catalog exactly, e.g. '
            '"Integration", "Data Migration", "Testing & QA", "Reporting", "Security".'
        ),
    )

    def as_changes(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}


EXTRACTION_SYSTEM_PROMPT = """
You translate a user's what-if question about their CURRENT Oracle Fusion estimate
into a structured change set, then call `run_estimate_scenario`.

Call the tool only with changes the user actually asked for — never add, guess, or
"round out" a change they did not mention. If the user's question contains no
concrete, quantified change to the estimate, do NOT call the tool; reply in plain
text naming what is ambiguous.

Percentage increases to a workstream are multipliers: "increase integration effort
by 10%" -> {"moduleEffortMultiplier": {"Integration": 1.1}}. "Cut migration by 20%"
-> {"moduleEffortMultiplier": {"Data Migration": 0.8}}. "Extend duration by a month"
-> {"durationMonthsDelta": 1}. complexity must be one of "L","M","H","VH".
""".strip()


@tool("run_estimate_scenario", args_schema=ScenarioChangesArgs)
def run_estimate_scenario(**kwargs) -> dict:
    """Run a what-if change against the user's CURRENT estimate and return the
    recalculated result. Use only for modifications to the active estimate —
    not for scoring a brand-new hypothetical project.
    """
    return kwargs


def call_scenario_service(base_inputs: dict, changes: dict, caller_role: str,
                          timeout: float = 20.0) -> dict:
    """Factored out as its own top-level function so tests can monkeypatch it
    directly instead of mocking HTTP transport (matches estimate_tool.py).

    caller_role is the gateway-verified role EVA was handed; upload-server
    re-applies the same role gate as /api/score against it.
    """
    resp = httpx.post(
        f"{settings.upload_server_url}/internal/estimator/scenario",
        json={"callerRole": caller_role, "baseInputs": base_inputs, "changes": changes},
        headers={"x-internal-key": settings.internal_api_key},
        timeout=timeout,
    )
    if resp.status_code == 422:
        # Validation rejection — surfaced to the user as "outside the
        # supported range" rather than treated as a service failure.
        return {"validation_error": resp.json().get("error", "Unsupported change.")}
    resp.raise_for_status()
    return resp.json()


# The four candidates the estimator UI's Risk Reduction card already uses, so
# EVA and the UI recommend from an identical, real search space.
RISK_REDUCTION_CANDIDATES = [
    ("Increase Integration allocation by 10%", {"moduleEffortMultiplier": {"Integration": 1.1}}),
    ("Increase Data Migration allocation by 10%", {"moduleEffortMultiplier": {"Data Migration": 1.1}}),
    ("Extend duration by 1 month", {"durationMonthsDelta": 1}),
    ("Increase contingency by 5 points", {"contingencyPctDelta": 5}),
]


def suggest_risk_reduction(base_inputs: dict, caller_role: str) -> list[dict]:
    """Run every candidate for real and return ONLY those that actually
    lowered overrun probability (spec §24 — never recommend an unverified
    improvement). Candidates that error out are dropped, not guessed at.
    """
    improvements = []
    for label, changes in RISK_REDUCTION_CANDIDATES:
        try:
            result = call_scenario_service(base_inputs, changes, caller_role)
        except httpx.HTTPError as err:
            log.warning("Risk-reduction candidate %r failed: %s", label, err)
            continue
        if not result.get("success"):
            continue
        current = result["current"]["ml"]["overrunProbability"]
        scenario = result["scenario"]["ml"]["overrunProbability"]
        if scenario < current:
            improvements.append({
                "label": label,
                "currentOverrunProbability": current,
                "scenarioOverrunProbability": scenario,
                "scenarioRiskBand": result["scenario"]["ml"]["riskBand"],
                "effortDaysDelta": result["delta"]["effortDays"],
                "costDelta": result["delta"]["cost"],
            })
    improvements.sort(key=lambda x: x["scenarioOverrunProbability"])
    return improvements[:3]


_RISK_REDUCTION_TERMS = (
    "reduce my risk", "reduce risk", "lower my risk", "lower risk", "de-risk",
    "derisk", "less risky", "safer", "improve my risk", "bring risk down",
    "how can i reduce", "what would reduce",
)


def is_risk_reduction_question(message: str) -> bool:
    return any(t in (message or "").lower() for t in _RISK_REDUCTION_TERMS)


_SCENARIO_TERMS = (
    "what if", "what happens if", "if i increase", "if i reduce", "if i cut",
    "if i extend", "if i add", "if i change", "if we increase", "if we reduce",
    "if we extend", "simulate", "scenario", "suppose", "were to increase",
)


def is_scenario_question(message: str) -> bool:
    text = (message or "").lower()
    return any(t in text for t in _SCENARIO_TERMS) or is_risk_reduction_question(text)


def scenario_node(state: EvaGraphState) -> dict:
    """Extract a change set (LLM) then execute it (real estimator engine)."""
    ctx = state.get("estimator_context") or {}
    base_inputs = ctx.get("rawInputs")
    caller_role = state["caller_role"]

    if not base_inputs:
        return {
            "scenario_error": "no_base_inputs",
            "agent_trail": trail_step("scenario", "No active estimate to modify", ""),
        }

    # "How can I reduce my risk?" is a fixed, exhaustive search — it needs no
    # extraction, so it skips the LLM call entirely.
    if is_risk_reduction_question(state.get("message", "")):
        try:
            improvements = suggest_risk_reduction(base_inputs, caller_role)
        except Exception as err:  # noqa: BLE001 — never crash the graph
            log.warning("Risk-reduction search failed: %s", err)
            return {
                "scenario_error": "service_unavailable",
                "agent_trail": trail_step("scenario", "Scenario service unreachable", str(err)),
            }
        return {
            "risk_reduction": improvements,
            "agent_trail": trail_step(
                "scenario", f"Evaluated {len(RISK_REDUCTION_CANDIDATES)} risk-reduction options",
                f"{len(improvements)} reduced risk",
            ),
        }

    llm = state["llm"]
    if not hasattr(llm, "bind_tools"):
        return {
            "scenario_error": "tool_calling_unavailable",
            "agent_trail": trail_step("scenario", "Tool-calling unavailable", ""),
        }

    user = "\n".join(filter(None, [
        f"Session context: {state.get('rolling_summary') or ''}",
        f"Current estimate: duration={ctx.get('inputs', {}).get('durationMonths')} months, "
        f"complexity={ctx.get('inputs', {}).get('complexity')}, "
        f"contingency={ctx.get('inputs', {}).get('contingencyPct')}%",
        f"User: {state['message']}",
    ]))

    try:
        response = llm.bind_tools([run_estimate_scenario]).invoke(
            [SystemMessage(content=EXTRACTION_SYSTEM_PROMPT), HumanMessage(content=user)]
        )
    except Exception as err:  # noqa: BLE001
        log.warning("Scenario extraction call failed: %s", err)
        return {
            "scenario_error": "extraction_failed",
            "agent_trail": trail_step("scenario", "Extraction failed", str(err)),
        }

    tool_calls = getattr(response, "tool_calls", None) or []
    if not tool_calls:
        return {
            "scenario_error": "no_change_identified",
            "agent_trail": trail_step("scenario", "No concrete change identified", ""),
        }

    try:
        changes = ScenarioChangesArgs(**tool_calls[0]["args"]).as_changes()
    except ValidationError as err:
        fields = sorted({str(e["loc"][0]) for e in err.errors()})
        return {
            "scenario_error": "invalid_change",
            "agent_trail": trail_step("scenario", "Invalid change", ", ".join(fields)),
        }

    if not changes:
        return {
            "scenario_error": "no_change_identified",
            "agent_trail": trail_step("scenario", "No concrete change identified", ""),
        }

    try:
        result = call_scenario_service(base_inputs, changes, caller_role)
    except httpx.HTTPError as err:
        return {
            "scenario_error": "service_unavailable",
            "agent_trail": trail_step("scenario", "Scenario service unreachable", str(err)),
        }

    if result.get("validation_error"):
        return {
            "scenario_error": "unsupported_change",
            "scenario_error_detail": result["validation_error"],
            "agent_trail": trail_step("scenario", "Change out of range", result["validation_error"]),
        }

    return {
        "scenario_request": changes,
        "scenario_result": result,
        "agent_trail": trail_step(
            "scenario", "Scenario executed",
            f"effort {result['delta']['effortDays']:+}d, "
            f"band {result['current']['ml']['riskBand']}->{result['scenario']['ml']['riskBand']}",
        ),
    }
