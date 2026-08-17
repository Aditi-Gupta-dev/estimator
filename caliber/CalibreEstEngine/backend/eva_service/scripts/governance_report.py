"""Admin review report for the Knowledge Hub corpus - spec §17.

Prints, per document: title, status, type, business unit, sensitivity,
chunk count, and a deterministic recommended action. Read-only: this script
never changes a document's status, sensitivity, or anything else - it exists
so an admin can see exactly what governance/audit.py would tell them before
touching anything through the admin API.

Run from backend/eva_service/:  python scripts/governance_report.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings  # noqa: E402
from src.governance.audit import (  # noqa: E402
    audit_documents,
    corpus_metrics,
    find_duplicate_documents,
    find_orphans_on_disk,
)
from src.storage.db import init_db, session_scope  # noqa: E402


def main():
    init_db()

    with session_scope() as session:
        metrics = corpus_metrics(session)
        docs = audit_documents(session, settings.kh_root)
        orphans = find_orphans_on_disk(session, settings.kh_root)
        duplicates = find_duplicate_documents(session)

    d, c = metrics["documents"], metrics["chunks"]
    print("=" * 78)
    print("KNOWLEDGE HUB - CORPUS SUMMARY")
    print("=" * 78)
    print(f"{d['total']} documents")
    print(f"  published : {d['published']}")
    print(f"  draft     : {d['draft']}")
    print(f"  in_review : {d['in_review']}")
    print(f"  archived  : {d['archived']}")
    print(f"  rejected  : {d['rejected']}")
    print(f"{c['total']} chunks total, {c['retrievable']} retrievable "
          f"({metrics['retrievability_pct']}% of the corpus)")
    print()

    print("=" * 78)
    print("DOCUMENT REVIEW REPORT")
    print("=" * 78)
    header = f"{'DOCUMENT':<45} {'STATUS':<10} {'TYPE':<10} {'BU':<10} {'SENS':<12} {'CHUNKS':>6}  RECOMMENDED ACTION"
    print(header)
    print("-" * len(header))
    for doc in sorted(docs, key=lambda d: (d.status != "draft", d.title)):
        title = (doc.title[:42] + "...") if len(doc.title) > 45 else doc.title
        print(
            f"{title:<45} {doc.status:<10} {doc.document_class:<10} {doc.bu_folder:<10} "
            f"{(doc.sensitivity or '?'):<12} {doc.chunk_count:>6}  {doc.recommended_action}"
        )
        for issue in doc.issues:
            print(f"    - {issue}")
    print()

    if orphans:
        print("=" * 78)
        print(f"FILES ON DISK WITH NO DATABASE RECORD ({len(orphans)}) - never ingested,")
        print("or ingestion failed silently (see /internal/ingest's fire-and-forget trigger)")
        print("=" * 78)
        for path in orphans:
            print(f"  {path}")
        print()

    if duplicates:
        print("=" * 78)
        print(f"DUPLICATE CONTENT ({len(duplicates)} group(s)) - identical bytes at different paths")
        print("=" * 78)
        for group in duplicates:
            print(f"  {group}")
        print()

    print("This report changed nothing. Publish/archive/reclassify decisions are made")
    print("through the admin API (PATCH /api/documents/:id), one document at a time,")
    print("with an explicit reason recorded to the governance audit trail.")


if __name__ == "__main__":
    main()
