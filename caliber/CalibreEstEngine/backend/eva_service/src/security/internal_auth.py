"""Shared-secret verification for requests that must originate from
upload-server — the only trusted caller of this service's routes.

Before this existed, every route here (chat, plan, ingest, documents)
accepted callerRole/callerUserId/callerName/actorRole/actorUserId/actorName
straight from the request body and trusted them, relying entirely on
network topology ("only upload-server can reach this port") — the RBAC
audit flagged this as a real hole: anything else able to reach this port
could POST {"callerRole": "admin"} directly and bypass every role gate
downstream, including rate-card sanitization and estimate ownership checks.

upload-server now sends this header on every call into eva_service; the
value must match settings.internal_api_key — the SAME secret already used
in the other direction (eva_service -> upload-server's own /internal/*
routes, see agents/scenario_tool.py / estimate_persistence_tool.py). One
shared secret for both directions, not a second one introduced for this.

Applied as a router-level dependency in main.py, so it runs BEFORE any route
handler body executes — a missing or wrong header never reaches a point
where callerRole/callerUserId/callerName could influence a response.
GET /health is deliberately excluded: it carries no identity-bearing data,
and /api/system/overview's health probe has no way to send this header.
"""
from fastapi import Header, HTTPException

from ..config import settings

INTERNAL_KEY_HEADER = "x-internal-key"


def require_internal_key(x_internal_key: str | None = Header(default=None, alias=INTERNAL_KEY_HEADER)) -> None:
    if not x_internal_key:
        raise HTTPException(status_code=401, detail="Missing internal authentication header.")
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Invalid internal authentication header.")
