import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.config import settings  # noqa: E402
from src.ingestion.pipeline import ingest_document  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.models import Chunk, ChunkEmbedding, Document  # noqa: E402


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    kh_root = tmp_path / "KnowledgeHub"
    (kh_root / "ESU" / "data").mkdir(parents=True)

    monkeypatch.setattr(settings, "knowledge_hub_root", str(kh_root))
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(settings, "eva_markdown_dir", str(tmp_path / "markdown_cache"))
    monkeypatch.setattr(settings, "eva_faiss_dir", str(tmp_path / "faiss_indexes"))

    # Reset the cached engine/sessionmaker singletons so they pick up the
    # patched (isolated, per-test) db path.
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)

    init_db()
    return kh_root


def _write_csv(kh_root: Path, rel: str, rows: list[list[str]]) -> Path:
    path = kh_root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(",".join(r) for r in rows), encoding="utf-8")
    return path


def test_ingest_document_with_sidecar_and_idempotency(isolated_env):
    kh_root = isolated_env
    csv_path = _write_csv(
        kh_root,
        "ESU/data/ESU_data_RateCard_v1_2026-07.csv",
        [["Role", "Rate"], ["Developer", "100"], ["Architect", "150"]],
    )
    sidecar_path = csv_path.with_name(csv_path.name + ".json")
    sidecar_path.write_text(
        json.dumps(
            {
                "title": "ESU Rate Card",
                "type": "ratecard",
                "unitId": "esu",
                "version": "1.0",
                "status": "published",
                "tags": ["rates"],
            }
        ),
        encoding="utf-8",
    )

    with session_scope() as session:
        doc_id_1, changed_1 = ingest_document(csv_path, sidecar_path, session)
    assert doc_id_1 is not None
    assert changed_1 is True

    with session_scope() as session:
        doc = session.get(Document, doc_id_1)
        assert doc.unit_id == "esu"
        assert doc.subdivision == "data"
        assert doc.document_class == "ratecard"
        assert doc.status == "published"
        # Rate cards are restricted from estimator per R5.
        access_roles = json.loads(doc.access_roles)
        assert "estimator" not in access_roles
        assert "admin" in access_roles

        chunks = session.query(Chunk).filter_by(document_id=doc_id_1).all()
        assert len(chunks) > 0

        # Ingestion must never embed upfront.
        embeddings = session.query(ChunkEmbedding).all()
        assert len(embeddings) == 0

    # Re-running on unchanged content is a no-op.
    with session_scope() as session:
        doc_id_2, changed_2 = ingest_document(csv_path, sidecar_path, session)
    assert doc_id_2 == doc_id_1
    assert changed_2 is False


def test_ingest_document_without_sidecar_uses_fallback_heuristics(isolated_env):
    kh_root = isolated_env
    csv_path = _write_csv(
        kh_root,
        "ESU/data/ESU_data_CloudMigration_CaseStudy_v1_2026-07.csv",
        [["Phase", "Effort"], ["Discover", "20"]],
    )

    with session_scope() as session:
        doc_id, changed = ingest_document(csv_path, None, session)
    assert doc_id is not None
    assert changed is True

    with session_scope() as session:
        doc = session.get(Document, doc_id)
        assert doc.unit_id == "esu"
        assert doc.document_class == "casestudy"
        # No sidecar => not provably published.
        assert doc.status == "draft"
