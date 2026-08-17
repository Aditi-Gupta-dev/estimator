"""EVA's read-only Knowledge Hub governance diagnostics — "how much of our
Knowledge Hub can EVA actually use?", "show me draft documents", "why isn't
the migration guideline being used?".

Deliberately READ-ONLY. EVA can inspect governance state and explain it, but
cannot publish/archive/reclassify anything — that stays a deliberate human
action through the admin API (routes/documents_route.py). Gated on
KNOWLEDGE_REVIEW (admin/sme only): the audit exposes per-document status and
issue lists across the WHOLE corpus, including documents a broader audience
shouldn't be enumerating.

Same pattern as estimator_context.py's selectors: the data is already a
cheap DB query, so this is a deterministic selector invoked by a graph node,
not an LLM tool-call — nothing here is guessed.
"""
from sqlalchemy.orm import Session

from ..config import settings
from ..governance.audit import audit_documents, corpus_metrics, find_duplicate_documents
from .capabilities import Capability, role_can

_COVERAGE_TERMS = (
    "how much of", "knowledge hub", "knowledge base", "corpus", "how many document",
    "how much published", "coverage", "retrievability", "retrievable",
)
_LIST_DRAFT_TERMS = (
    "draft document", "still draft", "unpublished", "not published", "which documents",
    "show me document", "show draft",
)
_DIAGNOSE_TERMS = ("why isn't", "why is not", "why won't", "why can't eva", "not being used", "not used")
_DUPLICATE_TERMS = ("duplicate", "duplicated")


def is_governance_question(message: str) -> bool:
    text = (message or "").lower()
    return any(
        t in text
        for group in (_COVERAGE_TERMS, _LIST_DRAFT_TERMS, _DIAGNOSE_TERMS, _DUPLICATE_TERMS)
        for t in group
    )


def _fmt_coverage(session: Session) -> dict:
    m = corpus_metrics(session)
    d, c = m["documents"], m["chunks"]
    text = (
        f"documents_total={d['total']}; published={d['published']}; draft={d['draft']}; "
        f"in_review={d['in_review']}; archived={d['archived']}; rejected={d['rejected']}; "
        f"chunks_total={c['total']}; chunks_retrievable={c['retrievable']}; "
        f"retrievability_pct={m['retrievability_pct']}%. "
        f"Only PUBLISHED, non-revoked documents are retrievable — draft/in_review/archived/"
        f"rejected documents exist in the corpus but EVA cannot use them until an admin publishes them."
    )
    return {"title": "Knowledge Hub coverage (real, from the document database)", "text": text}


def _fmt_draft_list(session: Session) -> dict:
    docs = [d for d in audit_documents(session, settings.kh_root) if d.status != "published"]
    if not docs:
        return {"title": "Draft/unpublished documents", "text": "None — every document is published."}
    lines = "; ".join(
        f"{d.title} [{d.status}, {d.recommended_action}]" for d in docs[:20]
    )
    more = f" (+{len(docs) - 20} more)" if len(docs) > 20 else ""
    return {"title": "Draft/unpublished documents", "text": lines + more}


def _fmt_diagnosis(session: Session, message: str) -> dict | None:
    """Best-effort match of a document title against words in the question."""
    docs = audit_documents(session, settings.kh_root)
    if not docs:
        return None
    words = {w for w in (message or "").lower().split() if len(w) > 3}
    scored = sorted(
        docs,
        key=lambda d: len(words & set(d.title.lower().replace("_", " ").split())),
        reverse=True,
    )
    best = scored[0]
    if not (words & set(best.title.lower().replace("_", " ").split())):
        return None  # no title overlapped any meaningful word — don't guess which document

    reasons = []
    if not best.on_disk:
        reasons.append("its source file is missing from disk")
    if best.chunk_count == 0:
        reasons.append("it has zero indexed chunks (ingestion produced no content)")
    if best.status != "published":
        reasons.append(f"its status is '{best.status}', not 'published'")
    if not reasons:
        reasons.append("no issue found — it should be retrievable for permitted roles")

    text = (
        f"document='{best.title}'; status={best.status}; sensitivity={best.sensitivity}; "
        f"chunk_count={best.chunk_count}; on_disk={best.on_disk}; "
        f"allowed_roles={best.access_roles}; reason(s) it may not be used: {'; '.join(reasons)}."
    )
    return {"title": f"Diagnosis: {best.title}", "text": text}


def _fmt_duplicates(session: Session) -> dict:
    groups = find_duplicate_documents(session)
    if not groups:
        return {"title": "Duplicate documents", "text": "None found — every document has distinct content."}
    return {
        "title": "Duplicate documents",
        "text": f"{len(groups)} group(s) of documents share identical content across different paths "
                f"(document ids): {groups[:10]}.",
    }


def select_governance_blocks(message: str, caller_role: str, session: Session) -> list[dict]:
    if not role_can(caller_role, Capability.KNOWLEDGE_REVIEW):
        return []
    if not is_governance_question(message):
        return []

    text = (message or "").lower()
    blocks = []

    if any(t in text for t in _DIAGNOSE_TERMS):
        diag = _fmt_diagnosis(session, message)
        if diag:
            blocks.append(diag)
    if any(t in text for t in _LIST_DRAFT_TERMS):
        blocks.append(_fmt_draft_list(session))
    if any(t in text for t in _DUPLICATE_TERMS):
        blocks.append(_fmt_duplicates(session))
    if any(t in text for t in _COVERAGE_TERMS) or not blocks:
        blocks.append(_fmt_coverage(session))

    return blocks
