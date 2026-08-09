"""Long-term memory store — durable facts scoped by client_id (a
per-browser identity persisted in localStorage, not the role persona; see
EVA_RAG_IMPLEMENTATION_PLAN.md's memory plan for why). No vector search:
a single browser accumulates tens of facts, not thousands, so the full
(bounded) list is retrieved directly and injected into the prompt as a
plain <user_memory> block — the same scale trade-off KnowledgeHub documents
made the opposite call on for a very different reason (thousands of
documents, org-wide).
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import UserMemory

DEFAULT_MEMORY_LIMIT = 30


def get_long_term_memory(session: Session, client_id: str | None, limit: int = DEFAULT_MEMORY_LIMIT) -> list[UserMemory]:
    if not client_id:
        return []
    rows = session.execute(
        select(UserMemory)
        .where(UserMemory.client_id == client_id)
        .order_by(UserMemory.last_used_at.desc())
        .limit(limit)
    ).scalars().all()
    for row in rows:
        row.use_count += 1
        row.last_used_at = datetime.now(timezone.utc)
    return rows


def write_memories(session: Session, client_id: str, fact_texts: list[str], source_session_id: str | None = None) -> list[UserMemory]:
    written = []
    for text in fact_texts:
        text = text.strip()
        if not text:
            continue
        row = UserMemory(client_id=client_id, fact_text=text, source_session_id=source_session_id)
        session.add(row)
        written.append(row)
    if written:
        session.flush()
    return written
