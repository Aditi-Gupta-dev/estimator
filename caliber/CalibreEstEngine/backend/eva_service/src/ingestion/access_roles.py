"""Derives which caller roles may see a document's chunks — the source of
truth for R5 role-gating (eva-system-prompt.js), computed once at ingest
time and stored on Document.access_roles.

Ported from frontend/calibre-app/src/constants/roles.js (canonical role ids)
and eva-system-prompt.js (RESTRICTED_ROLES). Per the implementation plan:
R5/RESTRICTED_ROLES is treated as authoritative and more restrictive than
roles.js's `eva.ratecards` permission, which that file's own PERMISSIONS
matrix contradicts by granting all five roles — `eva.ratecards` is
reinterpreted as "may use EVA at all," not "may see rate figures."
"""

ALL_ROLES = ["admin", "super", "sme", "senior_mgmt", "estimator"]

# eva-system-prompt.js RESTRICTED_ROLES, normalized to the canonical
# `senior_mgmt` id (the JS source had a `senior_management` typo, fixed
# alongside this port).
RATE_CARD_RESTRICTED_ROLES = ["estimator", "senior_mgmt"]


def derive_access_roles(document_class: str, subdivision: str) -> list[str]:
    """Rate cards (document_class == 'ratecard') are never exposed to the
    Estimator or Senior Management personas (R5). Every other document
    class/subdivision is visible to all five roles — access control beyond
    that is a future admin-configurable extension, not inferred here.
    """
    if document_class == "ratecard":
        return [r for r in ALL_ROLES if r not in RATE_CARD_RESTRICTED_ROLES]
    return list(ALL_ROLES)
