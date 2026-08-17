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
from ..governance.audit import corpus_metrics
from ..storage.faiss_manager import get_faiss_manager
from .capabilities import Capability, denial_message, role_can
from .governance_tool import select_governance_blocks
from .estimator_context import (
    format_risk_reduction_block,
    format_scenario_block,
    select_estimator_blocks,
)
from .estimate_persistence_tool import (
    ESTIMATE_MGMT_ERROR_TEXT,
    format_estimate_mgmt_block,
    is_estimate_management_question,
)
from .scenario_tool import is_scenario_question
from .state import EvaGraphState, trail_step


def supervisor_node(state: EvaGraphState) -> dict:
    # Short-term memory (real ChatMessage history for this session) is the
    # source of truth for turn_history_summary when available; the
    # client-supplied rolling_summary is only a fallback for sessions with
    # no persisted history yet (e.g. session_id absent).
    recent_messages = state.get("recent_messages") or []
    rolling_summary = build_rolling_summary(recent_messages) if recent_messages else state.get("rolling_summary")

    # The planner has always had an active_estimate_id slot; it now receives
    # a real id whenever the user is working on an estimate, so the planner
    # can tell "my estimate" questions from hypothetical-project ones.
    estimator_context = state.get("estimator_context") or {}
    plan = plan_query(
        state["llm"], state["message"], state["caller_role"],
        state.get("unit_id"), estimator_context.get("estimateId"), rolling_summary,
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
        # Honesty guard (spec §7/§16): when nothing published matches, tell
        # generate_node the REAL corpus coverage so it says "limited
        # published coverage" instead of implying extensive documentation
        # exists. Cheap aggregate query, safe for every role — it reveals a
        # percentage, not which specific documents are being withheld.
        coverage = corpus_metrics(session)
        return {
            "candidates": [], "retrieved": [], "is_restricted": False,
            "kh_coverage_note": (
                f"{coverage['documents']['published']} of {coverage['documents']['total']} "
                f"Knowledge Hub documents are currently published "
                f"({coverage['retrievability_pct']}% of indexed content is retrievable)."
            ),
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


# Told to the model as evidence, so it explains the real reason a what-if
# could not be run instead of improvising an answer (spec §42).
SCENARIO_ERROR_TEXT = {
    "no_base_inputs": (
        "The scenario could not be run: there is no active estimate in context. Tell the user to "
        "open or run an estimate first, and do not estimate the outcome yourself."
    ),
    "unsupported_change": (
        "The scenario could not be run: the requested change falls outside the supported estimator "
        "range. Reason: {detail} Report this limit to the user; do not approximate the result."
    ),
    "service_unavailable": (
        "The scenario could not be run: the estimator scenario service is unavailable. Say so "
        "plainly and do not estimate what the result would have been."
    ),
    "extraction_failed": (
        "The scenario could not be run: the requested change could not be interpreted. Ask the user "
        "to restate it concretely; do not guess a result."
    ),
    "tool_calling_unavailable": (
        "The scenario could not be run: scenario execution is unavailable in this configuration. "
        "Say so; do not estimate the outcome."
    ),
    "invalid_change": (
        "The scenario could not be run: the requested change was not valid for the estimator. "
        "Say so; do not estimate the outcome."
    ),
}


def governance_node(state: EvaGraphState) -> dict:
    """Read-only Knowledge Hub governance diagnostics — see governance_tool.py.
    Deterministic DB inspection, no LLM call, no mutation capability."""
    blocks = select_governance_blocks(
        state.get("message", ""), state.get("caller_role"), state["session"],
    )
    if not blocks:
        return {
            "governance_blocks": [],
            "agent_trail": trail_step("governance", "No governance data used", ""),
        }
    return {
        "governance_blocks": blocks,
        "agent_trail": trail_step("governance", f"Read {len(blocks)} governance block(s)", ""),
    }


def estimator_context_node(state: EvaGraphState) -> dict:
    """Selects the smallest set of live-estimate blocks that answers the turn.

    Deterministic — no LLM call. The estimate data is already in the request
    (computed by the estimator itself), so there is nothing to extract and
    nothing to recalculate; this only decides which parts are relevant.
    """
    ctx = state.get("estimator_context")
    message = state.get("message", "")
    blocks = select_estimator_blocks(message, state.get("intent"), ctx)

    # If they asked a what-if but their role can't run scenarios, the routing
    # layer sent them here instead. Say so explicitly — answering the
    # read-only question without acknowledging the request would look like
    # the scenario had been run.
    if ctx and is_scenario_question(message) and not role_can(
        state.get("caller_role"), Capability.SCENARIO_RUN
    ):
        blocks = [{
            "title": "Scenario execution not permitted for this role",
            "text": denial_message(Capability.SCENARIO_RUN),
        }] + blocks

    if is_estimate_management_question(message) and not role_can(
        state.get("caller_role"), Capability.ESTIMATE_SAVE
    ):
        blocks = [{
            "title": "Saved-estimate management not permitted for this role",
            "text": denial_message(Capability.ESTIMATE_SAVE),
        }] + blocks

    if not blocks:
        return {
            "estimator_blocks": [],
            "agent_trail": trail_step("estimator_context", "No estimate context used", ""),
        }
    titles = ", ".join(b["title"] for b in blocks)
    return {
        "estimator_blocks": blocks,
        "agent_trail": trail_step("estimator_context", f"Read {len(blocks)} estimate block(s)", titles),
    }


def _append_synthetic(context_chunks: list, synthetic_citations: dict, source: str,
                      text: str, title: str, section_path: str, document_class: str,
                      provenance: str) -> None:
    """Appends one synthetic (non-RAG) evidence block and records its citation.

    The tag number MUST be computed at append time, not once up front —
    several synthetic blocks can now be appended in a single turn (estimator
    blocks plus a score_project result), and a precomputed offset would make
    them collide onto the same [C_n] tag.
    """
    tag_n = len(context_chunks) + 1
    context_chunks.append({"source": source, "text": text})
    synthetic_citations[tag_n] = {
        "tag": f"C{tag_n}", "chunk_id": None, "document_id": None,
        "document_title": title, "section_path": section_path, "unit_id": None,
        "document_class": document_class, "document_path": None, "provenance": provenance,
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

    # Fold tool/estimator results into the SAME grounded context/citation
    # pipeline used for RAG chunks — one well-tested code path enforcing
    # R1-R8 uniformly, rather than a second synthesis call.
    synthetic_citations: dict[int, dict] = {}

    for block in state.get("estimator_blocks") or []:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source=f"Current Estimate — {block['title']}",
            text=block["text"],
            title="Current Estimate (Calibre estimator)",
            section_path=block["title"],
            document_class="estimator",
            provenance="estimator",
        )

    for block in state.get("governance_blocks") or []:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source=f"Knowledge Hub Governance — {block['title']}",
            text=block["text"],
            title="Knowledge Hub Governance (document database)",
            section_path=block["title"],
            document_class="governance",
            provenance="governance",
        )

    # Honesty guard from retrieve_node: nothing published matched this query.
    # Told to the model as evidence so it states the real coverage instead of
    # implying the Hub is well-stocked on the topic (spec §7/§16).
    kh_coverage_note = state.get("kh_coverage_note")
    if kh_coverage_note:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="Knowledge Hub coverage (no published match for this query)",
            text=kh_coverage_note,
            title="Knowledge Hub Coverage",
            section_path="coverage",
            document_class="governance",
            provenance="governance",
        )

    # A scenario that could not be run must be explained, not silently
    # dropped — otherwise the model fills the gap with a guess.
    scenario_error = state.get("scenario_error")
    if scenario_error:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="What-if scenario (not executed)",
            text=SCENARIO_ERROR_TEXT.get(scenario_error, SCENARIO_ERROR_TEXT["service_unavailable"]).format(
                detail=state.get("scenario_error_detail") or "",
            ),
            title="What-if Scenario Unavailable",
            section_path="scenario_error",
            document_class="estimator",
            provenance="estimator",
        )

    scenario_result = state.get("scenario_result")
    if scenario_result:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="What-if scenario (executed by the Calibre estimator engine)",
            text=format_scenario_block(scenario_result),
            title="What-if Scenario Result",
            section_path="scenario",
            document_class="estimator",
            provenance="estimator",
        )

    risk_reduction = state.get("risk_reduction")
    if risk_reduction is not None:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="Risk-reduction scenarios (each executed by the Calibre estimator engine)",
            text=format_risk_reduction_block(risk_reduction),
            title="Risk-reduction Options",
            section_path="risk_reduction",
            document_class="estimator",
            provenance="estimator",
        )

    estimate_mgmt_error = state.get("estimate_mgmt_error")
    if estimate_mgmt_error:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="Saved-estimate management (not completed)",
            text=ESTIMATE_MGMT_ERROR_TEXT.get(
                estimate_mgmt_error, ESTIMATE_MGMT_ERROR_TEXT["service_unavailable"],
            ).format(detail=state.get("estimate_mgmt_error_detail") or ""),
            title="Saved-estimate Action Unavailable",
            section_path="estimate_mgmt_error",
            document_class="estimator",
            provenance="estimator",
        )

    estimate_mgmt_result = state.get("estimate_mgmt_result")
    if estimate_mgmt_result:
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="Saved-estimate management (executed by upload-server's estimate persistence layer)",
            text=format_estimate_mgmt_block(state.get("estimate_mgmt_action"), estimate_mgmt_result),
            title="Saved-estimate Action Result",
            section_path="estimate_mgmt",
            document_class="estimator",
            provenance="estimator",
        )

    score_result = state.get("score_result")
    if score_result:
        ml = score_result["ml_calibration"]
        _append_synthetic(
            context_chunks, synthetic_citations,
            source="Oracle Fusion Estimation Risk Engine (ml_calibration)",
            text=(
                f"predicted_deviation_pct={ml['predicted_deviation_pct']}, "
                f"range=[{ml['range_low_pct']},{ml['range_high_pct']}], "
                f"overrun_probability={ml['overrun_probability']}, risk_band={ml['risk_band']}, "
                f"top_drivers={ml['top_drivers']}"
            ),
            title="Oracle Fusion Estimation Risk Engine",
            section_path="ml_calibration",
            document_class="ml-model",
            provenance="ml-model",
        )

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
