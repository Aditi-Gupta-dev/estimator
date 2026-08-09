"""Tests for the estimate tool: extraction (via a fake tool-calling LLM),
ScoreProjectArgs validation, and call_estimator_service monkeypatching (no
new HTTP-mock dependency — matches the repo's existing convention of
monkeypatching Python-function boundaries).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from src.agents import estimate_tool as estimate_tool_module  # noqa: E402
from src.agents.estimate_tool import SCORE_REQUEST_FIELDS, estimate_tool_node  # noqa: E402

VALID_ARGS = {
    "complexity": "H", "industry": "BFSI", "n_modules": 4, "n_entities": 6,
    "integ_simple": 20, "integ_complex": 8, "n_reports": 25, "n_cemli": 12,
    "n_dm_objects": 15, "duration_months": 20, "team_size": 30,
    "integ_coverage_ratio": 0.67, "dm_coverage_ratio": 0.80,
}

FAKE_SCORE_RESULT = {
    "ml_calibration": {
        "predicted_deviation_pct": 12.3, "range_low_pct": 5.0, "range_high_pct": 20.0,
        "overrun_probability": 0.42, "risk_band": "AMBER",
        "historical_overrun_rate": 0.5, "historical_n_projects": 40,
        "top_drivers": [{"feature": "integ_coverage_ratio", "contribution": 0.3}],
        "model_used": {"uc1": "random_forest", "uc2": "xgboost"},
    },
    "similar_projects": [],
}


class _FakeToolResponse:
    def __init__(self, tool_calls):
        self.content = ""
        self.tool_calls = tool_calls


class FakeEstimateLLM:
    """bind_tools() flips an internal flag so the NEXT invoke() is treated
    as the extraction call — mirrors how a real tool-bound LLM behaves.
    """
    def __init__(self, tool_call_args: dict | None):
        self.tool_call_args = tool_call_args
        self._tools_bound = False

    def bind_tools(self, tools):
        self._tools_bound = True
        return self

    def invoke(self, messages):
        assert self._tools_bound, "estimate_tool_node must call bind_tools before invoke"
        if self.tool_call_args is None:
            return _FakeToolResponse([])
        return _FakeToolResponse([{"name": "score_project", "args": self.tool_call_args, "id": "call_1"}])


def _base_state(llm, **overrides):
    state = {
        "message": "Score my project", "caller_role": "estimator",
        "rolling_summary": None, "retrieved": [], "llm": llm,
    }
    state.update(overrides)
    return state


def test_estimate_tool_node_no_tool_call_returns_missing_fields(monkeypatch):
    llm = FakeEstimateLLM(tool_call_args=None)
    result = estimate_tool_node(_base_state(llm))
    assert result["score_result"] is None
    assert result["score_missing_fields"] == SCORE_REQUEST_FIELDS
    assert result["agent_trail"][0]["label"] == "Needs more input"


def test_estimate_tool_node_valid_args_calls_service_and_scores(monkeypatch):
    monkeypatch.setattr(estimate_tool_module, "call_estimator_service", lambda payload, timeout=10.0: FAKE_SCORE_RESULT)
    llm = FakeEstimateLLM(tool_call_args=VALID_ARGS)

    result = estimate_tool_node(_base_state(llm))

    assert result["score_result"] == FAKE_SCORE_RESULT
    assert result["score_request"] == VALID_ARGS
    assert "risk_band=AMBER" in result["agent_trail"][0]["detail"]


def test_estimate_tool_node_incomplete_args_returns_missing_fields(monkeypatch):
    incomplete = {k: v for k, v in VALID_ARGS.items() if k != "team_size"}
    llm = FakeEstimateLLM(tool_call_args=incomplete)

    result = estimate_tool_node(_base_state(llm))

    assert result["score_result"] is None
    assert "team_size" in result["score_missing_fields"]


def test_estimate_tool_node_service_unreachable(monkeypatch):
    def _raise(payload, timeout=10.0):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(estimate_tool_module, "call_estimator_service", _raise)
    llm = FakeEstimateLLM(tool_call_args=VALID_ARGS)

    result = estimate_tool_node(_base_state(llm))

    assert result["score_result"] is None
    assert "unreachable" in result["agent_trail"][0]["label"].lower()


def test_estimate_tool_node_llm_without_bind_tools_support():
    class NoToolsLLM:
        pass

    result = estimate_tool_node(_base_state(NoToolsLLM()))
    assert result["score_result"] is None
    assert result["score_missing_fields"] == SCORE_REQUEST_FIELDS
