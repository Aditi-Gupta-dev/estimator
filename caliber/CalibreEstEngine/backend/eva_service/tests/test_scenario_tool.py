"""Tests for EVA's what-if scenario execution: change extraction, the
service-call seam, risk-reduction honesty, error handling, and routing.

Follows the repo convention of monkeypatching Python-function boundaries
(call_scenario_service) rather than mocking HTTP transport — same approach
test_estimate_tool.py takes with call_estimator_service.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from src.agents import scenario_tool as scenario_module  # noqa: E402
from src.agents.estimator_context import (  # noqa: E402
    format_risk_reduction_block,
    format_scenario_block,
)
from src.agents.graph import route_after_retrieve, route_after_scenario  # noqa: E402
from src.agents.scenario_tool import (  # noqa: E402
    RISK_REDUCTION_CANDIDATES,
    ScenarioChangesArgs,
    is_risk_reduction_question,
    is_scenario_question,
    scenario_node,
    suggest_risk_reduction,
)
from src.retrieval.planner import INTENT  # noqa: E402

BASE_INPUTS = {
    "sectionA": {"duration_months": 18, "contingency_pct": 15, "onshore_pct": 30},
    "overrides": {"Some Component": {"complexity": "M", "volume": 1, "included": True}},
    "overallComplexity": "H",
    "industry": "BFSI",
}


def make_ctx(with_raw=True):
    return {
        "estimateId": "est-1",
        "rawInputs": BASE_INPUTS if with_raw else None,
        "inputs": {"durationMonths": 18, "complexity": "H", "contingencyPct": 15},
        "bottomUp": {"totalEffortDays": 2111, "totalCost": 1683705, "totalFte": 5.9},
        "ml": {"riskBand": "GREEN", "overrunProbability": 0.87},
        "intelligence": {},
    }


def scenario_payload(current_prob=0.50, scenario_prob=0.40, band_from="AMBER", band_to="GREEN"):
    return {
        "success": True,
        "changesApplied": {"durationMonthsDelta": 1},
        "current": {
            "bottomUp": {"totalEffortDays": 2111, "totalCost": 1683705, "totalFte": 5.9},
            "ml": {"riskBand": band_from, "overrunProbability": current_prob},
            "intelligence": {"health": {"status": "AMBER"}},
        },
        "scenario": {
            "bottomUp": {"totalEffortDays": 2157, "totalCost": 1726694, "totalFte": 6.0},
            "ml": {"riskBand": band_to, "overrunProbability": scenario_prob},
            "intelligence": {"health": {"status": "AMBER"}},
        },
        "delta": {
            "effortDays": 46, "cost": 42989, "fte": 0.1,
            "deviationPct": 0.3, "overrunProbability": scenario_prob - current_prob,
            "riskBandChanged": band_from != band_to,
        },
    }


class _FakeToolResponse:
    def __init__(self, tool_calls):
        self.content = ""
        self.tool_calls = tool_calls


class _FakeLLM:
    """Minimal bind_tools-capable stand-in (mirrors test_estimate_tool.py)."""

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


# ── Change-set schema ───────────────────────────────────────────────────────

def test_changes_schema_drops_unset_fields():
    args = ScenarioChangesArgs(durationMonthsDelta=1)
    assert args.as_changes() == {"durationMonthsDelta": 1}


def test_changes_schema_accepts_module_multiplier():
    args = ScenarioChangesArgs(moduleEffortMultiplier={"Integration": 1.1})
    assert args.as_changes() == {"moduleEffortMultiplier": {"Integration": 1.1}}


def test_changes_schema_rejects_bad_complexity():
    with pytest.raises(Exception):
        ScenarioChangesArgs(complexity="XL")


# ── Question detection ──────────────────────────────────────────────────────

@pytest.mark.parametrize("q", [
    "what if I increase integration effort by 10%?",
    "what happens if I extend duration by a month?",
    "simulate a lower contingency",
    "how can I reduce my risk?",
])
def test_scenario_questions_detected(q):
    assert is_scenario_question(q) is True


@pytest.mark.parametrize("q", ["what is my current cost?", "what is RAG?", "review my estimate"])
def test_non_scenario_questions_not_detected(q):
    assert is_scenario_question(q) is False


def test_risk_reduction_detection():
    assert is_risk_reduction_question("how can I reduce my risk?") is True
    assert is_risk_reduction_question("what if I add a month?") is False


# ── scenario_node: happy path and every failure branch ──────────────────────

def test_scenario_node_executes_and_returns_result(monkeypatch):
    monkeypatch.setattr(scenario_module, "call_scenario_service",
                        lambda *a, **k: scenario_payload())
    out = scenario_node({
        "message": "what if I extend duration by 1 month?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM([{"name": "run_estimate_scenario", "args": {"durationMonthsDelta": 1}}]),
    })
    assert out["scenario_request"] == {"durationMonthsDelta": 1}
    assert out["scenario_result"]["scenario"]["bottomUp"]["totalEffortDays"] == 2157
    assert out["agent_trail"][0]["step"] == "scenario"


def test_scenario_node_without_active_estimate():
    out = scenario_node({
        "message": "what if I extend duration?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(with_raw=False),
        "llm": _FakeLLM(),
    })
    assert out["scenario_error"] == "no_base_inputs"


def test_scenario_node_without_tool_calling_support():
    out = scenario_node({
        "message": "what if I extend duration?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _NoToolsLLM(),
    })
    assert out["scenario_error"] == "tool_calling_unavailable"


def test_scenario_node_when_llm_raises():
    out = scenario_node({
        "message": "what if I extend duration?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM(raises=True),
    })
    assert out["scenario_error"] == "extraction_failed"


def test_scenario_node_when_no_change_identified():
    out = scenario_node({
        "message": "what if things change?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM([]),  # model declined to call the tool
    })
    assert out["scenario_error"] == "no_change_identified"


def test_scenario_node_when_tool_called_with_no_actual_changes():
    out = scenario_node({
        "message": "what if?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM([{"name": "run_estimate_scenario", "args": {}}]),
    })
    assert out["scenario_error"] == "no_change_identified"


def test_scenario_node_surfaces_out_of_range_rejection(monkeypatch):
    monkeypatch.setattr(scenario_module, "call_scenario_service",
                        lambda *a, **k: {"validation_error": "durationMonths of 999 is outside range."})
    out = scenario_node({
        "message": "what if duration were 999 months?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM([{"name": "run_estimate_scenario", "args": {"durationMonths": 999}}]),
    })
    assert out["scenario_error"] == "unsupported_change"
    assert "999" in out["scenario_error_detail"]


def test_scenario_node_when_service_unreachable(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(scenario_module, "call_scenario_service", boom)
    out = scenario_node({
        "message": "what if I extend duration by 1 month?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _FakeLLM([{"name": "run_estimate_scenario", "args": {"durationMonthsDelta": 1}}]),
    })
    assert out["scenario_error"] == "service_unavailable"


# ── Risk reduction must never recommend an unverified improvement ───────────

def test_risk_reduction_returns_only_real_improvements(monkeypatch):
    def fake(base, changes, role, **k):
        # Only the duration candidate actually helps.
        if changes.get("durationMonthsDelta") == 1:
            return scenario_payload(current_prob=0.50, scenario_prob=0.30)
        return scenario_payload(current_prob=0.50, scenario_prob=0.55)
    monkeypatch.setattr(scenario_module, "call_scenario_service", fake)

    out = suggest_risk_reduction(BASE_INPUTS, "estimator")
    assert len(out) == 1
    assert out[0]["label"] == "Extend duration by 1 month"
    assert out[0]["scenarioOverrunProbability"] == 0.30


def test_risk_reduction_returns_empty_when_nothing_helps(monkeypatch):
    monkeypatch.setattr(scenario_module, "call_scenario_service",
                        lambda *a, **k: scenario_payload(current_prob=0.50, scenario_prob=0.70))
    assert suggest_risk_reduction(BASE_INPUTS, "estimator") == []


def test_risk_reduction_skips_failed_candidates_rather_than_guessing(monkeypatch):
    def flaky(base, changes, role, **k):
        if changes.get("durationMonthsDelta") == 1:
            return scenario_payload(current_prob=0.50, scenario_prob=0.30)
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(scenario_module, "call_scenario_service", flaky)

    out = suggest_risk_reduction(BASE_INPUTS, "estimator")
    assert [o["label"] for o in out] == ["Extend duration by 1 month"]


def test_risk_reduction_node_path(monkeypatch):
    monkeypatch.setattr(scenario_module, "call_scenario_service",
                        lambda *a, **k: scenario_payload(current_prob=0.50, scenario_prob=0.40))
    out = scenario_node({
        "message": "how can I reduce my risk?",
        "caller_role": "estimator",
        "estimator_context": make_ctx(),
        "llm": _NoToolsLLM(),  # risk-reduction needs no extraction at all
    })
    assert len(out["risk_reduction"]) == len(RISK_REDUCTION_CANDIDATES[:3])
    assert "risk-reduction" in out["agent_trail"][0]["label"].lower()


# ── Rendering keeps CURRENT and SCENARIO distinct ───────────────────────────

def test_scenario_block_separates_current_and_scenario():
    text = format_scenario_block(scenario_payload())
    assert "CURRENT:" in text and "SCENARIO:" in text
    assert "2111" in text and "2157" in text
    assert "saved estimate is unchanged" in text


def test_empty_risk_reduction_block_forbids_invention():
    text = format_risk_reduction_block([])
    assert "No evaluated change reduced" in text
    assert "do not invent" in text.lower()


# ── Routing ─────────────────────────────────────────────────────────────────

def test_route_sends_what_if_to_scenario():
    assert route_after_retrieve({
        "message": "what if I increase integration effort by 10%?",
        "intent": INTENT.RETRIEVE, "plan": {}, "caller_role": "estimator",
        "estimator_context": make_ctx(),
    }) == "scenario"


def test_route_fails_closed_without_a_known_role():
    """Scenario access is capability-gated, so a missing/unknown role must not
    fall through to the tool."""
    assert route_after_retrieve({
        "message": "what if I increase integration effort by 10%?",
        "intent": INTENT.RETRIEVE, "plan": {}, "estimator_context": make_ctx(),
    }) != "scenario"


def test_route_sends_read_question_to_estimator_context_not_scenario():
    assert route_after_retrieve({
        "message": "what is my current cost?",
        "intent": INTENT.RETRIEVE, "plan": {}, "estimator_context": make_ctx(),
    }) == "estimator_context"


def test_route_scenario_requires_context():
    assert route_after_retrieve({
        "message": "what if I increase integration effort by 10%?",
        "intent": INTENT.RETRIEVE, "plan": {}, "estimator_context": None,
    }) == "generate"


def test_score_tool_still_wins_for_hypothetical_projects():
    assert route_after_retrieve({
        "message": "what if we scored a new High complexity BFSI project?",
        "intent": INTENT.ESTIMATE, "plan": {"wants_score_tool": True},
        "estimator_context": make_ctx(),
    }) == "estimate_tool"


def test_route_after_scenario_explains_failures_rather_than_clarifying():
    assert route_after_scenario({"scenario_error": "unsupported_change"}) == "generate"
    assert route_after_scenario({"scenario_error": "service_unavailable"}) == "generate"
    assert route_after_scenario({"scenario_result": {}}) == "generate"
    assert route_after_scenario({"scenario_error": "no_change_identified"}) == "clarify"
