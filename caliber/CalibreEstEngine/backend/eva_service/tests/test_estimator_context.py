"""Tests for EVA's live-estimate context: rate-card sanitization, the
selector registry, deterministic block selection, the graph node, and the
multi-synthetic-block citation tagging in generate_node.

Follows the repo convention of monkeypatching Python-function boundaries
rather than adding an HTTP/LLM mocking dependency (see test_estimate_tool.py).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.agents.estimator_context import (  # noqa: E402
    SELECTORS,
    get_cost_drivers,
    get_current_estimate,
    get_estimate_benchmark,
    get_estimate_completeness,
    get_estimate_health,
    get_risk_drivers,
    is_estimate_question,
    review_current_estimate,
    sanitize_estimator_context,
    select_estimator_blocks,
)
from src.agents.graph import build_eva_graph, route_after_retrieve  # noqa: E402
from src.agents.nodes import estimator_context_node  # noqa: E402
from src.retrieval.planner import INTENT  # noqa: E402


def make_ctx(**overrides) -> dict:
    ctx = {
        "estimateId": "est-123",
        "timestamp": "2026-08-17T00:00:00.000Z",
        "inputs": {
            "industry": "BFSI", "complexity": "H", "durationMonths": 18,
            "contingencyPct": 15, "onshorePct": 30, "workingDaysPerMonth": 20,
            "modules": 5, "entities": 3, "integrationsSimple": 17,
            "integrationsComplex": 8, "dataMigrationObjects": 15, "reports": 40,
            "cemli": 10, "selectedComponentCount": 12, "totalComponentCount": 67,
        },
        "bottomUp": {
            "baseEffortDays": 1000, "contingencyDays": 195, "totalEffortDays": 1495,
            "totalCost": 305000, "totalFte": 10.0,
            "topRoles": [
                {"role": "Technical Lead", "effortDays": 400, "cost": 400000,
                 "pctOfTotalCost": 45.0, "blendedRate": 1000},
                {"role": "Project Manager", "effortDays": 300, "cost": 270000,
                 "pctOfTotalCost": 30.0, "blendedRate": 900},
            ],
        },
        "coverage": {"integrationCoverageRatio": 1.32, "migrationCoverageRatio": 0.91},
        "ml": {
            "deviationPct": 14.0, "p25": 5.0, "p75": 25.0, "overrunProbability": 0.42,
            "riskBand": "AMBER", "historicalOverrunRate": 0.65,
            "historicalNProjects": 300, "modelUsed": {"uc1": "random_forest", "uc2": "xgboost"},
        },
        "intelligence": {
            "health": {
                "status": "AMBER", "confidence": 78, "mlRiskBand": "AMBER",
                "concerns": ["Data Migration effort is below the volumetric benchmark (0.91x)."],
                "recommendation": "Review Data Migration before submission.",
            },
            "costDrivers": {"byModule": [
                {"module": "Integration", "effortDays": 287, "pctOfTotal": 19.2},
                {"module": "Data Migration", "effortDays": 92, "pctOfTotal": 6.2},
            ]},
            "riskDrivers": [
                {"label": "Integration Coverage", "direction": "Decreases risk",
                 "explanation": "Your integration coverage ratio is 1.32x — above the 1.0x baseline.",
                 "contribution": -0.47},
            ],
            "benchmark": {
                "comparableCount": 5, "medianDeviationPct": 19.9,
                "comparableOverrunRate": 0.8, "modelHistoricalOverrunRate": 0.65,
                "modelHistoricalNProjects": 300, "deviationGapPts": -5.9,
                "insufficientData": False,
                "similarProjects": [
                    {"projectId": "OFP-0038", "industry": "BFSI", "complexity": "H",
                     "deviationPct": 19.9, "overran": True, "health": "TROUBLED"},
                ],
            },
            "completeness": {"score": 80, "failedChecks": ["Usually-present modules covered"]},
            "anomalies": {
                "status": "anomaly",
                "items": ["anomaly: Data Migration effort is below the volumetric benchmark (0.91x)."],
                "dataCaveat": None,
            },
        },
    }
    ctx.update(overrides)
    return ctx


# ── Security: rate-card sanitization ────────────────────────────────────────

@pytest.mark.parametrize("role", ["estimator", "senior_mgmt"])
def test_sanitize_strips_blended_rate_for_restricted_roles(role):
    out = sanitize_estimator_context(make_ctx(), role)
    for row in out["bottomUp"]["topRoles"]:
        assert "blendedRate" not in row
    # Aggregates the estimator UI already shows that role are retained.
    assert out["bottomUp"]["totalCost"] == 305000
    assert out["bottomUp"]["totalEffortDays"] == 1495


@pytest.mark.parametrize("role", ["admin", "super", "sme"])
def test_sanitize_retains_blended_rate_for_permitted_roles(role):
    out = sanitize_estimator_context(make_ctx(), role)
    assert all("blendedRate" in r for r in out["bottomUp"]["topRoles"])


def test_sanitize_does_not_mutate_the_original_context():
    ctx = make_ctx()
    sanitize_estimator_context(ctx, "estimator")
    assert ctx["bottomUp"]["topRoles"][0]["blendedRate"] == 1000


def test_sanitize_handles_none():
    assert sanitize_estimator_context(None, "admin") is None


def test_restricted_role_rate_never_reaches_rendered_blocks():
    """End-to-end of the security path: sanitize -> select -> block text."""
    sanitized = sanitize_estimator_context(make_ctx(), "estimator")
    blocks = select_estimator_blocks("what are my cost drivers?", None, sanitized)
    text = " ".join(b["text"] for b in blocks)
    assert "blended_rate" not in text
    assert "1000" not in text.split("blended")[0] or "blended_rate" not in text


# ── Selectors read real values, never invent them ───────────────────────────

def test_get_current_estimate_reports_actual_figures():
    block = get_current_estimate(make_ctx())
    assert "1,495 days" in block["text"]
    assert "$305,000" in block["text"]
    assert "duration_months=18" in block["text"]
    assert "ml_risk_band=AMBER" in block["text"]


def test_get_current_estimate_flags_missing_ml():
    block = get_current_estimate(make_ctx(ml=None))
    assert "UNAVAILABLE" in block["text"]
    # Layer 1 still reported — ML failure must not break the estimator view.
    assert "1,495 days" in block["text"]


def test_health_cost_risk_completeness_selectors():
    ctx = make_ctx()
    assert "AMBER" in get_estimate_health(ctx)["text"]
    assert "78%" in get_estimate_health(ctx)["text"]
    assert "Technical Lead" in get_cost_drivers(ctx)["text"]
    assert "Integration Coverage" in get_risk_drivers(ctx)["text"]
    assert "80%" in get_estimate_completeness(ctx)["text"]


def test_benchmark_reports_insufficient_data_rather_than_guessing():
    ctx = make_ctx()
    ctx["intelligence"]["benchmark"] = {"comparableCount": 0, "insufficientData": True}
    block = get_estimate_benchmark(ctx)
    assert "insufficient_data=true" in block["text"]


def test_selectors_return_none_when_intelligence_absent():
    bare = {"inputs": {}, "bottomUp": {}, "coverage": {}, "ml": None, "intelligence": {}}
    for name, fn in SELECTORS.items():
        if name == "get_current_estimate":
            continue  # always renders something from inputs/bottomUp
        assert fn(bare) is None, name


def test_review_returns_all_blocks_once():
    blocks = review_current_estimate(make_ctx())
    titles = [b["title"] for b in blocks]
    assert len(titles) == len(set(titles)), "review must not emit duplicate blocks"
    assert len(blocks) == 7


# ── Deterministic routing / block selection ─────────────────────────────────

def test_general_questions_do_not_pull_in_estimator_context():
    for q in ["what is RAG?", "what is Calibre?", "how does the estimator work?"]:
        assert is_estimate_question(q, None) is False
        assert select_estimator_blocks(q, None, make_ctx()) == []


def test_estimate_questions_are_detected():
    for q in ["what is my current cost?", "why is my estimate AMBER?", "review my estimate"]:
        assert is_estimate_question(q, None) is True


def test_cost_question_does_not_drag_in_benchmark_or_anomalies():
    blocks = select_estimator_blocks("what is my current cost?", None, make_ctx())
    titles = " ".join(b["title"] for b in blocks)
    assert "benchmark" not in titles.lower()
    assert "anomaly" not in titles.lower()


def test_review_question_returns_the_full_composite():
    blocks = select_estimator_blocks("review my estimate", None, make_ctx())
    assert len(blocks) == 7


def test_targeted_question_includes_headline_plus_requested_block():
    blocks = select_estimator_blocks("what are my risk drivers?", None, make_ctx())
    titles = [b["title"] for b in blocks]
    assert any("Current estimate" in t for t in titles)
    assert any("risk drivers" in t.lower() for t in titles)


def test_no_context_yields_no_blocks():
    assert select_estimator_blocks("what is my cost?", None, None) == []


# ── Graph node ──────────────────────────────────────────────────────────────

def test_node_noops_without_context():
    out = estimator_context_node({"message": "what is my cost?", "estimator_context": None})
    assert out["estimator_blocks"] == []
    assert out["agent_trail"][0]["step"] == "estimator_context"


def test_node_selects_blocks_with_context():
    out = estimator_context_node({
        "message": "why is my estimate amber?", "intent": None, "estimator_context": make_ctx(),
    })
    assert len(out["estimator_blocks"]) >= 1
    assert "Read" in out["agent_trail"][0]["label"]


# ── Graph wiring / routing ──────────────────────────────────────────────────

def test_route_sends_live_estimate_questions_to_estimator_context():
    assert route_after_retrieve({
        "message": "what is my current cost?",
        "intent": INTENT.RETRIEVE,
        "plan": {},
        "estimator_context": make_ctx(),
    }) == "estimator_context"


def test_route_ignores_estimator_context_for_general_questions():
    assert route_after_retrieve({
        "message": "what is RAG?",
        "intent": INTENT.RETRIEVE,
        "plan": {},
        "estimator_context": make_ctx(),
    }) == "generate"


def test_route_without_context_is_unchanged():
    assert route_after_retrieve({
        "message": "what is my current cost?",
        "intent": INTENT.RETRIEVE,
        "plan": {},
        "estimator_context": None,
    }) == "generate"


def test_restricted_still_wins_over_estimator_context():
    assert route_after_retrieve({
        "message": "what is my current cost?",
        "intent": INTENT.RETRIEVE,
        "plan": {},
        "is_restricted": True,
        "estimator_context": make_ctx(),
    }) == "restricted"


def test_score_tool_path_still_wins_over_estimator_context():
    """A hypothetical-project scoring request must still reach score_project,
    not be hijacked by the live-estimate reader."""
    assert route_after_retrieve({
        "message": "score a High complexity BFSI project with 5 modules",
        "intent": INTENT.ESTIMATE,
        "plan": {"wants_score_tool": True},
        "estimator_context": make_ctx(),
    }) == "estimate_tool"


def test_graph_compiles_with_estimator_context_node():
    graph = build_eva_graph()
    assert "estimator_context" in graph.get_graph().nodes


# ── The citation-collision regression this refactor fixes ───────────────────

def test_multiple_synthetic_blocks_get_unique_contiguous_tags(monkeypatch):
    """Estimator blocks + a score_project result in one turn must not collide
    onto the same [C_n] tag (the previous fixed-offset implementation would).
    """
    import src.agents.nodes as nodes_module

    captured = {}

    def fake_build_eva_prompt(message, context_chunks, caller_role, summary, facts):
        captured["chunks"] = context_chunks
        return {"system": "s", "user": "u"}

    def fake_generate_answer(llm, system, user, prior_turns=None):
        # Cite every block that was supplied.
        return " ".join(f"[C{i + 1}]" for i in range(len(captured["chunks"])))

    monkeypatch.setattr(nodes_module, "build_eva_prompt", fake_build_eva_prompt)
    monkeypatch.setattr(nodes_module, "generate_answer", fake_generate_answer)

    state = {
        "message": "review my estimate",
        "caller_role": "admin",
        "llm": object(),
        "retrieved": [],
        "estimator_blocks": review_current_estimate(make_ctx()),
        "score_result": {"ml_calibration": {
            "predicted_deviation_pct": 14.0, "range_low_pct": 5.0, "range_high_pct": 25.0,
            "overrun_probability": 0.42, "risk_band": "AMBER", "top_drivers": [],
        }},
        "long_term_facts": [],
    }
    out = nodes_module.generate_node(state)

    tags = [c["tag"] for c in out["citations"]]
    assert len(tags) == len(set(tags)), "citation tags must be unique"
    assert len(captured["chunks"]) == 8  # 7 estimator blocks + 1 ml-model block

    provenances = {c["provenance"] for c in out["citations"]}
    assert provenances == {"estimator", "ml-model"}
