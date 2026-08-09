"""ensure_embedded() — the lazy-embedding mechanism. Given a candidate
chunk set (already narrowed by the SQL metadata pre-filter), embed only the
chunks that don't already have a valid embedding in the active provider's
space, then persist to both SQLite (chunk_embeddings) and the durable FAISS
store. Chunks whose content hasn't changed since they were last embedded
under this provider are reused — no API call, no re-embedding.
"""
import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..providers.embedding_factory import sanitize_provider_key
from ..storage.faiss_manager import FaissIndexManager
from ..storage.models import Chunk, ChunkEmbedding


def ensure_embedded(
    session: Session,
    chunks: list[Chunk],
    embeddings,
    provider_key: str,
    faiss_manager: FaissIndexManager,
) -> dict[str, int]:
    """Returns {chunk_id: faiss_id} for every chunk in `chunks`, embedding
    only the ones that need it.
    """
    provider, model = provider_key.split("::", 1)
    sanitized = sanitize_provider_key(provider_key)

    chunk_id_to_faiss_id: dict[str, int] = {}
    to_embed: list[Chunk] = []

    for chunk in chunks:
        existing = session.execute(
            select(ChunkEmbedding).where(
                ChunkEmbedding.chunk_id == chunk.id,
                ChunkEmbedding.embedding_provider == provider,
                ChunkEmbedding.embedding_model == model,
            )
        ).scalar_one_or_none()

        if existing and existing.content_hash == chunk.content_hash:
            chunk_id_to_faiss_id[chunk.id] = existing.faiss_id
        else:
            if existing:
                # Content changed since last embed — drop the stale row,
                # it'll be replaced below. The old FAISS vector is simply
                # orphaned (never looked up again since no row points to it).
                session.delete(existing)
            to_embed.append(chunk)

    if to_embed:
        texts = [c.text for c in to_embed]
        vectors = np.array(embeddings.embed_documents(texts), dtype=np.float32)

        faiss_ids = [faiss_manager.next_id(sanitized) for _ in to_embed]
        faiss_manager.add(sanitized, faiss_ids, vectors)

        for chunk, faiss_id in zip(to_embed, faiss_ids):
            session.add(
                ChunkEmbedding(
                    chunk_id=chunk.id,
                    embedding_provider=provider,
                    embedding_model=model,
                    content_hash=chunk.content_hash,
                    faiss_id=faiss_id,
                )
            )
            chunk_id_to_faiss_id[chunk.id] = faiss_id

        session.flush()

    return chunk_id_to_faiss_id
