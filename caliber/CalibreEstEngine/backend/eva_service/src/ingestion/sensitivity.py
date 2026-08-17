"""Document sensitivity — replaces the single boolean
(document_class == 'ratecard') the app used for access control before
Knowledge Hub governance existed.

access_roles.py's derive_access_roles() becomes a thin wrapper over this
policy, so every existing caller (candidate_selector, role_gate, the
capability-parity test) keeps working unchanged — this file only NAMES the
policy that was already in effect, plus gives it three more levels to grow
into.
"""

from ..agents.capabilities import ROLE_CAPABILITIES

# 4 roles — admin, super, sme, estimator. A fifth role, senior_mgmt, existed
# historically and was removed; roles_for_sensitivity() fails closed for any
# role not in this list, same as role_can() in agents/capabilities.py.
ALL_ROLES = ["admin", "super", "sme", "estimator"]


class Sensitivity:
    INTERNAL = "INTERNAL"          # default — every role may see it
    CONFIDENTIAL = "CONFIDENTIAL"  # delivery-facing roles — currently equivalent
                                    # to INTERNAL now that senior_mgmt (the only
                                    # role this level ever excluded) is gone; kept
                                    # as a distinct level for a future role that
                                    # needs the distinction, not redesigned here.
    RESTRICTED = "RESTRICTED"      # admin + document owner's unit SME only
    RATE_CARD = "RATE_CARD"        # exactly RATE_CARD_VIEW capability holders


ALL_LEVELS = [
    Sensitivity.INTERNAL, Sensitivity.CONFIDENTIAL,
    Sensitivity.RESTRICTED, Sensitivity.RATE_CARD,
]

# RATE_CARD reproduces the exact set access_roles.py's
# RATE_CARD_RESTRICTED_ROLES excluded (currently just estimator) — verified
# against the capability map's RATE_CARD_VIEW grant in
# tests/test_capabilities_parity.py::test_rate_card_matrix_agrees_with_ingest_time_gating,
# so the two can never again disagree the way eva.ratecards once did.
_ROLES_FOR_SENSITIVITY = {
    Sensitivity.INTERNAL: list(ALL_ROLES),
    Sensitivity.CONFIDENTIAL: list(ALL_ROLES),
    Sensitivity.RESTRICTED: ["admin", "sme"],
    Sensitivity.RATE_CARD: [
        r for r in ALL_ROLES
        if "ratecard.view" in ROLE_CAPABILITIES.get(r, [])
    ],
}


def roles_for_sensitivity(sensitivity: str) -> list[str]:
    """Unknown/missing sensitivity fails closed to the most restrictive
    level — an unrecognised value must never become "visible to everyone"."""
    return list(_ROLES_FOR_SENSITIVITY.get(sensitivity, _ROLES_FOR_SENSITIVITY[Sensitivity.RESTRICTED]))


def sensitivity_for_document_class(document_class: str) -> str:
    """First-ingest bootstrap only — the same rule access_roles.py always
    used. After a document has been explicitly governed (governance_set_at
    is set), this function is never consulted again; see registrar.py.
    """
    return Sensitivity.RATE_CARD if document_class == "ratecard" else Sensitivity.INTERNAL
