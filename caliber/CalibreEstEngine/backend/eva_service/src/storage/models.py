"""SQLAlchemy models — documents registry, provider-namespaced embedding
tracking, semantic cache log, and chat audit trail.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Document(Base):
    """The metadata pre-filter target. Extends the existing KnowledgeHub
    sidecar JSON shape rather than inventing a parallel one.
    """
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    bu_folder: Mapped[str] = mapped_column(String, index=True)
    unit_id: Mapped[str] = mapped_column(String, index=True)
    subdivision: Mapped[str] = mapped_column(String, index=True)  # templates | data
    title: Mapped[str] = mapped_column(String)
    document_class: Mapped[str] = mapped_column(String, index=True)
    program_type: Mapped[str | None] = mapped_column(String, nullable=True)
    file_type: Mapped[str] = mapped_column(String)
    original_path: Mapped[str] = mapped_column(String, unique=True)
    markdown_path: Mapped[str] = mapped_column(String)
    sidecar_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # Lifecycle — see storage/document_status.py for the state machine.
    # "draft" remains the physical default so a row inserted before this
    # column existed (or by any code that doesn't set it) behaves exactly as
    # it always did: unpublished until someone acts on it.
    status: Mapped[str] = mapped_column(String, default="draft", index=True)  # draft|in_review|published|archived|rejected
    access_roles: Mapped[str] = mapped_column(Text)  # JSON array — derived from `sensitivity`, see ingestion/sensitivity.py
    version: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    content_hash: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="kh")  # kh | cache-derived
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    # ── Governance (added after the initial release — see storage/db.py's
    # _COLUMN_MIGRATIONS for the backfill that populated `sensitivity` on the
    # 23 pre-existing documents without changing any of their access
    # decisions) ─────────────────────────────────────────────────────────────
    sensitivity: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # NULL = governance fields may still be bootstrapped from the upload
    # sidecar on ingest (first-ingest convenience). Once an admin acts through
    # the governance API, this is stamped and the sidecar can never again
    # silently override status/sensitivity/access_roles — see
    # ingestion/registrar.py.
    governance_set_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    """Embedding-provider-agnostic chunk text."""
    __tablename__ = "chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    section_path: Mapped[str | None] = mapped_column(String, nullable=True)
    text: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    document: Mapped[Document] = relationship(back_populates="chunks")
    embeddings: Mapped[list["ChunkEmbedding"]] = relationship(back_populates="chunk", cascade="all, delete-orphan")


class ChunkEmbedding(Base):
    """Namespacing table: a chunk can have zero, one, or two rows here
    (one per embedding provider space), so switching networks never forces
    a full re-embed of the other space. content_hash here is compared
    against the *current* Chunk.content_hash to decide reuse vs re-embed.
    """
    __tablename__ = "chunk_embeddings"
    __table_args__ = (UniqueConstraint("chunk_id", "embedding_provider", "embedding_model"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    chunk_id: Mapped[str] = mapped_column(String, ForeignKey("chunks.id"), index=True)
    embedding_provider: Mapped[str] = mapped_column(String)  # openai | local
    embedding_model: Mapped[str] = mapped_column(String)
    content_hash: Mapped[str] = mapped_column(String)
    faiss_id: Mapped[int] = mapped_column(Integer)
    embedded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    chunk: Mapped[Chunk] = relationship(back_populates="embeddings")


class CacheLog(Base):
    """Semantic cache + promotion source."""
    __tablename__ = "cache_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    query_text: Mapped[str] = mapped_column(Text)
    query_normalized: Mapped[str] = mapped_column(Text, index=True)
    query_embedding: Mapped[bytes] = mapped_column(LargeBinary)
    embedding_provider: Mapped[str] = mapped_column(String, index=True)
    embedding_model: Mapped[str] = mapped_column(String)
    answer_text: Mapped[str] = mapped_column(Text)
    citations: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    caller_role: Mapped[str] = mapped_column(String, index=True)
    unit_id: Mapped[str | None] = mapped_column(String, nullable=True)
    subdivision: Mapped[str | None] = mapped_column(String, nullable=True)
    document_class: Mapped[str | None] = mapped_column(String, nullable=True)
    filters_hash: Mapped[str] = mapped_column(String, index=True)
    intent: Mapped[str | None] = mapped_column(String, nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    feedback: Mapped[str | None] = mapped_column(String, nullable=True)  # good | bad | None
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    promoted_document_id: Mapped[str | None] = mapped_column(String, ForeignKey("documents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_hit_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    caller_role: Mapped[str] = mapped_column(String)
    unit_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Persistent per-browser identity (localStorage-generated UUID) — the
    # long-term-memory scope. Nullable: sessions created before this field
    # existed, or requests that never sent one, simply never contribute to
    # or benefit from long-term memory.
    client_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Watermark for the background extraction job (memory/extraction.py) —
    # None means this session has never been scanned for durable facts.
    last_memory_extraction_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String)  # user | eva
    text: Mapped[str] = mapped_column(Text)
    plan_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    injection_suspected: Mapped[bool] = mapped_column(Boolean, default=False)
    intent: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class UserMemory(Base):
    """Long-term memory — durable facts about a given browser (client_id),
    extracted in the background from past conversations (memory/extraction.py),
    never on the hot request path. Scoped per-browser, not per-role — see
    EVA_RAG_IMPLEMENTATION_PLAN.md's memory plan for why (no login/account
    system exists in this app, only role personas).
    """
    __tablename__ = "user_memory"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    client_id: Mapped[str] = mapped_column(String, index=True)
    fact_text: Mapped[str] = mapped_column(Text)
    source_session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    use_count: Mapped[int] = mapped_column(Integer, default=0)


class GovernanceEvent(Base):
    """The only record of a governance mutation — who changed what on which
    document, and what it was before. Nothing like this existed anywhere in
    the app prior to Knowledge Hub governance: admin user-management mutations
    are logged only to stdout (upload-server), and no table anywhere records
    an administrative action with an actor. Actor identity comes from the
    gateway-verified session, passed through the internal proxy call, never
    from the request body — eva_service has no login system of its own to
    verify it against.
    """
    __tablename__ = "governance_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id"), index=True)
    action: Mapped[str] = mapped_column(String, index=True)  # publish|unpublish|archive|revoke|reclassify|reject
    actor_user_id: Mapped[str] = mapped_column(String)
    actor_name: Mapped[str] = mapped_column(String)
    actor_role: Mapped[str] = mapped_column(String)
    field: Mapped[str | None] = mapped_column(String, nullable=True)  # status | sensitivity | access_roles | owner
    previous_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
