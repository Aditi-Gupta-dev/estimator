"""POST /api/eva — the real chat endpoint. Semantic cache check runs first
and can skip everything below it, including the planner LLM call. On a
miss, the request is handed to the EVA multi-agent LangGraph (agents/graph.py)
which runs planning/retrieval/tool-calling/generation internally.
"""
import json
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..agents.estimator_context import is_estimate_question, sanitize_estimator_context
from ..agents.graph import get_eva_graph
from ..cache.semantic_cache import SemanticCache
from ..config import settings
from ..generation.system_prompt import classify_eva_function
from ..memory.store import get_long_term_memory
from ..providers.embedding_factory import get_embeddings
from ..providers.llm_factory import get_llm
from ..retrieval.short_term_memory import get_recent_messages
from ..storage.db import session_scope
from ..storage.models import ChatMessage, ChatSession

log = logging.getLogger("eva_service.chat_route")
router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    callerRole: str = "estimator"
    # Verified session identity, forwarded by upload-server's /api/eva proxy
    # the same way callerRole is — never taken from the client directly.
    # Optional/None only for callers that predate this field (there are
    # none in production; kept optional so a partial deploy fails soft
    # rather than 422ing every chat turn). Used to attribute estimates
    # EVA creates/saves on the user's behalf to the real logged-in user.
    callerUserId: str | None = None
    callerName: str | None = None
    unitId: str | None = None
    sessionId: str | None = None
    rollingSummary: str | None = None
    # Persistent per-browser identity (localStorage-generated UUID, see
    # useEVA.js) — the long-term-memory scope. Optional: requests without
    # one simply get no long-term memory, same as before this feature.
    clientId: str | None = None
    # Snapshot of the estimate the user is currently viewing (null on
    # non-estimator pages). UNTRUSTED client input: it is sanitized against
    # the gateway-verified callerRole before entering the graph, and never
    # influences authorization.
    estimatorContext: dict | None = None


