"""Graph node functions. Each takes the full EvaGraphState and returns a
partial state update dict — LangGraph merges these (agent_trail via the
operator.add reducer, everything else by plain overwrite).

retrieve_node ports today's (pre-graph) chat_route.py retrieval chain
verbatim: select_candidate_chunks -> has_role_restricted_matches ->
ensure_embedded -> retrieve -> filter_retrieved_chunks.
"""
from ..generation.chain import generate_answer
from ..generation.citation import detect_injection_suspected, extract_citations
from ..generation.system_prompt import (
    build_eva_prompt,
    build_clarify_reply,
    build_navigate_reply,
    build_out_of_scope_reply,
    build_restricted_reply,
)
from ..retrieval.candidate_selector import has_role_restricted_matches, select_candidate_chunks
from ..retrieval.embed_on_demand import ensure_embedded
from ..retrieval.planner import plan_query
from ..retrieval.retriever import retrieve as retrieve_chunks
from ..retrieval.role_gate import filter_retrieved_chunks
from ..retrieval.short_term_memory import build_rolling_summary
from ..storage.faiss_manager import get_faiss_manager
from .state import EvaGraphState, trail_step


def supervisor_node(state: EvaGraphState) -> dict:
    # Short-term memory (real ChatMessage history for this session) is the
    # source of truth for turn_history_summary when available; the
    # client-supplied rolling_summary is only a fallback for sessions with
    # no persisted history yet (e.g. session_id absent).
    recent_messages = state.get("recent_messages") or []
    rolling_summary = build_rolling_summary(recent_messages) if recent_messages else state.get("rolling_summary")

    plan = plan_query(
        state["llm"], state["message"], state["caller_role"],
        state.get("unit_id"), None, rolling_summary,
    )
    intent = plan.get("intent")
    return {
        "plan": plan,
        "intent": intent,
        "filters": plan.get("filters") or {},
        "rolling_summary": rolling_summary,
        "agent_trail": trail_step("supervisor", "Routed", f"intent={intent}"),
    }


def retrieve_node(state: EvaGraphState) -> dict:
    session = state["session"]
    plan = state.get("plan") or {}
    filters = state.get("filters") or {}
    caller_role = state["caller_role"]

    if not plan.get("needs_retrieval"):
        return {
            "candidates": [], "retrieved": [], "is_restricted": False,
            "agent_trail": trail_step("retrieve", "Skipped retrieval", "not needed for this turn"),
        }

    candidates = select_candidate_chunks(
        session, caller_role=caller_role,
        unit_id=filters.get("unit_id"), subdivision=filters.get("subdivision"),
        document_class=filters.get("document_class"), program_type=filters.get("program_type"),
    )

    if not candidates and has_role_restricted_matches(
        session, caller_role=caller_role,
        unit_id=filters.get("unit_id"), subdivision=filters.get("subdivision"),
        document_class=filters.get("document_class"), program_type=filters.get("program_type"),
    ):
        return {
            "candidates": [], "retrieved": [], "is_restricted": True,
            "agent_trail": trail_step("retrieve", "Restricted", "matching content exists but is role-gated"),
        }

    if not candidates:
        return {
            "candidates": [], "retrieved": [], "is_restricted": False,
            "agent_trail": trail_step("retrieve", "No matching documents", ""),
        }

    faiss_manager = get_faiss_manager()
    chunk_id_to_faiss_id = ensure_embedded(session, candidates, state["embeddings"], state["provider_key"], faiss_manager)
    retrieved = retrieve_chunks(
        candidates, chunk_id_to_faiss_id, state["embeddings"], state["provider_key"], faiss_manager,
        queries=plan.get("queries") or [state["message"]], k=plan.get("k", 5),
    )
    # R5 second line — belt-and-suspenders re-check (candidates were
    # already role-filtered once in select_candidate_chunks above).
    retrieved = filter_retrieved_chunks(retrieved, caller_role)

    return {
        "candidates": candidates, "retrieved": retrieved, "is_restricted": False,
        "agent_trail": trail_step("retrieve", f"Retrieved {len(retrieved)} chunk(s)", ""),
    }


