"""POST /api/eva/plan — standalone retrieval-planner endpoint. Useful as a
debug/admin tool; the hot chat path (chat_route.py) runs planning
internally rather than requiring two sequential round-trips per turn.
"""
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings
from ..providers.llm_factory import get_llm
from ..retrieval.planner import plan_query

log = logging.getLogger("eva_service.plan_route")
router = APIRouter()


class PlanRequest(BaseModel):
    userTurn: str
    callerRole: str | None = None
    unitId: str | None = None
    estimateId: str | None = None
    rollingSummary: str | None = None


@router.post("/api/eva/plan")
def plan(req: PlanRequest):
    try:
        llm = get_llm(settings)
    except RuntimeError as err:
        log.warning("No LLM provider configured, using fallback plan: %s", err)
        llm = None

    return plan_query(llm, req.userTurn, req.callerRole, req.unitId, req.estimateId, req.rollingSummary)
