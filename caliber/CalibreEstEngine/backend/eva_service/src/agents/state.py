"""LangGraph state schema for the EVA multi-agent graph.

No checkpointer is configured on the compiled graph (see graph.py) —
conversation continuity already lives in SQLite (ChatMessage/ChatSession/
rolling_summary), so LangGraph's own persistence would just duplicate that.
Because state is never serialized, it's safe to carry a live SQLAlchemy
Session and the LLM/embeddings client objects through state by reference —
if a checkpointer is ever added later, those three fields need to move to
an injected-dependency/config pattern instead.
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class AgentTrailStep(TypedDict):
    step: str      # machine id, e.g. "supervisor" | "retrieve" | "estimate_tool" | "generate"
    label: str     # human label, e.g. "Retrieved 5 docs"
    detail: str    # one-line elaboration, may be empty


def trail_step(step: str, label: str, detail: str = "") -> list[AgentTrailStep]:
    return [{"step": step, "label": label, "detail": detail}]


class EvaGraphState(TypedDict, total=False):
    # ── request-scoped input (set once before invoke) ──────────────────────
    message: str
    caller_role: str
    unit_id: str | None
    rolling_summary: str | None  # deprecated client-supplied fallback — see recent_messages

    # ── memory (fetched once in chat_route.py before graph.invoke()) ───────
    # Short-term: last <=20 ChatMessage rows for this session (real turns,
    # oldest first) — see retrieval/short_term_memory.py. Long-term: durable
    # cross-session facts for this browser (client_id) — see memory/store.py.
    recent_messages: list  # list[ChatMessage]
    long_term_facts: list  # list[UserMemory]

    # ── provider/session handles (bound once, read-only references) ───────
    llm: Any
    embeddings: Any
    provider_key: str
    session: Any  # SQLAlchemy Session, request-scoped

    # ── supervisor output ───────────────────────────────────────────────────
    plan: dict
    intent: str
    filters: dict

    # ── retrieval ────────────────────────────────────────────────────────────
    candidates: list      # list[Chunk]
    retrieved: list        # list[RetrievedChunk]
    is_restricted: bool

    # ── live estimator context (the estimate the user is looking at) ────────
    # Sanitized in chat_route.py before it ever enters the graph — see
    # agents/estimator_context.py sanitize_estimator_context(). None when the
    # user isn't on the estimator page.
    estimator_context: dict | None
    estimator_blocks: list  # list[{title, text}] selected for this turn

    # ── what-if scenarios (executed by the real engine, never predicted) ────
    scenario_request: dict | None   # the validated change set that was applied
    scenario_result: dict | None    # {current, scenario, delta} from the runner
    scenario_error: str | None      # machine code, e.g. "unsupported_change"
    scenario_error_detail: str | None
    risk_reduction: list            # candidates that measurably reduced risk

    # ── estimate tool ────────────────────────────────────────────────────────
    score_request: dict | None
    score_result: dict | None  # raw /score JSON: {ml_calibration, similar_projects}
    score_missing_fields: list[str]

    # ── generation output ───────────────────────────────────────────────────
    answer_text: str
    citations: list[dict]
    injection_suspected: bool

    # ── cross-cutting, accumulated across every node ───────────────────────
    agent_trail: Annotated[list[AgentTrailStep], operator.add]
