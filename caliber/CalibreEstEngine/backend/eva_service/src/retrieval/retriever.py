"""Scoped retrieval — cosine top-k over just the (already SQL-narrowed and
lazily-embedded) candidate matrix. Deliberately not a global FAISS
ID-filtered search; see storage/faiss_manager.py's module docstring for why.
"""
from dataclasses import dataclass

import numpy as np

from ..providers.embedding_factory import sanitize_provider_key
from ..storage.faiss_manager import FaissIndexManager
from ..storage.models import Chunk


@dataclass
class RetrievedChunk:
    chunk: Chunk
    score: float


def retrieve(
    chunks: list[Chunk],
    chunk_id_to_faiss_id: dict[str, int],
    embeddings,
    provider_key: str,
    faiss_manager: FaissIndexManager,
    queries: list[str],
    k: int,
) -> list[RetrievedChunk]:
    if not chunks:
        return []

    sanitized = sanitize_provider_key(provider_key)
    faiss_ids = [chunk_id_to_faiss_id[c.id] for c in chunks]
    matrix = faiss_manager.get_vectors(sanitized, faiss_ids)  # already L2-normalized

    best_by_chunk_id: dict[str, RetrievedChunk] = {}

    for query in queries:
        q_vec = np.array(embeddings.embed_query(query), dtype=np.float32)
        q_vec = q_vec / (np.linalg.norm(q_vec) or 1.0)

        scores = matrix @ q_vec
        top_n = min(k, len(chunks))
        top_indices = np.argsort(-scores)[:top_n]

        for idx in top_indices:
            chunk = chunks[idx]
            score = float(scores[idx])
            existing = best_by_chunk_id.get(chunk.id)
            if existing is None or score > existing.score:
                best_by_chunk_id[chunk.id] = RetrievedChunk(chunk, score)

    return sorted(best_by_chunk_id.values(), key=lambda r: -r.score)
