"""Derives which caller roles may see a document's chunks — the source of
truth for R5 role-gating (eva-system-prompt.js), computed once at ingest
time and stored on Document.access_roles.

Ported from frontend/calibre-app/src/constants/roles.js (canonical role ids)
and eva-system-prompt.js (RESTRICTED_ROLES). Per the implementation plan:
R5/RESTRICTED_ROLES is treated as authoritative and more restrictive than
roles.js's old `eva.ratecards` permission, which that file's PERMISSIONS
matrix used to contradict by granting all five roles — since replaced by the
single shared capability map (see agents/capabilities.py and the parity test).

As of Knowledge Hub governance, this is a thin wrapper over
ingestion/sensitivity.py's policy rather than the sole source of the rule —
sensitivity.py is what a governed document's access is actually computed
from; this function exists so first-ingest bootstrap and every pre-existing
caller (candidate_selector, role_gate, tests) keep working unchanged.
"""

from .sensitivity import ALL_ROLES, sensitivity_for_document_class, roles_for_sensitivity

# Kept for backward compatibility with anything still importing this name
# directly — equivalent to `ALL_ROLES minus roles_for_sensitivity(RATE_CARD)`.
RATE_CARD_RESTRICTED_ROLES = [r for r in ALL_ROLES if r not in roles_for_sensitivity("RATE_CARD")]


def derive_access_roles(document_class: str, subdivision: str) -> list[str]:
    """First-ingest bootstrap: maps a document's class to a sensitivity level
    and returns the roles permitted at that level. `subdivision` is accepted
    for signature compatibility but not consulted, matching the pre-existing
    behaviour — access control beyond document class is a governance-time
    decision (sensitivity.py), not something inferred from a file path.
    """
    return roles_for_sensitivity(sensitivity_for_document_class(document_class))
