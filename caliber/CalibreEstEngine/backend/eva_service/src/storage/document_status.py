"""Document lifecycle — replaces the implicit two-value status
('draft'|'published') that predates Knowledge Hub governance.

Only PUBLISHED documents are retrievable. That rule needs no new code in
retrieval/candidate_selector.py: it already filters `Document.status ==
"published"`, so DRAFT/IN_REVIEW/ARCHIVED/REJECTED are all non-retrievable
for free, exactly like DRAFT always was.
"""


class DocumentStatus:
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    PUBLISHED = "published"
    ARCHIVED = "archived"
    REJECTED = "rejected"


ALL_STATUSES = [
    DocumentStatus.DRAFT, DocumentStatus.IN_REVIEW, DocumentStatus.PUBLISHED,
    DocumentStatus.ARCHIVED, DocumentStatus.REJECTED,
]

RETRIEVABLE_STATUSES = {DocumentStatus.PUBLISHED}

# Explicit transition table rather than "any status to any status" — governs
# both the admin API (PATCH /internal/documents/{id}) and the bulk-review
# workflow. Terminal states (ARCHIVED, REJECTED) can only return to DRAFT for
# rework, never straight back to PUBLISHED, so a re-publish always passes
# back through review.
_ALLOWED_TRANSITIONS = {
    DocumentStatus.DRAFT: {DocumentStatus.IN_REVIEW, DocumentStatus.PUBLISHED, DocumentStatus.REJECTED},
    DocumentStatus.IN_REVIEW: {DocumentStatus.PUBLISHED, DocumentStatus.REJECTED, DocumentStatus.DRAFT},
    DocumentStatus.PUBLISHED: {DocumentStatus.ARCHIVED, DocumentStatus.DRAFT},
    DocumentStatus.ARCHIVED: {DocumentStatus.DRAFT},
    DocumentStatus.REJECTED: {DocumentStatus.DRAFT},
}


def can_transition(current: str, target: str) -> bool:
    if target not in ALL_STATUSES:
        return False
    if current == target:
        return True  # setting the same status is a no-op, not an error
    return target in _ALLOWED_TRANSITIONS.get(current, set())


def is_retrievable(status: str) -> bool:
    return status in RETRIEVABLE_STATUSES
