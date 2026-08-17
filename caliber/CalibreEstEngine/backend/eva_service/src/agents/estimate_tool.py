"""The estimate tool — lets the LLM actually score an Oracle Fusion
project via estimator_agents' /score endpoint, rather than just describing
templates. Two-layered design (see EVA_RAG_IMPLEMENTATION_PLAN.md agents
plan): the planner's coarser missing_inputs/wants_score_tool already
decided this turn is plausibly a scoring request; this layer does the real
field-by-field extraction and is the second line of defense if fields are
still missing.
"""
import logging
from typing import Literal

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from pydantic import BaseModel, Field, ValidationError

from ..config import settings
from .state import EvaGraphState, trail_step

log = logging.getLogger("eva_service.estimate_tool")


class ScoreProjectArgs(BaseModel):
    """Mirrors estimator_agents/src/api.py's ScoreRequest exactly. Kept as
    a second definition (not imported cross-service) since eva_service and
    estimator_agents are independently deployable Python services with no
    shared package today.
    """
    complexity: Literal["L", "M", "H", "VH"] = Field(
        description='Project complexity CODE ONLY — exactly "L" (Low), "M" (Medium), '
                    '"H" (High), or "VH" (Very High). Map the user\'s wording to the '
                    'code; never pass the full word.'
    )
    industry: str = Field(description="Industry name exactly as used by the risk engine, e.g. \"BFSI\", \"Manufacturing\", \"Healthcare\".")
    n_modules: int = Field(ge=1)
    n_entities: int = Field(ge=1)
    integ_simple: int = Field(ge=0, description="Count of simple integrations.")
    integ_complex: int = Field(ge=0, description="Count of complex integrations.")
    n_reports: int = Field(ge=0)
    n_cemli: int = Field(ge=0, description="Count of CEMLI (Configuration/Extension/Modification/Localization/Integration) items.")
    n_dm_objects: int = Field(ge=0, description="Count of data migration objects.")
    duration_months: int = Field(ge=1)
    team_size: int = Field(ge=1)
    integ_coverage_ratio: float = Field(gt=0, description="Integration effort coverage ratio, typically 0.75-2.25.")
    dm_coverage_ratio: float = Field(gt=0, description="Data migration effort coverage ratio, typically 0.75-2.25.")


SCORE_REQUEST_FIELDS = list(ScoreProjectArgs.model_fields)

EXTRACTION_SYSTEM_PROMPT = """
You extract structured Oracle Fusion project inputs from a conversation to score
project risk. Call `score_project` ONLY when all 13 fields are explicit or
unambiguous from what the user actually said — never guess, estimate, or default
a value that wasn't stated. If any field is missing or ambiguous, do NOT call the
tool — instead respond in plain text naming exactly which fields (by their
tool-schema name) are still needed.

`complexity` MUST be passed as exactly one of the codes "L", "M", "H", "VH" —
never the full word. Map the user's wording: Low->"L", Medium->"M", High->"H",
Very High->"VH".
""".strip()


@tool("score_project", args_schema=ScoreProjectArgs)
def score_project(**kwargs) -> dict:
    """Score an Oracle Fusion project's cost/schedule risk. Call ONLY once
    all 13 fields are explicitly known from the conversation — never guess.
    """
    return call_estimator_service(kwargs)


def call_estimator_service(payload: dict, timeout: float = 10.0) -> dict:
    """Factored out as its own top-level function so tests can monkeypatch
    it directly instead of mocking HTTP transport."""
    resp = httpx.post(
        f"{settings.estimator_service_url}/score",
        json=payload,
        headers={"x-internal-key": settings.internal_api_key},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def estimate_tool_node(state: EvaGraphState) -> dict:
    llm = state["llm"]
    if not hasattr(llm, "bind_tools"):
        return {
            "score_result": None, "score_missing_fields": SCORE_REQUEST_FIELDS,
            "agent_trail": trail_step("estimate_tool", "Tool-calling unavailable", ""),
        }

    llm_with_tool = llm.bind_tools([score_project])
    context = "\n".join(
        f"- {r.chunk.document.title}: {r.chunk.text[:300]}" for r in (state.get("retrieved") or [])
    )
    user = "\n".join(filter(None, [
        f"Caller role: {state['caller_role']}",
        f"Session context: {state.get('rolling_summary') or ''}",
        f"Retrieved template/benchmark context:\n{context}" if context else "",
        f"User: {state['message']}",
    ]))

    try:
        response = llm_with_tool.invoke([SystemMessage(content=EXTRACTION_SYSTEM_PROMPT), HumanMessage(content=user)])
    except Exception as err:  # noqa: BLE001 — never crash the graph on a bad tool-call response
        log.warning("Estimate tool extraction call failed: %s", err)
        return {
            "score_result": None, "score_missing_fields": SCORE_REQUEST_FIELDS,
            "agent_trail": trail_step("estimate_tool", "Extraction failed", str(err)),
        }

    tool_calls = getattr(response, "tool_calls", None) or []
    if not tool_calls:
        return {
            "score_result": None, "score_missing_fields": SCORE_REQUEST_FIELDS,
            "agent_trail": trail_step("estimate_tool", "Needs more input", ""),
        }

    try:
        validated = ScoreProjectArgs(**tool_calls[0]["args"])
    except ValidationError as err:
        missing = sorted({str(e["loc"][0]) for e in err.errors()})
        return {
            "score_result": None, "score_missing_fields": missing,
            "agent_trail": trail_step("estimate_tool", "Invalid input", ", ".join(missing)),
        }

    try:
        result = call_estimator_service(validated.model_dump())
    except httpx.HTTPError as err:
        return {
            "score_result": None, "score_missing_fields": [],
            "agent_trail": trail_step("estimate_tool", "Estimator service unreachable", str(err)),
        }

    return {
        "score_request": validated.model_dump(),
        "score_result": result,
        "agent_trail": trail_step("estimate_tool", "Scored", f"risk_band={result['ml_calibration']['risk_band']}"),
    }
