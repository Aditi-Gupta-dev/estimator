"""End-to-end graph tests via /api/eva, focused on Phase A's new explicit
short-circuit behavior: CLARIFY/OUT_OF_SCOPE/NAVIGATE must skip both
retrieval and the generation LLM call entirely, and every response must
carry a non-empty agentTrail.
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.config import settings  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage import faiss_manager as faiss_manager_module  # noqa: E402
from src.storage.db import init_db  # noqa: E402

DIM = 16


class _FakeResponse:
    def __init__(self, content):
        self.content = content


class FakeChatModel:
    def __init__(self, plan: dict, answer_text: str = "unused"):
        self.plan = plan
        self.answer_text = answer_text
        self.generation_calls: list = []

    def invoke(self, prompt):
        if isinstance(prompt, str):
            return _FakeResponse(json.dumps(self.plan))
        self.generation_calls.append(prompt)
        return _FakeResponse(self.answer_text)


class DeterministicFakeEmbeddings:
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)

    def _vec(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        arr = np.frombuffer(digest[:DIM * 4].ljust(DIM * 4, b"\0"), dtype=np.uint8)[:DIM].astype(np.float32)
        return (arr / (np.linalg.norm(arr) or 1.0)).tolist()


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(settings, "eva_faiss_dir", str(tmp_path / "faiss_indexes"))
    monkeypatch.setattr(settings, "eva_markdown_dir", str(tmp_path / "markdown_cache"))
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    monkeypatch.setattr(faiss_manager_module, "_manager", None)
    init_db()
    return tmp_path


def _client(monkeypatch, fake_llm):
    import src.routes.chat_route as chat_route_module

    monkeypatch.setattr(chat_route_module, "get_llm", lambda _settings: fake_llm)
    monkeypatch.setattr(
        chat_route_module, "get_embeddings",
        lambda _settings: (DeterministicFakeEmbeddings(), "local::fake-test-model"),
    )
    from src.main import app

    return TestClient(app, headers={"x-internal-key": settings.internal_api_key})


def _base_plan(intent: str, **overrides) -> dict:
    plan = {
        "intent": intent, "needs_retrieval": False, "filters": {},
        "queries": ["q"], "k": 5, "requires_actuals": False,
        "missing_inputs": [], "reasoning": "test",
    }
    plan.update(overrides)
    return plan


@pytest.mark.parametrize("intent,expected_step", [
    ("CLARIFY", "clarify"),
    ("OUT_OF_SCOPE", "out_of_scope"),
    ("NAVIGATE", "navigate"),
])
def test_short_circuit_intents_skip_generation(isolated_env, monkeypatch, intent, expected_step):
    plan = _base_plan(intent, missing_inputs=["scope_modules"] if intent == "CLARIFY" else [])
    fake_llm = FakeChatModel(plan)
    client = _client(monkeypatch, fake_llm)

    resp = client.post("/api/eva", json={"message": "hello", "callerRole": "estimator", "unitId": "esu"})
    assert resp.status_code == 200
    data = resp.json()

    # The generation LLM call must never happen for these intents.
    assert len(fake_llm.generation_calls) == 0
    assert data["answer"]  # a canned reply was still produced

    steps = [s["step"] for s in data["agentTrail"]]
    assert "supervisor" in steps
    assert expected_step in steps
    assert "generate" not in steps
    assert "retrieve" not in steps


def test_retrieve_intent_produces_full_trail(isolated_env, monkeypatch):
    plan = _base_plan("RETRIEVE", needs_retrieval=True)
    fake_llm = FakeChatModel(plan, "Here is the answer.")
    client = _client(monkeypatch, fake_llm)

    resp = client.post("/api/eva", json={"message": "What is the standard guideline?", "callerRole": "estimator", "unitId": "esu"})
    assert resp.status_code == 200
    data = resp.json()

    steps = [s["step"] for s in data["agentTrail"]]
    assert steps == ["supervisor", "retrieve", "generate"]
    assert len(fake_llm.generation_calls) == 1
    assert data["mlCalibration"] is None


def test_assess_risk_without_wants_score_tool_never_touches_estimate_node(isolated_env, monkeypatch):
    # Phase C: a general risk question (wants_score_tool=False) must go
    # straight to generate, never estimate_tool — bind_tools would raise on
    # this FakeChatModel since it doesn't implement it, proving the point.
    plan = _base_plan("ASSESS_RISK", needs_retrieval=True, wants_score_tool=False)
    fake_llm = FakeChatModel(plan, "General ERP risks include scope creep.")
    client = _client(monkeypatch, fake_llm)

    resp = client.post("/api/eva", json={"message": "What typically goes wrong in ERP migrations?", "callerRole": "estimator", "unitId": "esu"})
    assert resp.status_code == 200
    data = resp.json()

    steps = [s["step"] for s in data["agentTrail"]]
    assert steps == ["supervisor", "retrieve", "generate"]
    assert "estimate_tool" not in steps


def test_assess_risk_with_wants_score_tool_routes_through_estimate_node(isolated_env, monkeypatch):
    # wants_score_tool=True routes through estimate_tool; this FakeChatModel
    # has no tool_calls support (its .invoke() always returns plain text),
    # so extraction naturally yields "no tool call" -> clarify, proving the
    # routing itself without needing a full tool-call fake here (that's
    # test_estimate_tool.py's job).
    plan = _base_plan("ASSESS_RISK", needs_retrieval=True, wants_score_tool=True)
    fake_llm = FakeChatModel(plan, "unused")
    fake_llm.bind_tools = lambda tools: fake_llm  # minimal stub, no tool_calls attr
    client = _client(monkeypatch, fake_llm)

    resp = client.post("/api/eva", json={
        "message": "Score the risk: complexity High, 4 modules, 6 integrations, 12 entities.",
        "callerRole": "estimator", "unitId": "esu",
    })
    assert resp.status_code == 200
    data = resp.json()

    steps = [s["step"] for s in data["agentTrail"]]
    assert steps == ["supervisor", "retrieve", "estimate_tool", "clarify"]
    # Exactly one LLM call happened (the estimate tool's own extraction
    # attempt) — generate_node's answer-generation call never fires since
    # route_after_estimate_tool sends a missing-fields result to clarify.
    assert len(fake_llm.generation_calls) == 1
    assert data["mlCalibration"] is None
