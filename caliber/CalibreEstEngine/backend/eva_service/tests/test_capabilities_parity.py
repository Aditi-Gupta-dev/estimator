"""Parity guard: the Python capability mirror must match the authoritative JS map.

The JS file (frontend/calibre-app/src/constants/capabilities.js) is imported
directly by both the React app and the Node gateway. Python can't import it, so
capabilities.py mirrors it by hand — and hand-mirrored security policy is
exactly what drifts. It already did once: roles.js's PERMISSIONS granted
'eva.ratecards' to all five roles while the backend denied estimator and
senior_mgmt. This test exists so that can't happen again silently.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.agents.capabilities import (  # noqa: E402
    ROLE_CAPABILITIES,
    Capability,
    denial_message,
    role_can,
)

JS_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "calibre-app" / "src" / "constants" / "capabilities.js"
)


def _parse_js_capabilities(text: str) -> dict[str, str]:
    """CAPABILITIES = { KEY: 'value', ... } → {KEY: value}."""
    block = re.search(r"export const CAPABILITIES = \{(.*?)\n\};", text, re.S)
    assert block, "CAPABILITIES block not found in capabilities.js"
    return dict(re.findall(r"^\s*(\w+):\s*'([^']+)'", block.group(1), re.M))


def _parse_js_role_capabilities(text: str, cap_values: dict[str, str]) -> dict[str, set[str]]:
    """ROLE_CAPABILITIES = { role: [C.X, C.Y], ... } → {role: {values}}."""
    block = re.search(r"export const ROLE_CAPABILITIES = \{(.*?)\n\};", text, re.S)
    assert block, "ROLE_CAPABILITIES block not found in capabilities.js"
    body = block.group(1)
    # Strip // comments so commented-out entries never count as granted.
    body = re.sub(r"//[^\n]*", "", body)

    roles: dict[str, set[str]] = {}
    for match in re.finditer(r"(\w+):\s*\[(.*?)\]", body, re.S):
        role, entries = match.group(1), match.group(2)
        keys = re.findall(r"C\.(\w+)", entries)
        roles[role] = {cap_values[k] for k in keys}
    return roles


@pytest.fixture(scope="module")
def js_source() -> str:
    assert JS_PATH.exists(), f"authoritative capability map missing at {JS_PATH}"
    return JS_PATH.read_text(encoding="utf-8")


def test_capability_names_match(js_source):
    js_caps = _parse_js_capabilities(js_source)
    py_caps = {
        name: getattr(Capability, name)
        for name in dir(Capability)
        if not name.startswith("_")
    }
    assert js_caps == py_caps, (
        "Capability constants differ between capabilities.js and capabilities.py.\n"
        f"  only in JS: {set(js_caps) - set(py_caps)}\n"
        f"  only in PY: {set(py_caps) - set(js_caps)}"
    )


def test_role_capability_matrix_matches(js_source):
    js_caps = _parse_js_capabilities(js_source)
    js_roles = _parse_js_role_capabilities(js_source, js_caps)
    py_roles = {role: set(caps) for role, caps in ROLE_CAPABILITIES.items()}

    assert set(js_roles) == set(py_roles), "Role sets differ between JS and Python"
    for role in sorted(js_roles):
        assert js_roles[role] == py_roles[role], (
            f"Capabilities for '{role}' differ.\n"
            f"  only in JS: {js_roles[role] - py_roles[role]}\n"
            f"  only in PY: {py_roles[role] - js_roles[role]}"
        )


# ── The specific rules this consolidation must preserve ────────────────────
# Pinned explicitly so a careless edit to the matrix fails loudly here rather
# than silently widening access.

@pytest.mark.parametrize("role", ["admin", "super", "sme", "estimator"])
def test_scoring_roles_unchanged(role):
    assert role_can(role, Capability.ESTIMATE_RUN)
    assert role_can(role, Capability.SCENARIO_RUN)


def test_senior_mgmt_cannot_score_or_run_scenarios():
    assert not role_can("senior_mgmt", Capability.ESTIMATE_RUN)
    assert not role_can("senior_mgmt", Capability.SCENARIO_RUN)


@pytest.mark.parametrize("role", ["admin", "super", "sme"])
def test_rate_card_permitted_roles(role):
    assert role_can(role, Capability.RATE_CARD_VIEW)


@pytest.mark.parametrize("role", ["estimator", "senior_mgmt"])
def test_rate_card_restricted_roles(role):
    assert not role_can(role, Capability.RATE_CARD_VIEW)


def test_rate_card_matrix_agrees_with_ingest_time_gating():
    """capabilities.py and access_roles.py must not disagree about rate cards —
    one gates EVA tools, the other gates document retrieval."""
    from src.ingestion.access_roles import ALL_ROLES, RATE_CARD_RESTRICTED_ROLES

    for role in ALL_ROLES:
        permitted_by_capability = role_can(role, Capability.RATE_CARD_VIEW)
        permitted_by_documents = role not in RATE_CARD_RESTRICTED_ROLES
        assert permitted_by_capability == permitted_by_documents, (
            f"'{role}' rate-card access disagrees: capability={permitted_by_capability}, "
            f"document gate={permitted_by_documents}"
        )


def test_only_admin_manages_users():
    assert role_can("admin", Capability.USER_MANAGE)
    for role in ["super", "sme", "senior_mgmt", "estimator"]:
        assert not role_can(role, Capability.USER_MANAGE)


def test_every_role_may_use_eva():
    for role in ROLE_CAPABILITIES:
        assert role_can(role, Capability.EVA_CHAT)


def test_unknown_role_and_capability_fail_closed():
    assert not role_can("wizard", Capability.ESTIMATE_RUN)
    assert not role_can(None, Capability.ESTIMATE_RUN)
    assert not role_can("admin", "totally.made.up")


def test_denial_messages_offer_an_alternative():
    for cap in [Capability.SCENARIO_RUN, Capability.RATE_CARD_VIEW]:
        msg = denial_message(cap)
        assert len(msg) > 40, "denial copy should explain, not just refuse"
    # Rate-card denial must forbid derivation, not just direct disclosure.
    assert "derive" in denial_message(Capability.RATE_CARD_VIEW).lower()
