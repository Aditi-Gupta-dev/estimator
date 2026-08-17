"""Capability model — Python mirror of the shared JS capability map.

The authoritative definition lives in
    frontend/calibre-app/src/constants/capabilities.js
which the React app and the Node gateway both import directly. Python cannot
import JS, so this file mirrors it — and tests/test_capabilities_parity.py
parses the JS and asserts the two matrices are identical, so they cannot
silently diverge. That drift is not hypothetical: before this consolidation,
roles.js's PERMISSIONS granted rate-card access to all five roles while the
backend correctly denied it to estimator and senior_mgmt.

EVA uses this to decide which TOOLS a turn may reach. It is defence in depth,
not the only defence: upload-server re-checks the same capability on
/internal/estimator/scenario, so even a jailbroken model cannot execute a
scenario for a role that isn't permitted one.
"""


class Capability:
    ESTIMATE_RUN = "estimate.run"
    ESTIMATE_VIEW_DETAIL = "estimate.view.detail"
    SCENARIO_RUN = "scenario.run"
    RATE_CARD_VIEW = "ratecard.view"
    KNOWLEDGE_VIEW = "knowledge.view"
    KNOWLEDGE_UPLOAD = "knowledge.upload"
    KNOWLEDGE_REVIEW = "knowledge.review"
    EXECUTIVE_ANALYTICS_VIEW = "analytics.executive"
    PLATFORM_ANALYTICS_VIEW = "analytics.platform"
    TECHNICAL_REVIEW = "review.technical"
    USER_MANAGE = "users.manage"
    EVA_CHAT = "eva.chat"


ROLE_CAPABILITIES: dict[str, list[str]] = {
    "admin": [
        Capability.ESTIMATE_RUN, Capability.ESTIMATE_VIEW_DETAIL, Capability.SCENARIO_RUN,
        Capability.RATE_CARD_VIEW,
        Capability.KNOWLEDGE_VIEW, Capability.KNOWLEDGE_UPLOAD, Capability.KNOWLEDGE_REVIEW,
        Capability.EXECUTIVE_ANALYTICS_VIEW, Capability.PLATFORM_ANALYTICS_VIEW,
        Capability.TECHNICAL_REVIEW,
        Capability.USER_MANAGE,
        Capability.EVA_CHAT,
    ],
    "super": [
        Capability.ESTIMATE_RUN, Capability.ESTIMATE_VIEW_DETAIL, Capability.SCENARIO_RUN,
        Capability.RATE_CARD_VIEW,
        Capability.KNOWLEDGE_VIEW, Capability.KNOWLEDGE_UPLOAD,
        Capability.EXECUTIVE_ANALYTICS_VIEW,
        Capability.EVA_CHAT,
    ],
    "sme": [
        Capability.ESTIMATE_RUN, Capability.ESTIMATE_VIEW_DETAIL, Capability.SCENARIO_RUN,
        Capability.RATE_CARD_VIEW,
        Capability.KNOWLEDGE_VIEW, Capability.KNOWLEDGE_UPLOAD, Capability.KNOWLEDGE_REVIEW,
        Capability.TECHNICAL_REVIEW,
        Capability.EVA_CHAT,
    ],
    "senior_mgmt": [
        Capability.KNOWLEDGE_VIEW, Capability.KNOWLEDGE_UPLOAD,
        Capability.EXECUTIVE_ANALYTICS_VIEW,
        Capability.EVA_CHAT,
    ],
    "estimator": [
        Capability.ESTIMATE_RUN, Capability.ESTIMATE_VIEW_DETAIL, Capability.SCENARIO_RUN,
        Capability.KNOWLEDGE_VIEW, Capability.KNOWLEDGE_UPLOAD,
        Capability.EVA_CHAT,
    ],
}


def role_can(role_id: str | None, capability: str) -> bool:
    """Unknown role or capability → False (fail closed)."""
    return capability in ROLE_CAPABILITIES.get(role_id or "", [])


# What EVA says instead of a bare refusal — each names what the role CAN still
# do, so a restricted turn stays useful (spec §24).
CAPABILITY_DENIAL_MESSAGE = {
    Capability.SCENARIO_RUN: (
        "Scenario execution is not available for this role. Explain that plainly, then offer what IS "
        "available: estimate health, cost drivers, risk drivers, and historical benchmarking. "
        "Do NOT estimate what a scenario would have produced."
    ),
    Capability.RATE_CARD_VIEW: (
        "Rate-card figures are restricted for this role. Do not state, paraphrase, derive, or "
        "approximate any day rate, blended rate, or margin — including by arithmetic from other "
        "numbers. Offer effort, FTE, risk and cost-driver analysis instead."
    ),
    Capability.ESTIMATE_RUN: (
        "Running a new estimate is not available for this role. Offer analysis of an existing "
        "estimate's outcome, risk and benchmarks instead."
    ),
    Capability.ESTIMATE_VIEW_DETAIL: (
        "The detailed component-level estimator view is not available for this role. Summarise at "
        "the executive level: effort, cost, FTE, risk band and planning range."
    ),
}


def denial_message(capability: str) -> str:
    return CAPABILITY_DENIAL_MESSAGE.get(
        capability, "That action is not available for this role."
    )
