"""Citation extraction — parses [C1]/[C2] tags out of the LLM's answer text
(per EVA_SYSTEM_PROMPT R3) and maps them back to the retrieved chunks that
were actually placed in <context>, so the frontend can render provenance.
Also detects the R4 `injection_suspected` flag.
"""
import re

from ..retrieval.retriever import RetrievedChunk

_CITATION_RE = re.compile(r"\[C(\d+)\]")


def extract_citations(
    answer_text: str,
    context_chunks: list[RetrievedChunk],
    synthetic_citations: dict[int, dict] | None = None,
) -> list[dict]:
    """context_chunks must be in the same order they were numbered when
    building <context> (buildEVAContext assigns [C1] to context_chunks[0],
    etc.) — nodes.py must pass the identical ordered list here.

    synthetic_citations maps a 1-indexed citation number (continuing on
    from context_chunks, e.g. len(context_chunks)+1) to a pre-built
    citation dict for context entries that don't back onto a real Chunk
    row — currently only the estimate tool's ml-model result.
    """
    cited_indices = sorted({int(m) for m in _CITATION_RE.findall(answer_text)})

    citations = []
    for n in cited_indices:
        idx = n - 1
        if 0 <= idx < len(context_chunks):
            chunk = context_chunks[idx].chunk
            citations.append({
                "tag": f"C{n}",
                "chunk_id": chunk.id,
                "document_id": chunk.document_id,
                "document_title": chunk.document.title,
                "section_path": chunk.section_path,
                "unit_id": chunk.document.unit_id,
                "document_class": chunk.document.document_class,
                # Exact match to the frontend's file.path/filePath convention
                # (GET /api/files walks KH_ROOT prefixed with "KnowledgeHub"),
                # so useKnowledgeHub.js can resolve this directly — see
                # EVA_RAG_IMPLEMENTATION_PLAN.md's agents plan.
                "document_path": f"KnowledgeHub/{chunk.document.original_path}",
                "provenance": None,
            })
        elif synthetic_citations and n in synthetic_citations:
            citations.append(synthetic_citations[n])
    return citations


def detect_injection_suspected(answer_text: str) -> bool:
    return "injection_suspected" in answer_text.lower()
