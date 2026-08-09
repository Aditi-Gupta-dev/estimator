"""Semantic cache — short-circuits repeat questions before any LLM call
(not even the planner). Scoped by caller_role + unit_id + embedding_provider
so a cached answer computed under one role/context is never served to a
differently-privileged caller asking a similar question, and so a cache
built under one embedding space is never compared against another.

Cache key note: the implementation plan's flow describes scoping by the
*plan's* filters (unit_id/subdivision/document_class), but the plan itself
only exists after a planner LLM call — using it as the lookup key would
mean the cache could never actually skip that call. This scopes the lookup
by what's available pre-plan (caller_role, the request's own unit_id,
embedding_provider) instead; subdivision/document_class are still recorded
on the row (from the plan, after a miss) for the promotion job's own use.
"""
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import CacheLog


def compute_filters_hash(unit_id: str | None) -> str:
    return hashlib.sha256(json.dumps({"unit_id": unit_id}, sort_keys=True).encode()).hexdigest()


def normalize_query(text: str) -> str:
    return " ".join(text.strip().lower().split())


def _to_bytes(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def _from_bytes(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=np.float32)


def _normalize_vec(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm else vec


@dataclass
class CacheLookupResult:
    hit: CacheLog | None
    query_embedding_bytes: bytes
    best_score: float | None


class SemanticCache:
    def __init__(self, threshold: float):
        self.threshold = threshold

    def lookup(
        self,
        session: Session,
        *,
        query_text: str,
        caller_role: str,
        unit_id: str | None,
        embedding_provider: str,
        embeddings,
    ) -> CacheLookupResult:
        query_vec = _normalize_vec(np.array(embeddings.embed_query(query_text), dtype=np.float32))
        query_bytes = _to_bytes(query_vec)

        filters_hash = compute_filters_hash(unit_id)
        candidates = session.execute(
            select(CacheLog).where(
                CacheLog.caller_role == caller_role,
                CacheLog.filters_hash == filters_hash,
                CacheLog.embedding_provider == embedding_provider,
            )
        ).scalars().all()

        if not candidates:
            return CacheLookupResult(None, query_bytes, None)

        best, best_score = None, -1.0
        for c in candidates:
            stored = _normalize_vec(_from_bytes(c.query_embedding))
            score = float(query_vec @ stored)
            if score > best_score:
                best, best_score = c, score

        if best_score >= self.threshold:
            return CacheLookupResult(best, query_bytes, best_score)
        return CacheLookupResult(None, query_bytes, best_score)

    def record_hit(self, session: Session, entry: CacheLog) -> None:
        entry.hit_count += 1
        entry.last_hit_at = datetime.now(timezone.utc)

    def write(
        self,
        session: Session,
        *,
        query_text: str,
        query_embedding_bytes: bytes,
        embedding_provider: str,
        embedding_model: str,
        answer_text: str,
        citations: list[dict],
        caller_role: str,
        unit_id: str | None,
        subdivision: str | None,
        document_class: str | None,
        intent: str | None,
    ) -> CacheLog:
        entry = CacheLog(
            query_text=query_text,
            query_normalized=normalize_query(query_text),
            query_embedding=query_embedding_bytes,
            embedding_provider=embedding_provider,
            embedding_model=embedding_model,
            answer_text=answer_text,
            citations=json.dumps(citations),
            caller_role=caller_role,
            unit_id=unit_id,
            subdivision=subdivision,
            document_class=document_class,
            filters_hash=compute_filters_hash(unit_id),
            intent=intent,
        )
        session.add(entry)
        session.flush()
        return entry
