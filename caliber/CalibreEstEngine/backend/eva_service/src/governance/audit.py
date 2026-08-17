"""Deterministic Knowledge Hub governance inspection — no LLM involved
anywhere in this file. One implementation, three consumers: the admin API
(routes/documents_route.py), the CLI report (scripts/governance_report.py),
and EVA's read-only audit_knowledge_hub selector (agents/governance_tool.py).

This is the engine that turned "3.2% of the corpus is retrievable" from a
hand audit into a reproducible, testable number.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.document_status import ALL_STATUSES, DocumentStatus, is_retrievable
from ..storage.models import Chunk, ChunkEmbedding, Document
from .paths import relative_to_kh_root, walk_knowledge_hub

# ── Recommended actions (spec §17) — deterministic, never LLM-guessed ──────
READY_FOR_REVIEW = "Ready for review"
METADATA_REQUIRED = "Metadata required"
RATE_CARD_APPROVAL_REQUIRED = "Restricted — explicit admin approval required"
REINGEST_REQUIRED = "Re-ingest required"
NO_ACTION_NEEDED = "No action needed"


@dataclass
class DocumentAudit:
    id: str
    title: str
    document_class: str
    sensitivity: str | None
    status: str
    access_roles: list[str]
    bu_folder: str
    unit_id: str
    owner_name: str | None
    has_sidecar_metadata: bool
    chunk_count: int
    embedded_chunk_count: int
    on_disk: bool
    is_retrievable: bool
    recommended_action: str
    issues: list[str] = field(default_factory=list)


def _recommend_action(doc: Document, on_disk: bool, chunk_count: int) -> tuple[str, list[str]]:
    issues = []

    if not on_disk:
        issues.append("source file missing from disk")
        return REINGEST_REQUIRED, issues

    if chunk_count == 0:
        issues.append("zero chunks — ingestion produced no content")
        return REINGEST_REQUIRED, issues

    if doc.sidecar_path is None:
        issues.append("no sidecar metadata — classified by filename heuristics only")

    if doc.status == DocumentStatus.PUBLISHED:
        return NO_ACTION_NEEDED, issues

    if doc.status in (DocumentStatus.ARCHIVED, DocumentStatus.REJECTED):
        return NO_ACTION_NEEDED, issues

    # Unpublished from here down (draft / in_review).
    if doc.sensitivity == "RATE_CARD":
        issues.append("rate-card content — requires explicit admin approval, never auto-published")
        return RATE_CARD_APPROVAL_REQUIRED, issues

    if doc.sidecar_path is None:
        return METADATA_REQUIRED, issues

    return READY_FOR_REVIEW, issues


def audit_documents(session: Session, kh_root: Path | None = None) -> list[DocumentAudit]:
    """Per-document governance report. Deterministic DB + (optionally) disk
    inspection — no guessing. Pass kh_root to also detect files that vanished
    from disk; omit it to skip that one disk check (DB-only, still correct
    for everything else).
    """
    documents = session.execute(select(Document)).scalars().all()

    chunk_counts: dict[str, int] = {}
    embedded_counts: dict[str, int] = {}
    for doc in documents:
        chunks = session.execute(select(Chunk).where(Chunk.document_id == doc.id)).scalars().all()
        chunk_counts[doc.id] = len(chunks)
        chunk_ids = [c.id for c in chunks]
        if chunk_ids:
            embedded = session.execute(
                select(ChunkEmbedding.chunk_id).where(ChunkEmbedding.chunk_id.in_(chunk_ids)).distinct()
            ).scalars().all()
            embedded_counts[doc.id] = len(set(embedded))
        else:
            embedded_counts[doc.id] = 0

    disk_paths = None
    if kh_root is not None and kh_root.exists():
        disk_paths = {relative_to_kh_root(p, kh_root) for p, _ in walk_knowledge_hub(kh_root)}

    results = []
    for doc in documents:
        on_disk = True if disk_paths is None else doc.original_path in disk_paths
        chunk_count = chunk_counts[doc.id]
        action, issues = _recommend_action(doc, on_disk, chunk_count)
        results.append(DocumentAudit(
            id=doc.id,
            title=doc.title,
            document_class=doc.document_class,
            sensitivity=doc.sensitivity,
            status=doc.status,
            access_roles=json.loads(doc.access_roles),
            bu_folder=doc.bu_folder,
            unit_id=doc.unit_id,
            owner_name=doc.owner_name,
            has_sidecar_metadata=doc.sidecar_path is not None,
            chunk_count=chunk_count,
            embedded_chunk_count=embedded_counts[doc.id],
            on_disk=on_disk,
            is_retrievable=is_retrievable(doc.status) and doc.revoked_at is None,
            recommended_action=action,
            issues=issues,
        ))
    return results


def corpus_metrics(session: Session) -> dict:
    """The exact figures a hand audit would produce, made reproducible.
    total/retrievable chunk counts intentionally match how
    retrieval/candidate_selector.py itself decides retrievability
    (status == published AND revoked_at IS NULL) — this function is not a
    second definition of that rule, it counts against the same one.
    """
    documents = session.execute(select(Document)).scalars().all()

    by_status = {s: 0 for s in ALL_STATUSES}
    for doc in documents:
        by_status[doc.status] = by_status.get(doc.status, 0) + 1

    total_chunks = session.execute(select(Chunk.id)).scalars().all()
    retrievable_chunks = session.execute(
        select(Chunk.id).join(Document).where(
            Document.status == DocumentStatus.PUBLISHED, Document.revoked_at.is_(None),
        )
    ).scalars().all()

    total_documents = len(documents)
    retrievable_documents = sum(
        1 for d in documents if is_retrievable(d.status) and d.revoked_at is None
    )
    indexed_documents = sum(1 for d in documents if chunk_count_nonzero(session, d.id))

    total_chunk_count = len(total_chunks)
    retrievable_chunk_count = len(retrievable_chunks)

    return {
        "documents": {
            "total": total_documents,
            "by_status": by_status,
            "published": by_status.get(DocumentStatus.PUBLISHED, 0),
            "draft": by_status.get(DocumentStatus.DRAFT, 0),
            "in_review": by_status.get(DocumentStatus.IN_REVIEW, 0),
            "archived": by_status.get(DocumentStatus.ARCHIVED, 0),
            "rejected": by_status.get(DocumentStatus.REJECTED, 0),
            "indexed": indexed_documents,
            "retrievable": retrievable_documents,
        },
        "chunks": {
            "total": total_chunk_count,
            "retrievable": retrievable_chunk_count,
        },
        "retrievability_pct": (
            round(retrievable_chunk_count / total_chunk_count * 100, 1) if total_chunk_count else 0.0
        ),
    }


def chunk_count_nonzero(session: Session, document_id: str) -> bool:
    return session.execute(
        select(Chunk.id).where(Chunk.document_id == document_id).limit(1)
    ).first() is not None


def find_orphans_on_disk(session: Session, kh_root: Path) -> list[str]:
    """Files on disk with NO corresponding Document row — the class of bug
    that made the silent /internal/ingest failure invisible: a file can have
    perfect metadata and simply never have been registered."""
    if not kh_root.exists():
        return []
    disk_relpaths = {relative_to_kh_root(p, kh_root) for p, _ in walk_knowledge_hub(kh_root)}
    db_relpaths = set(session.execute(select(Document.original_path)).scalars().all())
    return sorted(disk_relpaths - db_relpaths)


def find_duplicate_documents(session: Session) -> list[list[str]]:
    """Groups of document ids sharing identical content (same content_hash
    at different paths) — the same source ingested more than once."""
    documents = session.execute(select(Document)).scalars().all()
    by_hash: dict[str, list[str]] = {}
    for doc in documents:
        by_hash.setdefault(doc.content_hash, []).append(doc.id)
    return [ids for ids in by_hash.values() if len(ids) > 1]
