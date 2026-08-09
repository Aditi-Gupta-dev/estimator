"""Internal-only route — called by upload-server's /api/upload handler
(fire-and-forget, not proxied to the frontend) right after a new file and
its sidecar JSON land on disk.
"""
import logging
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..ingestion.pipeline import ingest_document
from ..storage.db import session_scope

log = logging.getLogger("eva_service.ingest")
router = APIRouter()


class IngestRequest(BaseModel):
    filePath: str
    metadataPath: str | None = None


@router.post("/internal/ingest")
def ingest(req: IngestRequest):
    original_path = Path(req.filePath)
    sidecar_path = Path(req.metadataPath) if req.metadataPath else None

    if not original_path.exists():
        log.warning("Ingest requested for missing file: %s", original_path)
        return {"success": False, "error": "file not found"}

    try:
        with session_scope() as session:
            doc_id, changed = ingest_document(original_path, sidecar_path, session)
    except Exception as err:  # noqa: BLE001 — must never crash the upload flow
        log.exception("Ingest failed for %s", original_path)
        return {"success": False, "error": str(err)}

    if doc_id is None:
        return {"success": False, "error": f"unsupported file type: {original_path.suffix}"}

    return {"success": True, "document_id": doc_id, "changed": changed}
