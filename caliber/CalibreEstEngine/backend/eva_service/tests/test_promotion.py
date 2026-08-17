import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from src.cache.promotion import promote_cache_entries  # noqa: E402
from src.config import settings  # noqa: E402
from src.retrieval.candidate_selector import select_candidate_chunks  # noqa: E402
from src.retrieval.embed_on_demand import ensure_embedded  # noqa: E402
from src.retrieval.retriever import retrieve  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage import faiss_manager as faiss_manager_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.faiss_manager import FaissIndexManager  # noqa: E402
from src.storage.models import CacheLog, Chunk, Document

DIM = 16


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
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    monkeypatch.setattr(faiss_manager_module, "_manager", None)
    init_db()
    return tmp_path


def test_promotion_creates_retrievable_faq_chunk(isolated_env):
    embeddings = DeterministicFakeEmbeddings()
    provider_key = "local::fake-test-model"
    faiss_manager = FaissIndexManager(settings.faiss_dir)

    with session_scope() as session:
        source_doc = Document(
            bu_folder="ESU", unit_id="esu", subdivision="data", title="CRP Guideline",
            document_class="guideline", program_type=None, file_type="csv",
            original_path="esu/data/crp.csv", markdown_path="markdown/crp.md",
            sidecar_path=None, status="published",
            access_roles=json.dumps(["admin", "super", "sme", "estimator"]),
            version="1.0", content_hash="h",
        )
        session.add(source_doc)
        session.flush()
        source_chunk = Chunk(
            document_id=source_doc.id, chunk_index=0, section_path="Sheet: Data",
            text="CRP cycles run 4-6 weeks.", token_count=6, content_hash="c",
        )
        session.add(source_chunk)
        session.flush()

        entry = CacheLog(
            query_text="How long do CRP cycles run?",
            query_normalized="how long do crp cycles run?",
            query_embedding=np.array(embeddings.embed_query("How long do CRP cycles run?"), dtype=np.float32).tobytes(),
            embedding_provider="local", embedding_model="fake-test-model",
            answer_text="CRP cycles run 4-6 weeks [C1].",
            citations=json.dumps([{"tag": "C1", "document_id": source_doc.id, "chunk_id": source_chunk.id}]),
            caller_role="estimator", unit_id="esu", subdivision="data", document_class="guideline",
            filters_hash="irrelevant-for-this-test", intent="RETRIEVE",
            hit_count=5,  # above threshold
        )
        session.add(entry)
        session.flush()
        entry_id = entry.id

        promoted_count = promote_cache_entries(session, embeddings, provider_key, faiss_manager, hit_count_threshold=3)
        assert promoted_count == 1

    with session_scope() as session:
        entry = session.get(CacheLog, entry_id)
        assert entry.promoted_at is not None
        assert entry.promoted_document_id is not None

        promoted_doc = session.get(Document, entry.promoted_document_id)
        assert promoted_doc.source == "cache-derived"
        assert promoted_doc.document_class == "faq"
        # Access roles carried forward from the cited source document.
        assert set(json.loads(promoted_doc.access_roles)) == {"admin", "super", "sme", "estimator"}

        # Retrievable: a differently-worded but related query should surface
        # the promoted FAQ chunk via the normal candidate-select + retrieve path.
        candidates = select_candidate_chunks(session, caller_role="estimator", unit_id="esu")
        promoted_chunk_ids = {c.id for c in candidates if c.document_id == promoted_doc.id}
        assert len(promoted_chunk_ids) == 1

        mapping = ensure_embedded(session, candidates, embeddings, provider_key, faiss_manager)
        results = retrieve(candidates, mapping, embeddings, provider_key, faiss_manager, queries=["CRP cycle duration"], k=5)
        result_doc_ids = {r.chunk.document_id for r in results}
        assert promoted_doc.id in result_doc_ids


def test_promotion_skips_ungrounded_entries(isolated_env):
    """A cache entry with no citations (e.g. an abstention or restricted
    reply) has nothing to ground a promoted chunk in (R1) and must not be
    promoted, regardless of hit_count.
    """
    embeddings = DeterministicFakeEmbeddings()
    provider_key = "local::fake-test-model"
    faiss_manager = FaissIndexManager(settings.faiss_dir)

    with session_scope() as session:
        entry = CacheLog(
            query_text="What is the rate card?",
            query_normalized="what is the rate card?",
            query_embedding=np.array(embeddings.embed_query("What is the rate card?"), dtype=np.float32).tobytes(),
            embedding_provider="local", embedding_model="fake-test-model",
            answer_text="Rate card is role-restricted...",
            citations=json.dumps([]),
            caller_role="estimator", unit_id="esu", subdivision="data", document_class="ratecard",
            filters_hash="irrelevant", intent="RETRIEVE", hit_count=10,
        )
        session.add(entry)
        session.flush()

        promoted_count = promote_cache_entries(session, embeddings, provider_key, faiss_manager, hit_count_threshold=3)
        assert promoted_count == 0
        assert entry.promoted_at is None
