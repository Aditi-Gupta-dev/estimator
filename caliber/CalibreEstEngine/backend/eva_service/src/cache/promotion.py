"""Cache-promotion — the "RAG learns from cache" mechanism. Proven cache
Q&A pairs (asked often enough, or explicitly marked good) get promoted into
the main FAISS documents index as synthetic FAQ chunks, so future
differently-worded but related queries can retrieve them too — not just
exact-cache-hit matches.

Runs as a periodic background job (main.py's APScheduler), never on the hot
request path — see semantic_cache.py's write() for why the cost of a
promotion embed call must not land on a live chat request.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..providers.embedding_factory import sanitize_provider_key
from ..storage.faiss_manager import FaissIndexManager
from ..storage.models import CacheLog, Chunk, ChunkEmbedding, Document

log = logging.getLogger("eva_service.promotion")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _access_roles_for_entry(session: Session, entry: CacheLog) -> list[str] | None:
    """Intersection of the access_roles of every document the cached
    answer actually cited — a promoted FAQ is never more permissive than
    its most restrictive source. Returns None (not eligible) when there
    are no citations to ground it in, per R1 (grounding): an ungrounded
    cache entry (e.g. a restricted-reply or an abstention) has nothing
    legitimate to promote.
    """
    citations = json.loads(entry.citations or "[]")
    if not citations:
        return None

    role_sets = []
    for c in citations:
        doc = session.get(Document, c.get("document_id"))
        if doc:
            role_sets.append(set(json.loads(doc.access_roles)))

    if not role_sets:
        return None

    roles = set.intersection(*role_sets)
    return sorted(roles) if roles else None


def promote_cache_entries(
    session: Session,
    embeddings,
    provider_key: str,
    faiss_manager: FaissIndexManager,
    hit_count_threshold: int,
) -> int:
    candidates = session.execute(
        select(CacheLog).where(
            or_(CacheLog.hit_count >= hit_count_threshold, CacheLog.feedback == "good"),
            CacheLog.promoted_at.is_(None),
        )
    ).scalars().all()

    provider, model = provider_key.split("::", 1)
    sanitized = sanitize_provider_key(provider_key)
    promoted = 0

    for entry in candidates:
        access_roles = _access_roles_for_entry(session, entry)
        if access_roles is None:
            continue  # not grounded in anything citable — skip, retried next tick

        chunk_text = f"Q: {entry.query_text}\nA: {entry.answer_text}"

        doc = Document(
            bu_folder=(entry.unit_id or "_global").upper(),
            unit_id=entry.unit_id or "_global",
            subdivision=entry.subdivision or "data",
            title=f"FAQ: {entry.query_text[:80]}",
            document_class="faq",
            program_type=None,
            file_type="faq",
            original_path=f"cache-derived/{entry.id}",
            markdown_path=f"cache-derived/{entry.id}.md",
            sidecar_path=None,
            status="published",
            access_roles=json.dumps(access_roles),
            version="1.0",
            tags=json.dumps(["faq", "cache-derived"]),
            content_hash=_sha256(chunk_text),
            source="cache-derived",
        )
        session.add(doc)
        session.flush()

        chunk = Chunk(
            document_id=doc.id, chunk_index=0, section_path="FAQ (cache-derived)",
            text=chunk_text, token_count=len(chunk_text.split()), content_hash=_sha256(chunk_text),
        )
        session.add(chunk)
        session.flush()

        # The one deliberate exception to "never embed upfront": promotion
        # adds a small number of synthetic docs infrequently, in the
        # background — not corpus-wide preloading on the hot path.
        vector = np.array(embeddings.embed_documents([chunk_text]), dtype=np.float32)
        faiss_id = faiss_manager.next_id(sanitized)
        faiss_manager.add(sanitized, [faiss_id], vector)

        session.add(
            ChunkEmbedding(
                chunk_id=chunk.id, embedding_provider=provider, embedding_model=model,
                content_hash=chunk.content_hash, faiss_id=faiss_id,
            )
        )

        entry.promoted_at = datetime.now(timezone.utc)
        entry.promoted_document_id = doc.id
        promoted += 1

    if promoted:
        log.info("Promoted %d cache entries into the knowledge base", promoted)
    return promoted
