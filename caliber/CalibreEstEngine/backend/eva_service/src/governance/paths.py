"""KnowledgeHub disk traversal — extracted from scripts/bulk_ingest.py so the
same walk is importable (scripts/ is a plain script directory, not a
package) rather than redefined. Used by both bulk_ingest.py and the
governance audit engine, which need to agree on exactly which files count as
documents.
"""
from pathlib import Path


def walk_knowledge_hub(kh_root: Path):
    """Same traversal shape as upload-server/index.js's walk(): skip
    .gitkeep and sidecar .json files, yield (original_path, sidecar_path).
    """
    for path in sorted(kh_root.rglob("*")):
        if path.is_dir():
            continue
        if path.name == ".gitkeep" or path.suffix.lower() == ".json":
            continue
        sidecar = path.with_name(path.name + ".json")
        yield path, (sidecar if sidecar.exists() else None)


def relative_to_kh_root(path: Path, kh_root: Path) -> str:
    """Matches how ingestion/pipeline.py stores Document.original_path."""
    return str(path.relative_to(kh_root)).replace("\\", "/")
