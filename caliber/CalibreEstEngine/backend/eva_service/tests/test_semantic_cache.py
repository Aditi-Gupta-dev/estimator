import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.cache.semantic_cache import SemanticCache  # noqa: E402
from src.config import settings  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage import faiss_manager as faiss_manager_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.models import Chunk, Document  # noqa: E402

DIM = 16


class _FakeResponse:
    def __init__(self, content):
        self.content = content


class FakeChatModel:
    def __init__(self, plan: dict, answer_text: str):
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


# ── Unit-level: SemanticCache directly ────────────────────────────────────────

def test_cache_write_then_lookup_hits_same_query(isolated_env):
    cache = SemanticCache(threshold=0.93)
    embeddings = DeterministicFakeEmbeddings()

    with session_scope() as session:
        result = cache.lookup(session, query_text="What is the CRP cycle length?", caller_role="estimator", unit_id="esu", embedding_provider="local", embeddings=embeddings)
        assert result.hit is None

        cache.write(
            session, query_text="What is the CRP cycle length?", query_embedding_bytes=result.query_embedding_bytes,
            embedding_provider="local", embedding_model="fake-test-model", answer_text="4-6 weeks [C1].",
            citations=[{"tag": "C1"}], caller_role="estimator", unit_id="esu", subdivision="data",
            document_class="guideline", intent="RETRIEVE",
        )

    with session_scope() as session:
        result2 = cache.lookup(session, query_text="What is the CRP cycle length?", caller_role="estimator", unit_id="esu", embedding_provider="local", embeddings=embeddings)
        assert result2.hit is not None
        assert result2.hit.answer_text == "4-6 weeks [C1]."


def test_cache_lookup_misses_for_different_role(isolated_env):
    cache = SemanticCache(threshold=0.93)
    embeddings = DeterministicFakeEmbeddings()

    with session_scope() as session:
        result = cache.lookup(session, query_text="What is the rate card?", caller_role="admin", unit_id="esu", embedding_provider="local", embeddings=embeddings)
        cache.write(
            session, query_text="What is the rate card?", query_embedding_bytes=result.query_embedding_bytes,
            embedding_provider="local", embedding_model="fake-test-model", answer_text="$100/hr [C1].",
            citations=[], caller_role="admin", unit_id="esu", subdivision="data",
            document_class="ratecard", intent="RETRIEVE",
        )

    with session_scope() as session:
        as_estimator = cache.lookup(session, query_text="What is the rate card?", caller_role="estimator", unit_id="esu", embedding_provider="local", embeddings=embeddings)
        assert as_estimator.hit is None


def test_cache_lookup_misses_across_embedding_providers(isolated_env):
    cache = SemanticCache(threshold=0.93)
    embeddings = DeterministicFakeEmbeddings()

    with session_scope() as session:
        result = cache.lookup(session, query_text="Guideline question", caller_role="sme", unit_id="esu", embedding_provider="local", embeddings=embeddings)
        cache.write(
            session, query_text="Guideline question", query_embedding_bytes=result.query_embedding_bytes,
            embedding_provider="local", embedding_model="fake-test-model", answer_text="Answer [C1].",
            citations=[], caller_role="sme", unit_id="esu", subdivision="data",
            document_class="guideline", intent="RETRIEVE",
        )

    with session_scope() as session:
        # Same role/unit/query, but the corporate network switched the
        # active provider to openai — must not reuse the local-space cache.
        as_openai = cache.lookup(session, query_text="Guideline question", caller_role="sme", unit_id="esu", embedding_provider="openai", embeddings=embeddings)
        assert as_openai.hit is None


# ── Integration: via /api/eva ─────────────────────────────────────────────────

def _seed(session):
    doc = Document(
        bu_folder="ESU", unit_id="esu", subdivision="data", title="Seeded Doc",
        document_class="guideline", program_type=None, file_type="csv",
        original_path="esu/data/guideline.csv", markdown_path="markdown/x.md",
        sidecar_path=None, status="published", access_roles=json.dumps(["admin", "super", "sme", "estimator"]),
        version="1.0", content_hash="h",
    )
    session.add(doc)
    session.flush()
    session.add(Chunk(document_id=doc.id, chunk_index=0, section_path="Sheet: Data", text="CRP cycles run 4-6 weeks.", token_count=10, content_hash="c"))
    session.flush()


def _client(monkeypatch, fake_llm):
    import src.routes.chat_route as chat_route_module

    monkeypatch.setattr(chat_route_module, "get_llm", lambda _settings: fake_llm)
    monkeypatch.setattr(
        chat_route_module, "get_embeddings",
        lambda _settings: (DeterministicFakeEmbeddings(), "local::fake-test-model"),
    )
    from src.main import app

    return TestClient(app, headers={"x-internal-key": settings.internal_api_key})


def test_repeat_question_same_role_hits_cache(isolated_env, monkeypatch):
    with session_scope() as session:
        _seed(session)

    plan = {
        "intent": "RETRIEVE", "needs_retrieval": True,
        "filters": {"unit_id": "esu", "subdivision": "data"},
        "queries": ["CRP cycle length"], "k": 5,
        "requires_actuals": False, "missing_inputs": [], "reasoning": "test",
    }
    fake_llm = FakeChatModel(plan, "CRP cycles run 4-6 weeks [C1].")
    client = _client(monkeypatch, fake_llm)

    body = {"message": "How long do CRP cycles run?", "callerRole": "estimator", "unitId": "esu"}

    first = client.post("/api/eva", json=body).json()
    assert first["cacheHit"] is False
    assert len(fake_llm.generation_calls) == 1

    second = client.post("/api/eva", json=body).json()
    assert second["cacheHit"] is True
    assert second["answer"] == first["answer"]
    # The LLM must not have been called again for generation.
    assert len(fake_llm.generation_calls) == 1


def test_repeat_question_different_role_misses_cache(isolated_env, monkeypatch):
    with session_scope() as session:
        _seed(session)

    plan = {
        "intent": "RETRIEVE", "needs_retrieval": True,
        "filters": {"unit_id": "esu", "subdivision": "data"},
        "queries": ["CRP cycle length"], "k": 5,
        "requires_actuals": False, "missing_inputs": [], "reasoning": "test",
    }
    fake_llm = FakeChatModel(plan, "CRP cycles run 4-6 weeks [C1].")
    client = _client(monkeypatch, fake_llm)

    client.post("/api/eva", json={"message": "How long do CRP cycles run?", "callerRole": "estimator", "unitId": "esu"})
    resp = client.post("/api/eva", json={"message": "How long do CRP cycles run?", "callerRole": "admin", "unitId": "esu"})

    assert resp.json()["cacheHit"] is False
    assert len(fake_llm.generation_calls) == 2
