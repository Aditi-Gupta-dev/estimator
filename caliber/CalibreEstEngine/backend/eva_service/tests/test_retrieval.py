import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from src.config import settings  # noqa: E402
from src.retrieval.candidate_selector import select_candidate_chunks  # noqa: E402
from src.retrieval.embed_on_demand import ensure_embedded  # noqa: E402
from src.retrieval.retriever import retrieve  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.faiss_manager import FaissIndexManager  # noqa: E402
from src.storage.models import ChunkEmbedding, Document, Chunk  # noqa: E402

DIM = 16


class DeterministicFakeEmbeddings:
    """Hash-based fake embeddings — no real model/API call, but stable and
    directionally meaningful enough (same text -> same vector; different
    text -> different vector) for retrieval-plumbing tests.
    """

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
    init_db()
    return tmp_path


def _seed_documents(session):
    for i, (unit, doc_class, sub, status) in enumerate([
        ("esu", "guideline", "data", "published"),
        ("esu", "template", "templates", "published"),
        ("adm", "guideline", "data", "published"),
        ("esu", "ratecard", "data", "published"),  # restricted from estimator
        ("esu", "guideline", "data", "draft"),  # excluded — not published
    ]):
        doc = Document(
            bu_folder=unit.upper(),
            unit_id=unit,
            subdivision=sub,
            title=f"Doc {i}",
            document_class=doc_class,
            program_type=None,
            file_type="csv",
            original_path=f"{unit}/{sub}/doc{i}.csv",
            markdown_path=f"markdown/doc{i}.md",
            sidecar_path=None,
            status=status,
            access_roles=json.dumps(
                ["admin", "super", "sme"] if doc_class == "ratecard" else
                ["admin", "super", "sme", "senior_mgmt", "estimator"]
            ),
            version="1.0",
            content_hash=f"hash{i}",
        )
        session.add(doc)
        session.flush()
        session.add(
            Chunk(
                document_id=doc.id,
                chunk_index=0,
                section_path=doc.title,
                text=f"Content of {doc.title} about Oracle Fusion effort drivers.",
                token_count=10,
                content_hash=f"chunkhash{i}",
            )
        )
    session.flush()


def test_candidate_selector_excludes_drafts_and_wrong_unit(isolated_env):
    with session_scope() as session:
        _seed_documents(session)

        esu_data = select_candidate_chunks(session, caller_role="admin", unit_id="esu", subdivision="data")
        # 2 published esu/data docs (guideline + ratecard) — draft excluded.
        assert len(esu_data) == 2

        adm_data = select_candidate_chunks(session, caller_role="admin", unit_id="adm", subdivision="data")
        assert len(adm_data) == 1


def test_candidate_selector_role_gates_ratecards(isolated_env):
    with session_scope() as session:
        _seed_documents(session)

        as_estimator = select_candidate_chunks(session, caller_role="estimator", unit_id="esu", subdivision="data")
        as_admin = select_candidate_chunks(session, caller_role="admin", unit_id="esu", subdivision="data")

        assert len(as_estimator) == 1  # ratecard excluded
        assert len(as_admin) == 2  # ratecard included


def test_embed_on_demand_only_embeds_touched_chunks(isolated_env):
    faiss_manager = FaissIndexManager(settings.faiss_dir)
    embeddings = DeterministicFakeEmbeddings()
    provider_key = "local::fake-test-model"

    with session_scope() as session:
        _seed_documents(session)

        assert session.query(ChunkEmbedding).count() == 0

        candidates = select_candidate_chunks(session, caller_role="admin", unit_id="esu", subdivision="data")
        assert len(candidates) == 2

        mapping = ensure_embedded(session, candidates, embeddings, provider_key, faiss_manager)
        assert len(mapping) == 2

        # Only the 2 touched chunks got embedded — not the whole corpus (5 docs total).
        assert session.query(ChunkEmbedding).count() == 2

        # Re-running with unchanged content embeds nothing new.
        mapping_again = ensure_embedded(session, candidates, embeddings, provider_key, faiss_manager)
        assert mapping_again == mapping
        assert session.query(ChunkEmbedding).count() == 2


def test_retrieve_ranks_by_similarity(isolated_env):
    faiss_manager = FaissIndexManager(settings.faiss_dir)
    embeddings = DeterministicFakeEmbeddings()
    provider_key = "local::fake-test-model"

    with session_scope() as session:
        _seed_documents(session)
        candidates = select_candidate_chunks(session, caller_role="admin", unit_id="esu", subdivision="data")
        mapping = ensure_embedded(session, candidates, embeddings, provider_key, faiss_manager)

        results = retrieve(
            candidates, mapping, embeddings, provider_key, faiss_manager,
            queries=["Oracle Fusion effort drivers"], k=5,
        )
        assert len(results) == len(candidates)
        # Scores should be sorted descending.
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)


def test_get_vectors_works_after_a_fresh_process_restart(isolated_env):
    """Regression test: chunks embedded and persisted by one
    FaissIndexManager instance must be retrievable by a BRAND NEW instance
    that never called add() itself (i.e. a real process restart) — this
    used to crash with "No FAISS index loaded yet", because get_vectors()
    only ever looked at the in-memory _indexes/_dims caches instead of also
    lazily loading the on-disk index the way add() does.
    """
    embeddings = DeterministicFakeEmbeddings()
    provider_key = "local::fake-test-model"

    with session_scope() as session:
        _seed_documents(session)
        candidates = select_candidate_chunks(session, caller_role="admin", unit_id="esu", subdivision="data")

        # First "process": embeds and persists to disk.
        first_manager = FaissIndexManager(settings.faiss_dir)
        mapping = ensure_embedded(session, candidates, embeddings, provider_key, first_manager)
        assert len(mapping) == len(candidates)

        # Second "process": a fresh manager instance, same on-disk dir,
        # never had add() called on it — simulates a service restart where
        # every candidate chunk is already embedded (ensure_embedded is a
        # pure cache hit, so it never touches the new manager's add()).
        second_manager = FaissIndexManager(settings.faiss_dir)
        results = retrieve(
            candidates, mapping, embeddings, provider_key, second_manager,
            queries=["Oracle Fusion effort drivers"], k=5,
        )
        assert len(results) == len(candidates)