def generate_node(state: EvaGraphState) -> dict:
    retrieved = state.get("retrieved") or []
    context_chunks = [
        {
            "source": f"{r.chunk.document.title} > {r.chunk.section_path}" if r.chunk.section_path else r.chunk.document.title,
            "text": r.chunk.text,
        }
        for r in retrieved
    ]

    # Fold the estimate tool's result (if any) into the SAME grounded
    # context/citation pipeline used for RAG chunks — one well-tested code
    # path enforcing R1-R8 uniformly, rather than a second synthesis call.
    synthetic_citations: dict[int, dict] = {}
    score_result = state.get("score_result")
    if score_result:
        ml = score_result["ml_calibration"]
        tag_n = len(context_chunks) + 1
        context_chunks.append({
            "source": "Oracle Fusion Estimation Risk Engine (ml_calibration)",
            "text": (
                f"predicted_deviation_pct={ml['predicted_deviation_pct']}, "
                f"range=[{ml['range_low_pct']},{ml['range_high_pct']}], "
                f"overrun_probability={ml['overrun_probability']}, risk_band={ml['risk_band']}, "
                f"top_drivers={ml['top_drivers']}"
            ),
        })
        synthetic_citations[tag_n] = {
            "tag": f"C{tag_n}", "chunk_id": None, "document_id": None,
            "document_title": "Oracle Fusion Estimation Risk Engine",
            "section_path": "ml_calibration", "unit_id": None, "document_class": "ml-model",
            "document_path": None, "provenance": "ml-model",
        }

    long_term_facts = [f.fact_text for f in (state.get("long_term_facts") or [])]

    prompt = build_eva_prompt(
        state["message"], context_chunks, state["caller_role"],
        state.get("rolling_summary") or "", long_term_facts,
    )
    answer_text = generate_answer(
        state["llm"], prompt["system"], prompt["user"],
        prior_turns=state.get("recent_messages"),
    )
    citations = extract_citations(answer_text, retrieved, synthetic_citations)
    injection_suspected = detect_injection_suspected(answer_text)

    return {
        "answer_text": answer_text, "citations": citations, "injection_suspected": injection_suspected,
        "agent_trail": trail_step("generate", "Answered", f"{len(citations)} citation(s)"),
    }


def restricted_node(state: EvaGraphState) -> dict:
    filters = state.get("filters") or {}
    field_label = filters.get("document_class") or "this content"
    answer_text = build_restricted_reply(state["caller_role"], field_label)
    return {
        "answer_text": answer_text, "citations": [], "injection_suspected": False,
        "agent_trail": trail_step("restricted", "Restricted", field_label),
    }


def clarify_node(state: EvaGraphState) -> dict:
    plan = state.get("plan") or {}
    # score_missing_fields (from the estimate tool, more precise) takes
    # priority over the planner's coarser missing_inputs guess.
    missing = state.get("score_missing_fields") or plan.get("missing_inputs") or []
    answer_text = build_clarify_reply(missing)
    return {
        "answer_text": answer_text, "citations": [], "injection_suspected": False,
        "agent_trail": trail_step("clarify", "Needs more input", ", ".join(missing)),
    }


def out_of_scope_node(state: EvaGraphState) -> dict:
    answer_text = build_out_of_scope_reply()
    return {
        "answer_text": answer_text, "citations": [], "injection_suspected": False,
        "agent_trail": trail_step("out_of_scope", "Out of scope", ""),
    }


def navigate_node(state: EvaGraphState) -> dict:
    filters = state.get("filters") or {}
    answer_text = build_navigate_reply(filters)
    return {
        "answer_text": answer_text, "citations": [], "injection_suspected": False,
        "agent_trail": trail_step("navigate", "Navigation", ""),
    }
