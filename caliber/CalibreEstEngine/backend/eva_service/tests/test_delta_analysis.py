"""Phase 5 — AI delta interpretation. Mirrors test_chat_route.py's fake-LLM
pattern (monkeypatch get_llm on the route module, TestClient against the
real app) since delta_route.py follows the exact same shape as chat_route.py.

The real Groq credentials configured in this dev environment return
404 model_not_found (a pre-existing, unrelated environment issue — verified
independently against the isolated Node test suite's live log output) so
these tests never depend on real network/LLM access, same as every other
LLM-touching test in this suite.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from src.agents.delta_analysis import DeltaAIAnalysis, SYSTEM_PROMPT, _format_deterministic_delta, analyze_delta  # noqa: E402
from src.config import settings  # noqa: E402

VALID_ANALYSIS = {
    "summary": "Effort increased due to added integration scope.",
    "key_changes": ["Effort increased from 120 to 155 days (+29.2%)."],
    "likely_drivers": ["The added Data Migration component likely drove the increase."],
    "impact": "Moderate schedule risk given the unchanged duration.",
    "risks": ["Duration was not extended to match the added scope."],
    "recommendations": ["Confirm whether duration should also be revised."],
    "confidence": "medium",
    "scope_creep_indicated": False,
}

SAMPLE_DELTA = {
    "previousVersionId": "v1", "currentVersionId": "v2", "changeReason": "Client added integration modules.",
    "changedFields": ["totalWithContingency"],
    "numericDeltas": [
        {"category": "effort", "field": "totalWithContingency", "previous": 120, "current": 155, "delta": 35, "deltaPct": 29.2},
    ],
    "addedItems": [{"type": "component", "name": "Data Migration", "complexity": "M", "volume": 1}],
    "removedItems": [],
    "modifiedItems": [],
}


class _StructuredWrapper:
    def __init__(self, result, schema):
        self._result = result
        self._schema = schema

    def invoke(self, _messages):
        if isinstance(self._result, Exception):
            raise self._result
        if isinstance(self._result, dict):
            return self._schema(**self._result)  # validates — raises ValidationError on a bad shape
        return self._result


class FakeDeltaLLM:
    """result: a dict (validated against the schema passed to
    with_structured_output), an Exception instance to raise, or an
    already-built model instance."""
    def __init__(self, result):
        self.result = result

    def with_structured_output(self, schema):
        return _StructuredWrapper(self.result, schema)


def test_format_deterministic_delta_only_restates_given_numbers():
    text = _format_deterministic_delta(SAMPLE_DELTA)
    assert "120 -> 155" in text
    assert "+35" in text
    assert "ADDED: component 'Data Migration'" in text


def test_system_prompt_distinguishes_facts_from_inferences():
    assert "FACT" in SYSTEM_PROMPT.upper() or "facts" in SYSTEM_PROMPT.lower()
    assert "inference" in SYSTEM_PROMPT.lower()
    assert "do not" in SYSTEM_PROMPT.lower()  # instructs against inventing numbers


def test_analyze_delta_returns_validated_structured_result():
    llm = FakeDeltaLLM(VALID_ANALYSIS)
    result = analyze_delta(llm, SAMPLE_DELTA, {"estimateName": "Test Estimate", "changeReason": "Client added integration modules."})
    assert isinstance(result, DeltaAIAnalysis)
    assert result.confidence == "medium"
    assert result.scope_creep_indicated is False
    assert len(result.key_changes) == 1


def test_analyze_delta_rejects_malformed_output():
    # Missing required fields (summary, key_changes, ...) and an invalid confidence value.
    llm = FakeDeltaLLM({"confidence": "extremely-sure"})
    with pytest.raises(ValidationError):
        analyze_delta(llm, SAMPLE_DELTA, {})


def _client(monkeypatch, fake_llm_or_error):
    import src.routes.delta_route as delta_route_module

    if isinstance(fake_llm_or_error, Exception):
        def _raise(_settings):
            raise fake_llm_or_error
        monkeypatch.setattr(delta_route_module, "get_llm", _raise)
    else:
        monkeypatch.setattr(delta_route_module, "get_llm", lambda _settings: fake_llm_or_error)

    from src.main import app
    return TestClient(app, headers={"x-internal-key": settings.internal_api_key})


def test_delta_route_success(monkeypatch):
    client = _client(monkeypatch, FakeDeltaLLM(VALID_ANALYSIS))
    resp = client.post("/internal/delta-analysis", json={
        "deterministicDelta": SAMPLE_DELTA, "estimateName": "Test Estimate", "changeReason": "Client added integration modules.",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"] == VALID_ANALYSIS["summary"]
    assert set(body.keys()) == set(VALID_ANALYSIS.keys())


def test_delta_route_malformed_output_returns_422_not_stored_as_trusted(monkeypatch):
    client = _client(monkeypatch, FakeDeltaLLM({"confidence": "not-a-valid-level"}))
    resp = client.post("/internal/delta-analysis", json={"deterministicDelta": SAMPLE_DELTA})
    assert resp.status_code == 422


def test_delta_route_llm_call_failure_returns_502(monkeypatch):
    client = _client(monkeypatch, FakeDeltaLLM(RuntimeError("upstream exploded")))
    resp = client.post("/internal/delta-analysis", json={"deterministicDelta": SAMPLE_DELTA})
    assert resp.status_code == 502


def test_delta_route_no_llm_configured_returns_503(monkeypatch):
    client = _client(monkeypatch, RuntimeError("No LLM provider configured"))
    resp = client.post("/internal/delta-analysis", json={"deterministicDelta": SAMPLE_DELTA})
    assert resp.status_code == 503


def test_delta_route_requires_internal_key():
    from src.main import app
    client = TestClient(app)  # no x-internal-key header
    resp = client.post("/internal/delta-analysis", json={"deterministicDelta": SAMPLE_DELTA})
    assert resp.status_code == 401
