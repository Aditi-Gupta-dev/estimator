"""Persisted-estimate management — EVA's write side for SAVED estimates,
distinct from scenario_tool.py's what-if execution against the LIVE (unsaved)
draft in the estimator UI.

Same division of labour as scenario_tool.py: the LLM's only job is deciding
WHICH operation the user wants and extracting its arguments (estimate id,
version numbers, a change set). The actual create/read/update/persist logic —
including ownership checks and the audit trail — runs entirely in
upload-server's estimatesService.js via /internal/estimates*. EVA never
writes to the estimates database itself and never invents a result.

create_estimate never takes estimate contents from the LLM: an estimate's
67-component inputs come only from the user's live estimator_context
(rawInputs), the same snapshot scenario_tool.py uses as its base_inputs —
this is deliberate, since letting the model author bottom-up estimator
inputs from free text is exactly the kind of fabrication this system exists
to prevent.

update_estimate and save_estimate share the SAME change vocabulary as
run_estimate_scenario (ScenarioChangesArgs, imported not reimplemented).
update_estimate computes and returns a proposal without writing; save_estimate
writes a new version. The two being distinct tool names — not one tool with a
"persist" flag exposed to the LLM — is the confirmation mechanism: the model
has to choose the save_estimate NAME specifically, and the system prompt below
instructs it to do that only after the user has seen a proposal and confirmed
it, never in the same turn a change was first requested.
"""
import logging

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from pydantic import BaseModel, Field, ValidationError

from ..config import settings
from .scenario_tool import ScenarioChangesArgs
from .state import EvaGraphState, trail_step

log = logging.getLogger("eva_service.estimate_persistence_tool")


class CreateEstimateArgs(BaseModel):
    name: str | None = Field(
        default=None,
        description="A short label for the estimate, e.g. 'BFSI Q3 rollout'. Do not invent one if the user gave none.",
    )


class EstimateIdArgs(BaseModel):
    estimateId: str = Field(description="The saved estimate's ID, as previously reported by EVA or typed by the user.")


class UpdateEstimateArgs(ScenarioChangesArgs):
    estimateId: str = Field(description="The saved estimate's ID to propose a change against.")

    def as_changes(self) -> dict:
        changes = super().as_changes()
        changes.pop("estimateId", None)
        return changes


class SaveEstimateArgs(UpdateEstimateArgs):
    pass


class CompareEstimatesArgs(BaseModel):
    estimateId: str = Field(description="The saved estimate whose two versions are being compared.")
    versionA: int = Field(description="First version number, e.g. 1.")
    versionB: int = Field(description="Second version number, e.g. 2.")


@tool("create_estimate", args_schema=CreateEstimateArgs)
def create_estimate(**kwargs) -> dict:
    """Persist the user's CURRENT live estimate (from the estimator UI) as a
    new saved estimate, starting at DRAFT status. Use when the user asks to
    save, persist, or create an estimate from what they're working on right
    now. Requires an active estimate in the estimator."""
    return kwargs


@tool("get_estimate", args_schema=EstimateIdArgs)
def get_estimate(**kwargs) -> dict:
    """Look up a previously saved estimate by its ID."""
    return kwargs


@tool("update_estimate", args_schema=UpdateEstimateArgs)
def update_estimate(**kwargs) -> dict:
    """Propose a change to a SAVED estimate and show its impact WITHOUT
    persisting anything. Use this first for any requested change to a saved
    estimate — call save_estimate only after the user confirms."""
    return kwargs


@tool("save_estimate", args_schema=SaveEstimateArgs)
def save_estimate(**kwargs) -> dict:
    """Persist a new version of a saved estimate with the given changes. Only
    call this AFTER the user has seen the proposed impact (via
    update_estimate, in this conversation) and explicitly confirmed it."""
    return kwargs


@tool("get_estimate_history", args_schema=EstimateIdArgs)
def get_estimate_history(**kwargs) -> dict:
    """List every saved version of an estimate."""
    return kwargs


@tool("compare_estimates", args_schema=CompareEstimatesArgs)
def compare_estimates(**kwargs) -> dict:
    """Compare two specific saved versions of the same estimate."""
    return kwargs


ACTION_TOOLS = [
    create_estimate, get_estimate, update_estimate, save_estimate,
    get_estimate_history, compare_estimates,
]


