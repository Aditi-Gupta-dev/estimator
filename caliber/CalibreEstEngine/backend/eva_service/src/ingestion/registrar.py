"""Upserts a converted document + its chunks into SQLite. Idempotent via
content_hash — re-ingesting an unchanged document is a no-op beyond the
freshness check.

Governance authority: once a document has been explicitly governed through
the admin API (Document.governance_set_at is set), re-ingestion NEVER again
overwrites status/sensitivity/access_roles/document_class from the sidecar or
filename heuristics — only content (title, chunks, tags, version) still
flows from disk. Before that point, the sidecar/heuristics remain the
bootstrap source, exactly as they always were, so first-time ingestion is
unaffected. This closes the gap where re-ingesting a file could silently
revert an admin's publish/reclassify decision.
"""
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import Chunk, Document
from .access_roles import derive_access_roles
from .chunker import ChunkDraft
from .sensitivity import sensitivity_for_document_class


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def register_document(
    session: Session,
    *,
    bu_folder: str,
    unit_id: str,
    subdivision: str,
    title: str,
    document_class: str,
    program_type: str | None,
    file_type: str,
    original_path: str,
    markdown_path: str,
    sidecar_path: str | None,
    status: str,
    version: str | None,
    tags: list[str],
    markdown_text: str,
    chunk_drafts: list[ChunkDraft],
) -> tuple[str, bool]:
    """Returns (document_id, changed). `changed=False` means the document
    already existed with identical content and nothing was touched.
    """
    content_hash = sha256(markdown_text)
    bootstrap_sensitivity = sensitivity_for_document_class(document_class)
    bootstrap_access_roles = derive_access_roles(document_class, subdivision)

    existing = session.execute(
        select(Document).where(Document.original_path == original_path)
    ).scalar_one_or_none()

    # Once governed, an admin's status/sensitivity/access_roles/class
    # decision is authoritative — the sidecar and filename heuristics may
    # keep changing on disk (someone edits the sidecar, or a bulk backfill
    # runs) without ever being able to silently widen or narrow who can see
    # this document again.
    governed = bool(existing and existing.governance_set_at)

    if existing and existing.content_hash == content_hash:
        # Content is unchanged, but ungoverned SECURITY metadata may not be:
        # correcting a document's class (e.g. mislabelled -> ratecard)
        # changes who may see it, and draft -> published is what actually
        # makes a document retrievable. Re-ingesting identical bytes is the
        # normal way both a reclassification and a sidecar-driven publish
        # are applied, so this path must still catch them — but only while
        # the document remains ungoverned. Chunks/embeddings are deliberately
        # left intact either way — only the access/lifecycle decision changes.
        if governed:
            return existing.id, False
        new_access = json.dumps(bootstrap_access_roles)
        if (
            existing.access_roles != new_access
            or existing.document_class != document_class
            or existing.status != status
            or existing.sensitivity != bootstrap_sensitivity
        ):
            existing.document_class = document_class
            existing.access_roles = new_access
            existing.status = status
            existing.sensitivity = bootstrap_sensitivity
            session.flush()
            return existing.id, True
        return existing.id, False

    if existing:
        existing.title = title
        existing.program_type = program_type
        existing.markdown_path = markdown_path
        existing.sidecar_path = sidecar_path
        existing.version = version
        existing.tags = json.dumps(tags)
        existing.content_hash = content_hash
        existing.last_indexed_at = datetime.now(timezone.utc)
        if not governed:
            existing.document_class = document_class
            existing.status = status
            existing.sensitivity = bootstrap_sensitivity
            existing.access_roles = json.dumps(bootstrap_access_roles)
        doc = existing
        # Content changed — drop stale chunks (and their embeddings via
        # cascade) so lazy-embed sees a clean slate for this document.
        for chunk in list(doc.chunks):
            session.delete(chunk)
        session.flush()
    else:
        doc = Document(
            bu_folder=bu_folder,
            unit_id=unit_id,
            subdivision=subdivision,
            title=title,
            document_class=document_class,
            program_type=program_type,
            file_type=file_type,
            original_path=original_path,
            markdown_path=markdown_path,
            sidecar_path=sidecar_path,
            status=status,
            sensitivity=bootstrap_sensitivity,
            access_roles=json.dumps(bootstrap_access_roles),
            version=version,
            tags=json.dumps(tags),
            content_hash=content_hash,
            last_indexed_at=datetime.now(timezone.utc),
        )
        session.add(doc)
        session.flush()

    for i, draft in enumerate(chunk_drafts):
        session.add(
            Chunk(
                document_id=doc.id,
                chunk_index=i,
                section_path=draft.section_path,
                text=draft.text,
                token_count=draft.token_count,
                content_hash=sha256(draft.text),
            )
        )

    return doc.id, True