def handle_chat(req: ChatRequest) -> dict:
    eva_fn = classify_eva_function(req.message)
    embeddings, provider_key = get_embeddings(settings)
    provider = provider_key.split("::", 1)[0]
    cache = SemanticCache(settings.cache_similarity_threshold)

    # Answers grounded in the live estimate must never be cached or served
    # from cache: the cache key is (role, unit, provider), so "what is my
    # cost?" asked against a since-edited estimate would otherwise return
    # the previous estimate's number. Estimate-specific turns bypass the
    # cache entirely in both directions.
    estimate_scoped = bool(req.estimatorContext) and is_estimate_question(req.message, None)

    with session_scope() as session:
        cache_result = cache.lookup(
            session,
            query_text=req.message,
            caller_role=req.callerRole,
            unit_id=req.unitId,
            embedding_provider=provider,
            embeddings=embeddings,
        )

        if cache_result.hit and not estimate_scoped:
            cache.record_hit(session, cache_result.hit)
            session_id = _ensure_session(session, req.sessionId, req.callerRole, req.unitId, req.clientId)
            citations = json.loads(cache_result.hit.citations)
            session.add(ChatMessage(session_id=session_id, role="user", text=req.message))
            session.add(
                ChatMessage(
                    session_id=session_id, role="eva", text=cache_result.hit.answer_text,
                    citations_json=cache_result.hit.citations, cache_hit=True,
                    intent=cache_result.hit.intent,
                )
            )
            return {
                "answer": cache_result.hit.answer_text,
                "citations": citations,
                "evaFn": eva_fn,
                "plan": None,
                "intent": cache_result.hit.intent,
                "isRestricted": False,
                "injectionSuspected": False,
                "cacheHit": True,
                "sessionId": session_id,
                "agentTrail": [{"step": "cache", "label": "Cache hit", "detail": ""}],
                "mlCalibration": None,
            }

    try:
        llm = get_llm(settings)
    except RuntimeError as err:
        log.error("No LLM provider configured: %s", err)
        return {
            "answer": "EVA is not configured with an LLM provider yet. Contact Admin / COE.",
            "citations": [],
            "evaFn": eva_fn,
            "plan": None,
            "intent": None,
            "isRestricted": False,
            "injectionSuspected": False,
            "cacheHit": False,
            "agentTrail": [],
            "mlCalibration": None,
        }

    with session_scope() as session:
        # Session resolved up front (not after graph.invoke() as before) so
        # short-term memory can be fetched for it before the graph runs.
        session_id = _ensure_session(session, req.sessionId, req.callerRole, req.unitId, req.clientId)
        recent_messages = get_recent_messages(session, session_id, settings.short_term_message_limit)
        long_term_facts = get_long_term_memory(session, req.clientId, settings.long_term_memory_limit)

        initial_state = {
            "message": req.message,
            "caller_role": req.callerRole,
            "caller_user_id": req.callerUserId,
            "caller_name": req.callerName,
            "unit_id": req.unitId,
            "rolling_summary": req.rollingSummary,
            "recent_messages": recent_messages,
            "long_term_facts": long_term_facts,
            "llm": llm,
            "embeddings": embeddings,
            "provider_key": provider_key,
            "session": session,
            # Sanitized against the gateway-verified role BEFORE it can reach
            # the graph or the LLM — the client cannot widen its own access
            # by stuffing rate figures into this blob.
            "estimator_context": sanitize_estimator_context(req.estimatorContext, req.callerRole),
            "agent_trail": [],
        }
        final_state = get_eva_graph().invoke(initial_state)

        plan = final_state.get("plan") or {}
        filters = plan.get("filters") or {}
        answer_text = final_state["answer_text"]
        citations = final_state.get("citations") or []
        is_restricted = final_state.get("is_restricted", False)
        injection_suspected = final_state.get("injection_suspected", False)
        score_result = final_state.get("score_result")

        session.add(ChatMessage(session_id=session_id, role="user", text=req.message))
        session.add(
            ChatMessage(
                session_id=session_id,
                role="eva",
                text=answer_text,
                plan_json=json.dumps(plan),
                citations_json=json.dumps(citations),
                cache_hit=False,
                injection_suspected=injection_suspected,
                intent=plan.get("intent"),
            )
        )

        # Cache write — reuses the query embedding already computed at the
        # lookup miss above, no re-embedding. Restricted-reply answers are
        # cached too (scoped by caller_role, so this never leaks across
        # roles — a differently-privileged caller gets its own cache miss
        # and its own role-gate evaluation). Estimate-scoped answers are
        # NOT cached: they're only true for one particular estimate.
        if not estimate_scoped:
            cache.write(
                session,
                query_text=req.message,
                query_embedding_bytes=cache_result.query_embedding_bytes,
                embedding_provider=provider,
                embedding_model=provider_key.split("::", 1)[1],
                answer_text=answer_text,
                citations=citations,
                caller_role=req.callerRole,
                unit_id=req.unitId,
                subdivision=filters.get("subdivision"),
                document_class=filters.get("document_class"),
                intent=plan.get("intent"),
            )

    return {
        "answer": answer_text,
        "citations": citations,
        "evaFn": eva_fn,
        "plan": plan,
        "intent": plan.get("intent"),
        "isRestricted": is_restricted,
        "injectionSuspected": injection_suspected,
        "cacheHit": False,
        "sessionId": session_id,
        "agentTrail": final_state.get("agent_trail") or [],
        "mlCalibration": score_result["ml_calibration"] if score_result else None,
    }


def _ensure_session(session, session_id: str | None, caller_role: str, unit_id: str | None, client_id: str | None = None) -> str:
    if session_id:
        existing = session.get(ChatSession, session_id)
        if existing:
            # Backfill client_id on a session that predates it (or was
            # created before the frontend had a persisted one yet).
            if client_id and not existing.client_id:
                existing.client_id = client_id
            return existing.id
    new_session = ChatSession(
        id=session_id, caller_role=caller_role, unit_id=unit_id, client_id=client_id,
    ) if session_id else ChatSession(caller_role=caller_role, unit_id=unit_id, client_id=client_id)
    session.add(new_session)
    session.flush()
    return new_session.id


@router.post("/api/eva")
def chat(req: ChatRequest):
    return handle_chat(req)
