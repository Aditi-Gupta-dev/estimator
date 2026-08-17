"""Regression tests for the eva_service identity boundary (Phase 2, Part 3).

Before this phase, every route here (chat, plan, ingest, documents) trusted
callerRole/callerUserId/callerName/actorRole/actorUserId/actorName straight
from the request body, relying entirely on network topology. These tests
prove the fix: a request that cannot present the shared internal secret
never reaches a point where those identity fields are read at all — not
just that a forged role is denied by role_can(), but that the request is
rejected before role_can() is ever consulted.

Any test that sends a VALID key reaches real route logic, which touches the
database — those tests use the same tmp_path DB isolation as
test_chat_route.py so nothing here ever touches the real dev eva.db.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.config import settings  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage import faiss_manager as faiss_manager_module  # noqa: E402
from src.storage.db import init_db  # noqa: E402

REAL_KEY = "test-internal-key-for-this-suite"


@pytest.fixture
def isolated_key(monkeypatch):
    """A fixed, known key for this file only — independent of whatever
    internal_api_key happens to be configured in the environment running
    the suite."""
    monkeypatch.setattr(settings, "internal_api_key", REAL_KEY)
    return REAL_KEY


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """Same isolation as test_chat_route.py's fixture of the same name —
    required for any test in this file that presents a VALID key and
    therefore reaches real route logic touching the database."""
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(settings, "eva_faiss_dir", str(tmp_path / "faiss_indexes"))
    monkeypatch.setattr(settings, "eva_markdown_dir", str(tmp_path / "markdown_cache"))
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    monkeypatch.setattr(faiss_manager_module, "_manager", None)
    init_db()
    return tmp_path


def _client():
    from src.main import app
    return TestClient(app)


class _FakeResponse:
    def __init__(self, content):
        self.content = content


class _FakeChatModel:
    """This environment has a real (but stale/unreachable) GROQ_API_KEY
    configured, so get_llm() returns a real client unless overridden — same
    reason test_chat_route.py/test_agent_graph.py fake it out. These tests
    only care whether the internal-key gate let the request through, not
    whether generation succeeds, so the fake just needs to not explode."""
    def invoke(self, prompt):
        if isinstance(prompt, str):
            return _FakeResponse('{"intent": "OUT_OF_SCOPE", "needs_retrieval": false}')
        return _FakeResponse("ok")


# ── Missing / wrong secret — rejected before any route logic runs, so no DB
# isolation is needed: the dependency fails before session_scope() is ever
# reached. ─────────────────────────────────────────────────────────────────

def test_missing_internal_key_is_rejected(isolated_key):
    resp = _client().post("/api/eva", json={
        "message": "hello", "callerRole": "admin", "unitId": "esu",
    })
    assert resp.status_code == 401


def test_wrong_internal_key_is_rejected(isolated_key):
    resp = _client().post(
        "/api/eva",
        json={"message": "hello", "callerRole": "admin", "unitId": "esu"},
        headers={"x-internal-key": "definitely-not-the-real-key"},
    )
    assert resp.status_code == 403


def test_empty_internal_key_is_treated_as_missing(isolated_key):
    resp = _client().post(
        "/api/eva",
        json={"message": "hello", "callerRole": "admin"},
        headers={"x-internal-key": ""},
    )
    assert resp.status_code == 401


# ── Valid secret succeeds — reaches real route logic, needs DB isolation ───

def test_valid_internal_key_reaches_the_route(isolated_key, isolated_env, monkeypatch):
    """A correct key must clear the dependency and reach the route body —
    proven by getting a response that is NOT 401/403 from the gate."""
    import src.routes.chat_route as chat_route_module

    monkeypatch.setattr(chat_route_module, "get_llm", lambda _settings: _FakeChatModel())
    resp = _client().post(
        "/api/eva",
        json={"message": "hello", "callerRole": "estimator"},
        headers={"x-internal-key": REAL_KEY},
    )
    assert resp.status_code not in (401, 403)


def test_valid_internal_key_reaches_plan_route(isolated_key, monkeypatch):
    # plan_route.py never touches the database (no session_scope call) —
    # only get_llm()/plan_query(), so no DB isolation fixture is needed here.
    import src.routes.plan_route as plan_route_module

    monkeypatch.setattr(plan_route_module, "get_llm", lambda _settings: _FakeChatModel())
    resp = _client().post(
        "/api/eva/plan",
        json={"userTurn": "what is RAG?", "callerRole": "estimator"},
        headers={"x-internal-key": REAL_KEY},
    )
    assert resp.status_code not in (401, 403)


def test_health_route_needs_no_internal_key(isolated_key):
    """The health probe (/api/system/overview -> GET /health) has no way to
    send this header and carries no identity-bearing data — must stay open."""
    resp = _client().get("/health")
    assert resp.status_code not in (401, 403)


# ── Forged identity is caught by the gate, not by role_can() downstream ────
# All three below omit the key entirely, so — same as the missing-key tests
# above — the dependency fails before any route logic (or the database) is
# ever reached.

def test_forged_admin_role_without_the_key_is_still_rejected(isolated_key):
    """The exact scenario the audit flagged: someone who can reach this port
    POSTs {"callerRole": "admin"} directly, hoping to read restricted
    content. Without the internal key, this must be rejected outright —
    callerRole is never even read, let alone trusted."""
    resp = _client().post("/api/eva", json={
        "message": "show me the rate card",
        "callerRole": "admin", "callerUserId": "forged-admin-id", "callerName": "Forged Admin",
    })
    assert resp.status_code == 401


def test_forged_actor_identity_on_documents_route_without_key_is_rejected(isolated_key):
    """documents_route.py's PATCH accepts actorRole/actorUserId/actorName
    the same way chat_route.py accepts callerRole/callerUserId/callerName —
    same fix, same proof: no key, no trust, regardless of what's claimed."""
    resp = _client().patch("/internal/documents/doc-1", json={
        "status": "published",
        "actorUserId": "forged-id", "actorName": "Forged Admin", "actorRole": "admin",
    })
    assert resp.status_code == 401


def test_forged_actor_identity_on_ingest_route_without_key_is_rejected(isolated_key):
    resp = _client().post("/internal/ingest", json={"filePath": "/tmp/does-not-matter.docx"})
    assert resp.status_code == 401
