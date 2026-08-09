"""The EVA multi-agent graph. Supervisor routes by intent; RETRIEVE/ESTIMATE/
CALIBRATE/ASSESS_RISK all go through retrieval first, CLARIFY/OUT_OF_SCOPE/
NAVIGATE short-circuit straight to a canned reply (no LLM call). No
checkpointer — see state.py's docstring.
"""
from langgraph.graph import END, START, StateGraph

from ..retrieval.planner import INTENT
from .estimate_tool import estimate_tool_node
from .nodes import (
    clarify_node,
    generate_node,
    navigate_node,
    out_of_scope_node,
    restricted_node,
    retrieve_node,
    supervisor_node,
)
from .state import EvaGraphState


def route_after_supervisor(state: EvaGraphState) -> str:
    intent = state.get("intent")
    if intent == INTENT.CLARIFY:
        return "clarify"
    if intent == INTENT.OUT_OF_SCOPE:
        return "out_of_scope"
    if intent == INTENT.NAVIGATE:
        return "navigate"
    return "retrieve"  # RETRIEVE, ESTIMATE, CALIBRATE, ASSESS_RISK all need retrieval first


def route_after_retrieve(state: EvaGraphState) -> str:
    if state.get("is_restricted"):
        return "restricted"
    intent = state.get("intent")
    plan = state.get("plan") or {}
    # wants_score_tool (Phase C) lets the planner be precise about which
    # ASSESS_RISK questions are real scoring requests vs general RAG
    # questions; until then, only ESTIMATE routes to the tool by default.
    wants_tool = plan.get("wants_score_tool", intent == INTENT.ESTIMATE)
    if intent in (INTENT.ESTIMATE, INTENT.ASSESS_RISK) and wants_tool:
        return "estimate_tool"
    return "generate"


def route_after_estimate_tool(state: EvaGraphState) -> str:
    return "generate" if state.get("score_result") is not None else "clarify"


def build_eva_graph():
    graph = StateGraph(EvaGraphState)

    graph.add_node("supervisor", supervisor_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("estimate_tool", estimate_tool_node)
    graph.add_node("generate", generate_node)
    graph.add_node("restricted", restricted_node)
    graph.add_node("clarify", clarify_node)
    graph.add_node("out_of_scope", out_of_scope_node)
    graph.add_node("navigate", navigate_node)

    graph.add_edge(START, "supervisor")
    graph.add_conditional_edges("supervisor", route_after_supervisor, {
        "retrieve": "retrieve", "clarify": "clarify",
        "out_of_scope": "out_of_scope", "navigate": "navigate",
    })
    graph.add_conditional_edges("retrieve", route_after_retrieve, {
        "restricted": "restricted", "estimate_tool": "estimate_tool", "generate": "generate",
    })
    graph.add_conditional_edges("estimate_tool", route_after_estimate_tool, {
        "generate": "generate", "clarify": "clarify",
    })
    graph.add_edge("generate", END)
    graph.add_edge("restricted", END)
    graph.add_edge("clarify", END)
    graph.add_edge("out_of_scope", END)
    graph.add_edge("navigate", END)

    return graph.compile()


_graph = None


def get_eva_graph():
    global _graph
    if _graph is None:
        _graph = build_eva_graph()
    return _graph
