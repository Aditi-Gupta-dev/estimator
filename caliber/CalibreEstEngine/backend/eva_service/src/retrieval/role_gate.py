"""R5 second-line role gate — belt-and-suspenders re-check of the final
ranked chunk list, even though candidate_selector.py already filtered by
access_roles once (R5's own language: "even if such a chunk reaches you in
error").
"""
import json

from .retriever import RetrievedChunk


def filter_retrieved_chunks(retrieved: list[RetrievedChunk], caller_role: str) -> list[RetrievedChunk]:
    return [
        r for r in retrieved
        if caller_role in json.loads(r.chunk.document.access_roles)
    ]
