"""Internal-only Knowledge Hub governance routes — called by upload-server's
authenticated /api/documents* proxy, never by the browser directly, matching
/internal/ingest's trust boundary (see that file's docstring: the real
authorization gate is upload-server's requireAuth + requireCapability).

A lightweight capability re-check still happens here on the mutating route
(defense in depth, same reasoning as scenario_tool.py's routing-time check)
since a PATCH here writes an audit trail whose actor identity must be real.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from ..agents.capabilities import Capability, role_can
from ..governance.audit import audit_documents, corpus_metrics, find_duplicate_documents, find_orphans_on_disk
from ..ingestion.sensitivity import ALL_LEVELS as ALL_SENSITIVITY_LEVELS, roles_for_sensitivity
from ..config import settings
from ..storage.db import session_scope
from ..storage.document_status import can_transition
from ..storage.models import Document, GovernanceEvent

log = logging.getLogger("eva_service.documents")
router = APIRouter()


def _audit_to_dict(a) -> dict:
    return {
        "id": a.id, "title": a.title, "documentClass": a.document_class,
        "sensitivity": a.sensitivity, "status": a.status, "accessRoles": a.access_roles,
        "buFolder": a.bu_folder, "unitId": a.unit_id, "ownerName": a.owner_name,
        "hasSidecarMetadata": a.has_sidecar_metadata, "chunkCount": a.chunk_count,
        "embeddedChunkCount": a.embedded_chunk_count, "onDisk": a.on_disk,
        "isRetrievable": a.is_retrievable, "recommendedAction": a.recommended_action,
        "issues": a.issues,
    }


@router.get("/internal/documents")
def list_documents():
    with session_scope() as session:
        docs = audit_documents(session, settings.kh_root)
        return {"success": True, "documents": [_audit_to_dict(d) for d in docs]}


@router.get("/internal/knowledge/audit")
def knowledge_audit():
    """The real numbers behind '23 documents, 2 published, 3.2% retrievable'
    — reproducible, not a one-off hand count."""
    with session_scope() as session:
        metrics = corpus_metrics(session)
        orphans = find_orphans_on_disk(session, settings.kh_root)
        duplicates = find_duplicate_documents(session)
        return {
            "success": True,
            "metrics": metrics,
            "orphansOnDisk": orphans,
            "duplicateGroups": duplicates,
        }


class DocumentPatchRequest(BaseModel):
    status: str | None = None
    sensitivity: str | None = None
    ownerUserId: str | None = None
    ownerName: str | None = None
    reason: str | None = None
    # Actor identity — set by upload-server from the verified session, never
    # taken at face value from the browser. eva_service still re-validates
    # the capability below since this write produces an audit record.
    actorUserId: str
    actorName: str
    actorRole: str


@router.patch("/internal/documents/{document_id}")
def patch_document(document_id: str, req: DocumentPatchRequest):
    if not role_can(req.actorRole, Capability.KNOWLEDGE_REVIEW):
        return {"success": False, "error": "This role is not permitted to manage Knowledge Hub documents."}

    if req.sensitivity is not None and req.sensitivity not in ALL_SENSITIVITY_LEVELS:
        return {"success": False, "error": f"Unknown sensitivity '{req.sensitivity}'."}

    with session_scope() as session:
        doc = session.execute(select(Document).where(Document.id == document_id)).scalar_one_or_none()
        if doc is None:
            return {"success": False, "error": "Document not found."}

        events = []
        now = datetime.now(timezone.utc)

        if req.status is not None and req.status != doc.status:
            if not can_transition(doc.status, req.status):
                return {
                    "success": False,
                    "error": f"Cannot transition from '{doc.status}' to '{req.status}'.",
                }
            # Publishing rate-card content is never implicit — the caller
            # must be explicitly changing sensitivity/status in the SAME
            # governed action, which they are: this endpoint only runs on an
            # explicit admin PATCH, never automatically.
            events.append(GovernanceEvent(
                document_id=doc.id, action=req.status, field="status",
                previous_value=doc.status, new_value=req.status,
                actor_user_id=req.actorUserId, actor_name=req.actorName, actor_role=req.actorRole,
                reason=req.reason,
            ))
            doc.status = req.status

        if req.sensitivity is not None and req.sensitivity != doc.sensitivity:
            new_access = json.dumps(roles_for_sensitivity(req.sensitivity))
            events.append(GovernanceEvent(
                document_id=doc.id, action="reclassify", field="sensitivity",
                previous_value=doc.sensitivity, new_value=req.sensitivity,
                actor_user_id=req.actorUserId, actor_name=req.actorName, actor_role=req.actorRole,
                reason=req.reason,
            ))
            events.append(GovernanceEvent(
                document_id=doc.id, action="reclassify", field="access_roles",
                previous_value=doc.access_roles, new_value=new_access,
                actor_user_id=req.actorUserId, actor_name=req.actorName, actor_role=req.actorRole,
                reason=req.reason,
            ))
            doc.sensitivity = req.sensitivity
            doc.access_roles = new_access

        if req.ownerUserId is not None or req.ownerName is not None:
            events.append(GovernanceEvent(
                document_id=doc.id, action="set_owner", field="owner",
                previous_value=doc.owner_name, new_value=req.ownerName,
                actor_user_id=req.actorUserId, actor_name=req.actorName, actor_role=req.actorRole,
                reason=req.reason,
            ))
            doc.owner_user_id = req.ownerUserId or doc.owner_user_id
            doc.owner_name = req.ownerName or doc.owner_name

        if not events:
            return {"success": True, "changed": False, "message": "No changes requested."}

        # This PATCH is now authoritative for this document's governance
        # fields — re-ingesting unchanged bytes will never again silently
        # revert it (see ingestion/registrar.py).
        doc.governance_set_at = now
        for event in events:
            session.add(event)
        session.flush()

        log.info(
            "Governance action on %s by %s (%s): %s",
            doc.id, req.actorName, req.actorRole, [e.action for e in events],
        )

        updated = [a for a in audit_documents(session, settings.kh_root) if a.id == document_id][0]
        return {"success": True, "changed": True, "document": _audit_to_dict(updated)}
