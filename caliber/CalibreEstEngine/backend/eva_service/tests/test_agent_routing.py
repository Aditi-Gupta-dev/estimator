"""Pure unit tests for the graph's routing functions — no LLM, no DB, no
FastAPI. Fastest possible tests for the highest-value logic (7 intents).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agents.graph import route_after_retrieve, route_after_supervisor  # noqa: E402
from src.retrieval.planner import INTENT  # noqa: E402


def test_route_after_supervisor_clarify():
    assert route_after_supervisor({"intent": INTENT.CLARIFY}) == "clarify"


def test_route_after_supervisor_out_of_scope():
    assert route_after_supervisor({"intent": INTENT.OUT_OF_SCOPE}) == "out_of_scope"


def test_route_after_supervisor_navigate():
    assert route_after_supervisor({"intent": INTENT.NAVIGATE}) == "navigate"


def test_route_after_supervisor_retrieve_family_goes_to_retrieve():
    for intent in (INTENT.RETRIEVE, INTENT.ESTIMATE, INTENT.CALIBRATE, INTENT.ASSESS_RISK):
        assert route_after_supervisor({"intent": intent}) == "retrieve"


def test_route_after_retrieve_restricted():
    assert route_after_retrieve({"is_restricted": True}) == "restricted"


def test_route_after_retrieve_generate():
    assert route_after_retrieve({"is_restricted": False}) == "generate"


def test_route_after_retrieve_defaults_to_generate_when_flag_absent():
    assert route_after_retrieve({}) == "generate"
