"""Tests for EVA's persisted-estimate management: action extraction, the
service-call seam, the propose-then-confirm two-tool split, error handling,
formatting, and routing.

Follows the repo convention of monkeypatching Python-function boundaries
(here, _call_internal) rather than mocking HTTP transport — same approach
test_scenario_tool.py takes with call_scenario_service.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from src.agents import estimate_persistence_tool as mgmt_module  # noqa: E402
from src.agents.estimate_persistence_tool import (  # noqa: E402
    CreateEstimateArgs,
    SaveEstimateArgs,
    UpdateEstimateArgs,
    estimate_management_node,
    format_estimate_mgmt_block,
    is_estimate_management_question,
)
from src.agents.graph import route_after_estimate_mgmt, route_after_retrieve  # noqa: E402
from src.retrieval.planner import INTENT  # noqa: E402

BASE_INPUTS = {
    "sectionA": {"duration_months": 18, "contingency_pct": 15, "onshore_pct": 30},
    "overrides": {"Some Component": {"complexity": "M", "volume": 1, "included": True}},
    "overallComplexity": "H",
    "industry": "BFSI",
}


def make_ctx(with_raw=True):
    return {
        "estimateId": "draft-1",
        "rawInputs": BASE_INPUTS if with_raw else None,
    }


VERSION_1 = {
    "version": 1,
    "inputs": BASE_INPUTS,
    "bottomUp": {"totalWithContingency": 2111, "totalCost": 1683705, "totalAvgFte": 5.9},
    "ml": {"riskBand": "GREEN", "overrunProbability": 0.2},
    "health": {"status": "GREEN"},
    "createdByUserId": "u-1",
    "createdAt": "2026-01-01T00:00:00Z",
}

VERSION_2 = {
    **VERSION_1,
    "version": 2,
    "bottomUp": {"totalWithContingency": 2157, "totalCost": 1726694, "totalAvgFte": 6.0},
}

ESTIMATE_RECORD = {
    "id": "est-abc123",
    "ownerUserId": "u-1",
    "businessUnit": None,
    "name": "BFSI Q3",
    "status": "draft",
    "currentVersion": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
    "latestVersion": VERSION_1,
}


class _FakeToolResponse:
    def __init__(self, tool_calls):
        self.content = ""
        self.tool_calls = tool_calls


class _FakeLLM:
    def __init__(self, tool_calls=None, raises=False):
        self._tool_calls = tool_calls or []
        self._raises = raises

    def bind_tools(self, _tools):
        return self

    def invoke(self, _messages):
        if self._raises:
            raise RuntimeError("llm exploded")
        return _FakeToolResponse(self._tool_calls)


class _NoToolsLLM:
    pass


ACTOR_STATE = {"caller_role": "estimator", "caller_user_id": "u-1", "caller_name": "Sneha Pillai"}


def base_state(**overrides):
    state = {
        "message": "save this estimate",
        "estimator_context": make_ctx(),
        "recent_messages": [],
        "llm": _FakeLLM(),
        **ACTOR_STATE,
    }
    state.update(overrides)
    return state


# ── Change-set schema reuse ──────────────────────────────────────────────────

def test_update_args_drops_estimate_id_from_changes():
    args = UpdateEstimateArgs(estimateId="est-1", durationMonthsDelta=1)
    assert args.as_changes() == {"durationMonthsDelta": 1}
    assert "estimateId" not in args.as_changes()


def test_save_args_same_shape_as_update_args():
    args = SaveEstimateArgs(estimateId="est-1", moduleEffortMultiplier={"Integration": 1.1})
    assert args.as_changes() == {"moduleEffortMultiplier": {"Integration": 1.1}}


def test_create_args_has_no_estimate_contents():
    # By construction — CreateEstimateArgs has no field for overrides/sectionA,
    # so the LLM has no way to author estimator inputs even if it tried.
    assert set(CreateEstimateArgs.model_fields) == {"name"}


# ── Question detection ──────────────────────────────────────────────────────

@pytest.mark.parametrize("q", [
    "save this estimate", "create an estimate from this", "show me the estimate history",
    "compare version 1 and version 2", "update estimate est-abc123, increase duration by a month",
    "open estimate est-abc123",
])
def test_estimate_mgmt_questions_detected(q):
    assert is_estimate_management_question(q) is True


@pytest.mark.parametrize("q", ["what is my current cost?", "what is RAG?", "what if I increase effort by 10%?"])
def test_non_estimate_mgmt_questions_not_detected(q):
    assert is_estimate_management_question(q) is False


# ── estimate_management_node: happy paths ────────────────────────────────────

def test_create_estimate_uses_live_context_never_llm_authored_inputs(monkeypatch):
    captured = {}

    def fake(path, body, timeout=20.0):
        captured["path"] = path
        captured["body"] = body
        return {"success": True, "estimate": ESTIMATE_RECORD}

    monkeypatch.setattr(mgmt_module, "_call_internal", fake)
    out = estimate_management_node(base_state(
        message="save this estimate as BFSI Q3",
        llm=_FakeLLM([{"name": "create_estimate", "args": {"name": "BFSI Q3"}}]),
    ))
    assert out["estimate_mgmt_action"] == "create_estimate"
    assert captured["path"] == "/internal/estimates"
    # The inputs sent are exactly the live estimator_context snapshot — never
    # anything the LLM's tool-call args could have supplied.
    assert captured["body"]["inputs"] == BASE_INPUTS
    assert captured["body"]["name"] == "BFSI Q3"
    assert captured["body"]["actorUserId"] == "u-1"
    assert captured["body"]["actorRole"] == "estimator"


def test_create_estimate_without_active_estimate():
    out = estimate_management_node(base_state(
        estimator_context=make_ctx(with_raw=False),
        llm=_FakeLLM([{"name": "create_estimate", "args": {}}]),
    ))
    assert out["estimate_mgmt_error"] == "no_base_inputs"


def test_get_estimate_returns_result(monkeypatch):
    monkeypatch.setattr(mgmt_module, "_call_internal",
                        lambda *a, **k: {"success": True, "estimate": ESTIMATE_RECORD})
    out = estimate_management_node(base_state(
        message="open estimate est-abc123",
        llm=_FakeLLM([{"name": "get_estimate", "args": {"estimateId": "est-abc123"}}]),
    ))
    assert out["estimate_mgmt_result"]["estimate"]["id"] == "est-abc123"


def test_update_estimate_proposes_without_persisting(monkeypatch):
    captured = {}

    def fake(path, body, timeout=20.0):
        captured["path"] = path
        captured["body"] = body
        return {
            "success": True, "persisted": False,
            "result": {
                "estimateId": "est-abc123", "currentVersion": 1, "persisted": False,
                "bottomUp": VERSION_2["bottomUp"], "ml": VERSION_2["ml"], "coverage": {},
            },
        }

    monkeypatch.setattr(mgmt_module, "_call_internal", fake)
    out = estimate_management_node(base_state(
        message="update estimate est-abc123, extend duration by 1 month",
        llm=_FakeLLM([{
            "name": "update_estimate",
            "args": {"estimateId": "est-abc123", "durationMonthsDelta": 1},
        }]),
    ))
    assert out["estimate_mgmt_action"] == "update_estimate"
    assert captured["path"] == "/internal/estimates/est-abc123/update"
    assert captured["body"]["persist"] is False
    assert captured["body"]["changes"] == {"durationMonthsDelta": 1}


def test_save_estimate_persists(monkeypatch):
    captured = {}

    def fake(path, body, timeout=20.0):
        captured["path"] = path
        captured["body"] = body
        return {"success": True, "persisted": True, "result": {**ESTIMATE_RECORD, "currentVersion": 2, "latestVersion": VERSION_2}}

    monkeypatch.setattr(mgmt_module, "_call_internal", fake)
    out = estimate_management_node(base_state(
        message="yes, save that",
        llm=_FakeLLM([{
            "name": "save_estimate",
            "args": {"estimateId": "est-abc123", "durationMonthsDelta": 1},
        }]),
    ))
    assert out["estimate_mgmt_action"] == "save_estimate"
    assert captured["body"]["persist"] is True
    assert out["estimate_mgmt_result"]["result"]["currentVersion"] == 2


def test_get_estimate_history(monkeypatch):
    monkeypatch.setattr(mgmt_module, "_call_internal",
                        lambda *a, **k: {"success": True, "versions": [VERSION_1, VERSION_2]})
    out = estimate_management_node(base_state(
        message="show me the estimate history for est-abc123",
        llm=_FakeLLM([{"name": "get_estimate_history", "args": {"estimateId": "est-abc123"}}]),
    ))
    assert len(out["estimate_mgmt_result"]["versions"]) == 2


def test_compare_estimates(monkeypatch):
    monkeypatch.setattr(mgmt_module, "_call_internal", lambda *a, **k: {
        "success": True,
        "comparison": {
            "estimateId": "est-abc123", "versionA": VERSION_1, "versionB": VERSION_2,
            "delta": {"effortDays": 46, "cost": 42989, "fte": 0.1, "deviationPct": 0.3, "riskBandChanged": False},
        },
    })
    out = estimate_management_node(base_state(
        message="compare version 1 and version 2 of est-abc123",
        llm=_FakeLLM([{
            "name": "compare_estimates",
            "args": {"estimateId": "est-abc123", "versionA": 1, "versionB": 2},
        }]),
    ))
    assert out["estimate_mgmt_result"]["comparison"]["delta"]["effortDays"] == 46


# ── Failure branches ──────────────────────────────────────────────────────────

def test_node_fails_closed_without_verified_identity():
    out = estimate_management_node(base_state(caller_user_id=None, caller_name=None))
    assert out["estimate_mgmt_error"] == "identity_unavailable"


def test_node_without_tool_calling_support():
    out = estimate_management_node(base_state(llm=_NoToolsLLM()))
    assert out["estimate_mgmt_error"] == "tool_calling_unavailable"


def test_node_when_llm_raises():
    out = estimate_management_node(base_state(llm=_FakeLLM(raises=True)))
    assert out["estimate_mgmt_error"] == "extraction_failed"


def test_node_when_no_action_identified():
    out = estimate_management_node(base_state(llm=_FakeLLM([])))
    assert out["estimate_mgmt_error"] == "no_action_identified"


def test_node_when_required_id_missing_fails_validation():
    # get_estimate requires estimateId; a call with none must not proceed.
    out = estimate_management_node(base_state(
        llm=_FakeLLM([{"name": "get_estimate", "args": {}}]),
    ))
    assert out["estimate_mgmt_error"] == "invalid_arguments"


def test_node_surfaces_ownership_denial_rather_than_pretending_success(monkeypatch):
    """A forged/mistaken estimate id belonging to someone else must come back
    as a clean denial, never as fabricated estimate data."""
    monkeypatch.setattr(mgmt_module, "_call_internal",
                        lambda *a, **k: {"success": False, "error": "You do not have access to this estimate."})
    out = estimate_management_node(base_state(
        message="open estimate est-someone-elses",
        llm=_FakeLLM([{"name": "get_estimate", "args": {"estimateId": "est-someone-elses"}}]),
    ))
    assert out["estimate_mgmt_error"] == "denied_or_failed"
    assert "access" in out["estimate_mgmt_error_detail"].lower()
    assert "estimate_mgmt_result" not in out


def test_node_when_service_unreachable(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(mgmt_module, "_call_internal", boom)
    out = estimate_management_node(base_state(
        llm=_FakeLLM([{"name": "get_estimate", "args": {"estimateId": "est-abc123"}}]),
    ))
    assert out["estimate_mgmt_error"] == "service_unavailable"


# ── Formatting keeps proposed vs persisted visibly distinct ─────────────────

def test_format_update_marks_proposal_as_unsaved():
    text = format_estimate_mgmt_block("update_estimate", {
        "persisted": False,
        "result": {"estimateId": "est-1", "currentVersion": 1, "bottomUp": VERSION_2["bottomUp"], "ml": VERSION_2["ml"]},
    })
    assert "PROPOSED CHANGE ONLY" in text
    assert "persisted=false" in text


def test_format_save_marks_result_as_persisted():
    text = format_estimate_mgmt_block("save_estimate", {
        "persisted": True,
        "result": {**ESTIMATE_RECORD, "currentVersion": 2, "latestVersion": VERSION_2},
    })
    assert "CHANGE SAVED" in text
    assert "persisted=true" in text


def test_format_history_lists_every_version():
    text = format_estimate_mgmt_block("get_estimate_history", {"versions": [VERSION_1, VERSION_2]})
    assert "2 saved version(s)" in text
    assert "v1" in text and "v2" in text


def test_format_compare_shows_delta():
    text = format_estimate_mgmt_block("compare_estimates", {
        "comparison": {
            "versionA": VERSION_1, "versionB": VERSION_2,
            "delta": {"effortDays": 46, "cost": 42989, "fte": 0.1, "deviationPct": 0.3, "riskBandChanged": False},
        },
    })
    assert "DELTA:" in text
    assert "+46" in text


# ── Routing ───────────────────────────────────────────────────────────────────

def test_route_sends_estimate_mgmt_question_to_node():
    assert route_after_retrieve({
        "message": "save this estimate", "intent": INTENT.RETRIEVE, "plan": {},
        "caller_role": "estimator", "estimator_context": make_ctx(),
    }) == "estimate_mgmt"


def test_route_fails_closed_without_estimate_save_capability():
    """All 4 defined roles now hold ESTIMATE_SAVE (senior_mgmt, the only
    role that ever lacked it, was removed) — so this now proves the route
    fails closed for an unrecognized role, the same property generalized."""
    assert route_after_retrieve({
        "message": "save this estimate", "intent": INTENT.RETRIEVE, "plan": {},
        "caller_role": "guest", "estimator_context": make_ctx(),
    }) != "estimate_mgmt"


def test_route_fails_closed_without_a_known_role():
    assert route_after_retrieve({
        "message": "save this estimate", "intent": INTENT.RETRIEVE, "plan": {},
        "estimator_context": make_ctx(),
    }) != "estimate_mgmt"


def test_route_after_estimate_mgmt_explains_failures_rather_than_clarifying():
    assert route_after_estimate_mgmt({"estimate_mgmt_error": "denied_or_failed"}) == "generate"
    assert route_after_estimate_mgmt({"estimate_mgmt_error": "service_unavailable"}) == "generate"
    assert route_after_estimate_mgmt({"estimate_mgmt_result": {}}) == "generate"
    assert route_after_estimate_mgmt({"estimate_mgmt_error": "no_action_identified"}) == "clarify"
