"""Upserts a converted document + its chunks into SQLite. Idempotent via
content_hash — re-ingesting an unchanged document is a no-op beyond the
freshness check.
"""
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import Chunk, Document
from .access_roles import derive_access_roles
from .chunker import ChunkDraft


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
    access_roles = derive_access_roles(document_class, subdivision)

    existing = session.execute(
        select(Document).where(Document.original_path == original_path)
    ).scalar_one_or_none()

    if existing and existing.content_hash == content_hash:
        # Content is unchanged, but SECURITY metadata may not be: correcting a
        # document's class (e.g. mislabelled -> ratecard) changes who may see
        # it. Skipping that update would leave the old, more permissive
        # access_roles in place forever, since re-ingesting identical bytes is
        # the normal way a reclassification is applied. Chunks/embeddings are
        # deliberately left intact — only the access decision changes.
        new_access = json.dumps(access_roles)
        if existing.access_roles != new_access or existing.document_class != document_class:
            existing.document_class = document_class
            existing.access_roles = new_access
            existing.status = status
            session.flush()
            return existing.id, True
        return existing.id, False

    if existing:
        existing.title = title
        existing.document_class = document_class
        existing.program_type = program_type
        existing.markdown_path = markdown_path
        existing.sidecar_path = sidecar_path
        existing.status = status
        existing.access_roles = json.dumps(access_roles)
        existing.version = version
        existing.tags = json.dumps(tags)
        existing.content_hash = content_hash
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
            access_roles=json.dumps(access_roles),
            version=version,
            tags=json.dumps(tags),
            content_hash=content_hash,
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
