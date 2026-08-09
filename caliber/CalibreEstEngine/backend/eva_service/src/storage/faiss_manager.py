"""Persistent, per-(provider, model)-namespaced FAISS store.

This is what makes "embed once, cache forever" durable across restarts.
It is deliberately NOT used to perform per-query top-k search — that's
done via plain numpy cosine similarity over a small SQL-prefiltered
candidate set (see retrieval/retriever.py) because faiss-cpu's ID-restricted
search API (IDSelectorBatch/SearchParameters) is version-fragile. FAISS's
job here is just the durable on-disk vector store.
"""
import json
from pathlib import Path
from threading import Lock

import faiss
import numpy as np


class FaissIndexManager:
    def __init__(self, index_root: Path):
        self.index_root = index_root
        self._lock = Lock()
        self._indexes: dict[str, faiss.IndexIDMap2] = {}
        self._next_ids: dict[str, int] = {}
        self._dims: dict[str, int] = {}

    def _dir_for(self, provider_key_sanitized: str) -> Path:
        d = self.index_root / provider_key_sanitized
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _load_or_create(self, provider_key_sanitized: str, dim: int | None = None) -> faiss.IndexIDMap2:
        """dim is only required when there's no on-disk index yet (i.e. the
        very first vector for this provider) — an existing index file
        carries its own dimensionality, so a fresh process can reload it
        (e.g. for get_vectors()) without ever having called add() itself.
        """
        if provider_key_sanitized in self._indexes:
            return self._indexes[provider_key_sanitized]

        d = self._dir_for(provider_key_sanitized)
        index_path = d / "index.faiss"
        ids_path = d / "ids.json"

        if index_path.exists():
            index = faiss.read_index(str(index_path))
            meta = json.loads(ids_path.read_text()) if ids_path.exists() else {"next_id": 0}
            next_id = meta.get("next_id", 0)
            dim = index.d
        elif dim is not None:
            base = faiss.IndexFlatIP(dim)  # cosine via normalized vectors + inner product
            index = faiss.IndexIDMap2(base)
            next_id = 0
        else:
            raise RuntimeError(
                f"No FAISS index exists yet for '{provider_key_sanitized}' and no dim was "
                "given to create one — call add() first."
            )

        self._indexes[provider_key_sanitized] = index
        self._next_ids[provider_key_sanitized] = next_id
        self._dims[provider_key_sanitized] = dim
        return index

    def next_id(self, provider_key_sanitized: str) -> int:
        with self._lock:
            nid = self._next_ids.get(provider_key_sanitized, 0)
            self._next_ids[provider_key_sanitized] = nid + 1
            return nid

    def add(self, provider_key_sanitized: str, faiss_ids: list[int], vectors: np.ndarray) -> None:
        with self._lock:
            dim = vectors.shape[1]
            index = self._load_or_create(provider_key_sanitized, dim)
            normalized = _l2_normalize(vectors.astype(np.float32))
            index.add_with_ids(normalized, np.array(faiss_ids, dtype=np.int64))
            self._save(provider_key_sanitized)

    def get_vectors(self, provider_key_sanitized: str, faiss_ids: list[int]) -> np.ndarray:
        with self._lock:
            # dim=None is fine here — an on-disk index (which must exist if
            # we're being asked for vectors from it) carries its own dim.
            index = self._load_or_create(provider_key_sanitized)
            vectors = np.vstack([index.reconstruct(fid) for fid in faiss_ids])
            return vectors

    def _save(self, provider_key_sanitized: str) -> None:
        d = self._dir_for(provider_key_sanitized)
        faiss.write_index(self._indexes[provider_key_sanitized], str(d / "index.faiss"))
        (d / "ids.json").write_text(json.dumps({"next_id": self._next_ids[provider_key_sanitized]}))


def _l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


_manager: FaissIndexManager | None = None


def get_faiss_manager() -> FaissIndexManager:
    global _manager
    if _manager is None:
        from ..config import settings

        _manager = FaissIndexManager(settings.faiss_dir)
    return _manager

