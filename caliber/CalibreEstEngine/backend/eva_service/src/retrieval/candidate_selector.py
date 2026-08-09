"""SQLite metadata pre-filter — pure SQL, zero vector math. Narrows the
whole corpus down to a small candidate set before anything is embedded.
Also the first line of R5 role-gating: chunks whose document access_roles
exclude the caller never enter the candidate pool.
"""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import Chunk, Document


def _base_candidates(
    session: Session,
    *,
    unit_id: str | None,
    subdivision: str | None,
    document_class: str | None,
    program_type: str | None,
) -> list[Chunk]:
    stmt = select(Chunk).join(Document).where(Document.status == "published")

    if unit_id:
        # A unit-scoped query still surfaces _global (COE-owned) content.
        stmt = stmt.where(Document.unit_id.in_([unit_id, "_global"]))
    if subdivision:
        stmt = stmt.where(Document.subdivision == subdivision)
    if document_class:
        stmt = stmt.where(Document.document_class == document_class)
    if program_type:
        stmt = stmt.where(Document.program_type == program_type)

    return session.execute(stmt).scalars().all()


def select_candidate_chunks(
    session: Session,
    *,
    caller_role: str,
    unit_id: str | None = None,
    subdivision: str | None = None,
    document_class: str | None = None,
    program_type: str | None = None,
) -> list[Chunk]:
    candidates = _base_candidates(
        session, unit_id=unit_id, subdivision=subdivision,
        document_class=document_class, program_type=program_type,
    )
    # First-line role gate (R5) — drop anything whose access_roles excludes
    # the caller before it's ever embedded or sent to an LLM.
    return [c for c in candidates if caller_role in json.loads(c.document.access_roles)]


def has_role_restricted_matches(
    session: Session,
    *,
    caller_role: str,
    unit_id: str | None = None,
    subdivision: str | None = None,
    document_class: str | None = None,
    program_type: str | None = None,
) -> bool:
    """True when the metadata filters *would* match published content, but
    every match is excluded by access_roles for this caller — i.e. content
    exists and is being withheld, not simply absent. Used to distinguish
    "restricted" from "not found" in the chat route.
    """
    candidates = _base_candidates(
        session, unit_id=unit_id, subdivision=subdivision,
        document_class=document_class, program_type=program_type,
    )
    if not candidates:
        return False
    return all(caller_role not in json.loads(c.document.access_roles) for c in candidates)
