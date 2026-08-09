import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.retrieval.planner import (  # noqa: E402
    INTENT,
    UNIT_IDS,
    build_fallback_plan,
    validate_planner_response,
)


def test_unit_ids_include_the_previously_missing_bus():
    # The JS source (eva-retrieval-planner.js) was missing these three real
    # BU folders — fixed alongside this port.
    for unit in ("cyber", "ai", "datacloud"):
        assert unit in UNIT_IDS


def test_fallback_plan_is_schema_valid_for_each_unit():
    for unit in UNIT_IDS:
        plan = build_fallback_plan("What is the standard rate card guideline?", "estimator", unit)
        result = validate_planner_response(plan)
        assert result.valid, result.errors


def test_fallback_plan_estimation_keywords_trigger_clarify():
    plan = build_fallback_plan("Can you estimate the effort for this scope?", "estimator", "esu")
    assert plan["intent"] == INTENT.CLARIFY
    assert plan["needs_retrieval"] is False
    assert len(plan["missing_inputs"]) > 0


def test_fallback_plan_calibrate_keywords():
    # Deliberately avoids estimation keywords ("estimate", "effort", etc.) so
    # the CLARIFY/missing_inputs branch doesn't take precedence — matches the
    # ported JS logic's precedence: missing_inputs wins over calibrate detection.
    plan = build_fallback_plan("Compare our delivery numbers against the baseline actuals", "sme", "adm")
    assert plan["intent"] == INTENT.CALIBRATE
    assert plan["requires_actuals"] is True


def test_fallback_plan_template_subdivision_routing():
    plan = build_fallback_plan("Show me the Oracle Fusion estimation template", "sme", "esu")
    assert plan["filters"]["subdivision"] == "templates"


def test_fallback_plan_default_subdivision_is_data():
    plan = build_fallback_plan("What is our standard case study for cloud migration?", "sme", "esu")
    assert plan["filters"]["subdivision"] == "data"


def test_validate_rejects_invalid_intent():
    result = validate_planner_response({"intent": "NOT_A_REAL_INTENT"})
    assert not result.valid
    assert any("Invalid intent" in e for e in result.errors)


def test_validate_rejects_missing_inputs_without_clarify_intent():
    plan = {
        "intent": INTENT.RETRIEVE,
        "needs_retrieval": True,
        "filters": {},
        "queries": ["q"],
        "k": 5,
        "requires_actuals": False,
        "missing_inputs": ["scope_modules"],
        "reasoning": "test",
    }
    result = validate_planner_response(plan)
    assert not result.valid
    assert any("CLARIFY" in e for e in result.errors)


def test_validate_accepts_missing_wants_score_tool():
    plan = {
        "intent": INTENT.RETRIEVE, "needs_retrieval": True, "filters": {},
        "queries": ["q"], "k": 5, "requires_actuals": False,
        "missing_inputs": [], "reasoning": "test",
    }
    assert validate_planner_response(plan).valid


def test_validate_rejects_non_bool_wants_score_tool():
    plan = {
        "intent": INTENT.RETRIEVE, "needs_retrieval": True, "filters": {},
        "queries": ["q"], "k": 5, "requires_actuals": False,
        "missing_inputs": [], "wants_score_tool": "yes", "reasoning": "test",
    }
    result = validate_planner_response(plan)
    assert not result.valid
    assert any("wants_score_tool" in e for e in result.errors)


def test_fallback_plan_wants_score_tool_true_for_numeric_scoring_request():
    # Deliberately avoids _ESTIMATION_KEYWORDS ("size", "scope", etc.) so the
    # CLARIFY/missing_inputs branch doesn't take precedence over ASSESS_RISK.
    plan = build_fallback_plan(
        "Score the risk for a project with complexity High, 4 modules, 6 integrations, and 12 entities.",
        "estimator", "esu",
    )
    assert plan["intent"] == INTENT.ASSESS_RISK
    assert plan["wants_score_tool"] is True


def test_fallback_plan_wants_score_tool_false_without_numbers():
    plan = build_fallback_plan("What's the general risk profile of ERP migrations?", "estimator", "esu")
    assert plan["intent"] == INTENT.ASSESS_RISK
    assert plan["wants_score_tool"] is False


def test_fallback_plan_wants_score_tool_false_for_non_estimate_assess_intent():
    plan = build_fallback_plan(
        "Compare 5 modules and 3 integrations against last quarter's baseline of 100 projects.",
        "sme", "adm",
    )
    assert plan["intent"] == INTENT.CALIBRATE
    assert plan["wants_score_tool"] is False