def _actor(caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return {"actorUserId": caller_user_id, "actorName": caller_name, "actorRole": caller_role}


def _call_internal(path: str, body: dict, timeout: float = 20.0) -> dict:
    """POSTs to upload-server's /internal/estimates* and returns the parsed
    body regardless of status code, as long as it parses as JSON — mirrors
    call_scenario_service's handling of expected 4xx business-logic failures
    (ownership denied, not found, invalid transition) so the node can react
    to result["success"] uniformly instead of every call site needing its
    own try/except around raise_for_status().
    """
    resp = httpx.post(
        f"{settings.upload_server_url}{path}",
        json=body,
        headers={"x-internal-key": settings.internal_api_key},
        timeout=timeout,
    )
    try:
        data = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise
    if not resp.is_success and "success" not in data:
        resp.raise_for_status()
    return data


def call_create_estimate(inputs: dict, name: str | None, caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return _call_internal("/internal/estimates", {
        **_actor(caller_user_id, caller_name, caller_role), "name": name, "inputs": inputs,
    })


def call_get_estimate(estimate_id: str, caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return _call_internal(f"/internal/estimates/{estimate_id}/get", _actor(caller_user_id, caller_name, caller_role))


def call_update_estimate(estimate_id: str, changes: dict, persist: bool,
                          caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return _call_internal(f"/internal/estimates/{estimate_id}/update", {
        **_actor(caller_user_id, caller_name, caller_role), "changes": changes, "persist": persist,
    })


def call_get_estimate_history(estimate_id: str, caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return _call_internal(f"/internal/estimates/{estimate_id}/history", _actor(caller_user_id, caller_name, caller_role))


def call_compare_estimates(estimate_id: str, version_a: int, version_b: int,
                            caller_user_id: str, caller_name: str, caller_role: str) -> dict:
    return _call_internal(f"/internal/estimates/{estimate_id}/compare", {
        **_actor(caller_user_id, caller_name, caller_role), "versionA": version_a, "versionB": version_b,
    })


EXTRACTION_SYSTEM_PROMPT = """
You manage the user's SAVED (persisted) Oracle Fusion estimates — distinct from
the live, unsaved estimate they may currently be editing in the estimator UI.
Call exactly ONE tool based on what the user is asking:

- create_estimate: the user wants to save/persist/create an estimate from what
  they are currently working on in the estimator.
- get_estimate: the user wants to see/open a previously saved estimate by ID.
- update_estimate: the user wants to see the IMPACT of a change to a saved
  estimate WITHOUT saving it yet — the default for "what if I changed X on
  estimate Y".
- save_estimate: the user has ALREADY seen a proposed change earlier in this
  conversation and is now confirming they want it saved/applied/persisted.
  Only call this after explicit confirmation language ("yes", "apply it",
  "save that", "go ahead") that clearly follows a proposed change.
- get_estimate_history: the user wants the version history of a saved estimate.
- compare_estimates: the user wants to compare two specific versions of the
  same saved estimate.

Never invent an estimate ID, a version number, or a change the user did not
ask for. If the conversation does not make clear which saved estimate is
meant, or what specifically should change, do not call a tool that needs
that information — reply in plain text naming what is ambiguous instead.

Percentage/module changes follow the same vocabulary as scenario execution:
"increase integration effort by 10%" -> moduleEffortMultiplier
{"Integration": 1.1}; "extend duration by a month" -> durationMonthsDelta: 1.
""".strip()

# Told to the model as evidence, mirroring scenario_tool.py's
# SCENARIO_ERROR_TEXT — the honest reason nothing happened, never a guess.
ESTIMATE_MGMT_ERROR_TEXT = {
    "identity_unavailable": (
        "This action could not be performed: no verified user identity is available for this "
        "session. Tell the user to refresh/re-log in. Do not attempt the action."
    ),
    "no_base_inputs": (
        "create_estimate could not run: there is no active estimate in the estimator to save. "
        "Tell the user to run an estimate first, and do not invent one."
    ),
    "tool_calling_unavailable": (
        "Estimate management is unavailable in this configuration. Say so plainly."
    ),
    "extraction_failed": (
        "The request could not be interpreted. Ask the user to restate it concretely."
    ),
    "no_action_identified": (
        "No concrete saved-estimate action was identified. Ask the user what they'd like to do — "
        "save the current estimate, look up a saved one, propose a change, or compare versions."
    ),
    "invalid_arguments": (
        "The request's details ({detail}) could not be validated. Ask the user to restate the "
        "estimate ID, version numbers, or change concretely."
    ),
    "service_unavailable": (
        "The estimate persistence service is unavailable. Say so plainly and do not guess a result."
    ),
    "denied_or_failed": (
        "The action could not be completed: {detail} Report this reason to the user plainly; do "
        "not attempt to work around it or guess what the result would have been."
    ),
}


_ESTIMATE_MGMT_TERMS = (
    "save this estimate", "save the estimate", "save my estimate", "save that estimate",
    "create an estimate", "create a new estimate", "persist this estimate", "persist the estimate",
    "save as draft", "save it as an estimate",
    "estimate history", "version history", "previous version", "earlier version",
    "compare version", "compare estimate", "compare my estimate",
    "load estimate", "open estimate", "open my estimate", "get estimate", "retrieve estimate",
    "update estimate", "update my estimate", "update the estimate",
)


def is_estimate_management_question(message: str) -> bool:
    text = (message or "").lower()
    return any(t in text for t in _ESTIMATE_MGMT_TERMS)


def _fmt_money(value) -> str:
    return f"${value:,.0f}" if isinstance(value, (int, float)) else "unavailable"


def _fmt_version(v: dict | None) -> str:
    if not v:
        return "no version data"
    bu = v.get("bottomUp") or {}
    ml = v.get("ml") or {}
    health = v.get("health") or {}
    return (
        f"v{v.get('version')}: effort={bu.get('totalWithContingency')} days, "
        f"cost={_fmt_money(bu.get('totalCost'))}, fte={bu.get('totalAvgFte')}, "
        f"risk_band={ml.get('riskBand')}, overrun_probability={ml.get('overrunProbability')}, "
        f"health={health.get('status')}, saved_at={v.get('createdAt')}"
    )


def format_estimate_mgmt_block(action: str, result: dict) -> str:
    """Renders the result of a persisted-estimate operation as grounded
    evidence text — folded into generate_node's SAME citation pipeline as
    everything else (spec's "no second synthesis call" principle)."""
    if action in ("create_estimate", "get_estimate"):
        est = result.get("estimate") or {}
        return (
            f"estimate_id={est.get('id')}, name={est.get('name')!r}, status={est.get('status')}, "
            f"current_version={est.get('currentVersion')}. {_fmt_version(est.get('latestVersion'))}"
        )
    if action in ("update_estimate", "save_estimate"):
        persisted = result.get("persisted")
        inner = result.get("result") or {}
        if persisted:
            return (
                f"CHANGE SAVED as a new version (persisted=true) — this is a real, durable mutation. "
                f"estimate_id={inner.get('id')}, status={inner.get('status')}, "
                f"current_version={inner.get('currentVersion')}. {_fmt_version(inner.get('latestVersion'))}"
            )
        bu = inner.get("bottomUp") or {}
        ml = inner.get("ml") or {}
        return (
            f"PROPOSED CHANGE ONLY — nothing has been saved yet (persisted=false). "
            f"estimate_id={inner.get('estimateId')}, base_version={inner.get('currentVersion')}. "
            f"If saved: effort={bu.get('totalWithContingency')} days, cost={_fmt_money(bu.get('totalCost'))}, "
            f"fte={bu.get('totalAvgFte')}, risk_band={ml.get('riskBand')}, "
            f"overrun_probability={ml.get('overrunProbability')}. "
            f"Explain this impact to the user and ask them to confirm before it is saved — do NOT "
            f"call save_estimate in the same turn."
        )
    if action == "get_estimate_history":
        versions = result.get("versions") or []
        if not versions:
            return "No saved versions found."
        return f"{len(versions)} saved version(s) — " + "; ".join(_fmt_version(v) for v in versions)
    if action == "compare_estimates":
        comp = result.get("comparison") or {}
        delta = comp.get("delta") or {}
        return (
            f"{_fmt_version(comp.get('versionA'))} VS {_fmt_version(comp.get('versionB'))}. "
            f"DELTA: effort={delta.get('effortDays', 0):+} days, cost={delta.get('cost', 0):+}, "
            f"fte={delta.get('fte', 0):+}, deviation_pct={delta.get('deviationPct', 0):+}, "
            f"risk_band_changed={delta.get('riskBandChanged')}"
        )
    return "No details available."


def estimate_management_node(state: EvaGraphState) -> dict:
    caller_role = state.get("caller_role")
    caller_user_id = state.get("caller_user_id")
    caller_name = state.get("caller_name")

    if not caller_user_id or not caller_name:
        return {
            "estimate_mgmt_error": "identity_unavailable",
            "agent_trail": trail_step("estimate_mgmt", "No verified identity", ""),
        }

    llm = state["llm"]
    if not hasattr(llm, "bind_tools"):
        return {
            "estimate_mgmt_error": "tool_calling_unavailable",
            "agent_trail": trail_step("estimate_mgmt", "Tool-calling unavailable", ""),
        }

    ctx = state.get("estimator_context") or {}
    recent = state.get("recent_messages") or []
    history_text = "\n".join(f"{m.role}: {m.text}" for m in recent[-6:])
    live_estimate = (
        f"yes (id={ctx.get('estimateId')})" if ctx.get("rawInputs") else "no active estimate in the estimator"
    )
    user = "\n".join(filter(None, [
        f"Recent conversation:\n{history_text}" if history_text else None,
        f"Live (unsaved) estimate currently open in the estimator: {live_estimate}",
        f"User: {state['message']}",
    ]))

    try:
        response = llm.bind_tools(ACTION_TOOLS).invoke(
            [SystemMessage(content=EXTRACTION_SYSTEM_PROMPT), HumanMessage(content=user)]
        )
    except Exception as err:  # noqa: BLE001
        log.warning("Estimate management extraction call failed: %s", err)
        return {
            "estimate_mgmt_error": "extraction_failed",
            "agent_trail": trail_step("estimate_mgmt", "Extraction failed", str(err)),
        }

    tool_calls = getattr(response, "tool_calls", None) or []
    if not tool_calls:
        return {
            "estimate_mgmt_error": "no_action_identified",
            "agent_trail": trail_step("estimate_mgmt", "No concrete action identified", ""),
        }

    call = tool_calls[0]
    action = call["name"]
    args = call.get("args") or {}

    try:
        if action == "create_estimate":
            inputs = ctx.get("rawInputs")
            if not inputs:
                return {
                    "estimate_mgmt_error": "no_base_inputs",
                    "agent_trail": trail_step("estimate_mgmt", "No active estimate to save", ""),
                }
            parsed = CreateEstimateArgs(**args)
            result = call_create_estimate(inputs, parsed.name, caller_user_id, caller_name, caller_role)
        elif action == "get_estimate":
            parsed = EstimateIdArgs(**args)
            result = call_get_estimate(parsed.estimateId, caller_user_id, caller_name, caller_role)
        elif action == "update_estimate":
            parsed = UpdateEstimateArgs(**args)
            result = call_update_estimate(
                parsed.estimateId, parsed.as_changes(), False, caller_user_id, caller_name, caller_role,
            )
        elif action == "save_estimate":
            parsed = SaveEstimateArgs(**args)
            result = call_update_estimate(
                parsed.estimateId, parsed.as_changes(), True, caller_user_id, caller_name, caller_role,
            )
        elif action == "get_estimate_history":
            parsed = EstimateIdArgs(**args)
            result = call_get_estimate_history(parsed.estimateId, caller_user_id, caller_name, caller_role)
        elif action == "compare_estimates":
            parsed = CompareEstimatesArgs(**args)
            result = call_compare_estimates(
                parsed.estimateId, parsed.versionA, parsed.versionB, caller_user_id, caller_name, caller_role,
            )
        else:
            return {
                "estimate_mgmt_error": "no_action_identified",
                "agent_trail": trail_step("estimate_mgmt", "Unrecognized action", action),
            }
    except ValidationError as err:
        fields = sorted({str(e["loc"][0]) for e in err.errors()})
        return {
            "estimate_mgmt_error": "invalid_arguments",
            "estimate_mgmt_error_detail": ", ".join(fields),
            "agent_trail": trail_step("estimate_mgmt", "Invalid arguments", ", ".join(fields)),
        }
    except httpx.HTTPError as err:
        return {
            "estimate_mgmt_error": "service_unavailable",
            "agent_trail": trail_step("estimate_mgmt", "Estimate service unreachable", str(err)),
        }

    if not result.get("success"):
        detail = result.get("error", "reason unknown")
        return {
            "estimate_mgmt_error": "denied_or_failed",
            "estimate_mgmt_error_detail": detail,
            "agent_trail": trail_step("estimate_mgmt", f"{action} denied or failed", detail),
        }

    return {
        "estimate_mgmt_action": action,
        "estimate_mgmt_result": result,
        "agent_trail": trail_step("estimate_mgmt", f"{action} executed", ""),
    }
