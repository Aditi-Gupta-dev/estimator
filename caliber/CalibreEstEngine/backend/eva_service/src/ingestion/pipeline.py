"""ingest_document() — convert -> chunk -> register. Does NOT embed.

Shared by the upload-server webhook (routes/ingest_route.py) and the
one-time backfill script (scripts/bulk_ingest.py), so both paths resolve
metadata identically.
"""
import json
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from .chunker import chunk_markdown
from .converters import SUPPORTED_EXTS, convert_to_markdown
from .registrar import register_document

# Real on-disk KnowledgeHub folder -> canonical lowercase unit_id, matching
# frontend/calibre-app/src/constants/eva-retrieval-planner.js UNIT_IDS.
FOLDER_TO_UNIT_ID = {
    "ESU": "esu", "ADM": "adm", "ITIS": "itis", "BPS": "bps", "TI": "ti",
    "iON": "ion", "BFSI": "bfsi", "IAE": "iae", "CYBER": "cyber",
    "AI": "ai", "DATACLOUD": "datacloud", "_global": "_global",
}

# Ported from useKnowledgeHub.js's deriveTypeFromFilename — used only when
# no sidecar JSON exists for a file.
def _derive_type_from_filename(name: str, subdivision: str) -> str:
    if subdivision == "templates":
        return "template"
    lower = name.lower()
    if "guideline" in lower:
        return "guideline"
    if "pov" in lower or "point of view" in lower:
        return "pov"
    if "case study" in lower or "casestudy" in lower:
        return "casestudy"
    if "playbook" in lower:
        return "playbook"
    if "rate" in lower or "cost" in lower or "card" in lower:
        return "ratecard"
    if "benchmark" in lower or "baseline" in lower:
        return "benchmark"
    if "faq" in lower or "question" in lower:
        return "faq"
    if "whitepaper" in lower or "white paper" in lower:
        return "whitepaper"
    if "proposal" in lower:
        return "proposal"
    if "video" in lower or "training" in lower:
        return "video"
    return "guideline"


def resolve_metadata(original_path: Path, sidecar_path: Path | None, kh_root: Path) -> dict:
    rel = original_path.relative_to(kh_root)
    parts = rel.parts  # (BU, templates|data, filename)
    bu_folder = parts[0] if len(parts) > 0 else "_global"
    subdivision = parts[1] if len(parts) > 1 and parts[1] in ("templates", "data") else "data"
    unit_id = FOLDER_TO_UNIT_ID.get(bu_folder, "_global")

    if sidecar_path and sidecar_path.exists():
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        return {
            "bu_folder": bu_folder,
            "unit_id": sidecar.get("unitId") or unit_id,
            "subdivision": subdivision,
            "title": sidecar.get("title") or original_path.stem,
            "document_class": sidecar.get("type") or _derive_type_from_filename(original_path.name, subdivision),
            "program_type": sidecar.get("programType"),
            "status": sidecar.get("status") or "draft",
            "version": sidecar.get("version"),
            "tags": sidecar.get("tags") or [],
        }

    return {
        "bu_folder": bu_folder,
        "unit_id": unit_id,
        "subdivision": subdivision,
        "title": original_path.stem,
        "document_class": _derive_type_from_filename(original_path.name, subdivision),
        "program_type": None,
        # No sidecar means metadata wasn't captured through the upload flow —
        # treat as draft (unpublished) rather than assuming it's safe to serve.
        "status": "draft",
        "version": None,
        "tags": [],
    }


def ingest_document(original_path: Path, sidecar_path: Path | None, session: Session) -> tuple[str | None, bool]:
    """Returns (document_id, changed). document_id is None if the file type
    isn't supported for conversion (skipped, not an error).
    """
    ext = original_path.suffix.lower()
    if ext not in SUPPORTED_EXTS:
        return None, False

    meta = resolve_metadata(original_path, sidecar_path, settings.kh_root)

    markdown_text = convert_to_markdown(original_path)

    md_dir = settings.markdown_dir / meta["bu_folder"] / meta["subdivision"]
    md_dir.mkdir(parents=True, exist_ok=True)
    md_path = md_dir / f"{original_path.stem}.md"
    md_path.write_text(markdown_text, encoding="utf-8")

    chunk_drafts = chunk_markdown(markdown_text, ext, meta["title"])

    doc_id, changed = register_document(
        session,
        bu_folder=meta["bu_folder"],
        unit_id=meta["unit_id"],
        subdivision=meta["subdivision"],
        title=meta["title"],
        document_class=meta["document_class"],
        program_type=meta["program_type"],
        file_type=ext.lstrip("."),
        original_path=str(original_path.relative_to(settings.kh_root)).replace("\\", "/"),
        markdown_path=str(md_path.relative_to(settings.markdown_dir.parent)).replace("\\", "/"),
        sidecar_path=str(sidecar_path.relative_to(settings.kh_root)).replace("\\", "/") if sidecar_path and sidecar_path.exists() else None,
        status=meta["status"],
        version=meta["version"],
        tags=meta["tags"],
        markdown_text=markdown_text,
        chunk_drafts=chunk_drafts,
    )
    return doc_id, changed
