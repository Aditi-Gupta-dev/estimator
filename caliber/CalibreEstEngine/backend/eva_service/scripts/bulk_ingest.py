"""One-time backfill of the existing KnowledgeHub corpus — everything that
predates the upload-server ingest webhook. Idempotent: re-running is safe,
unchanged documents are skipped via content_hash.

Run from backend/eva_service/:  python scripts/bulk_ingest.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings  # noqa: E402
from src.governance.paths import walk_knowledge_hub  # noqa: E402
from src.ingestion.converters import SUPPORTED_EXTS  # noqa: E402
from src.ingestion.pipeline import ingest_document  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402


def main():
    init_db()
    kh_root = settings.kh_root
    if not kh_root.exists():
        print(f"KnowledgeHub root not found: {kh_root}")
        sys.exit(1)

    ingested, skipped_unchanged, skipped_unsupported = 0, 0, 0

    with session_scope() as session:
        for original_path, sidecar_path in walk_knowledge_hub(kh_root):
            if original_path.suffix.lower() not in SUPPORTED_EXTS:
                skipped_unsupported += 1
                continue
            try:
                doc_id, changed = ingest_document(original_path, sidecar_path, session)
            except Exception as err:  # noqa: BLE001
                print(f"  FAILED  {original_path.relative_to(kh_root)}: {err}")
                continue

            if doc_id is None:
                skipped_unsupported += 1
                continue
            if changed:
                ingested += 1
                print(f"  OK      {original_path.relative_to(kh_root)}")
            else:
                skipped_unchanged += 1
                print(f"  SKIP    {original_path.relative_to(kh_root)} (unchanged)")

    print(
        f"\nDone. ingested/updated={ingested}  unchanged={skipped_unchanged}  "
        f"unsupported={skipped_unsupported}"
    )


if __name__ == "__main__":
    main()
