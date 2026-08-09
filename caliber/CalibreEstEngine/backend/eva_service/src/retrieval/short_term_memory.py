"""Short-term memory — the current conversation, capped at 20 messages.

Replaces the old client-only "last 4 messages, 400 chars" rolling summary
(useEVA.js's buildRollingSummary) with the real ChatMessage history that
chat_route.py already persists every turn — durable across page reloads as
long as the frontend keeps sending the same session_id (see useEVA.js's
localStorage-persisted sessionId), and fed to the LLM as real conversational
turns rather than a lossy flattened string.
"""
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..storage.models import ChatMessage

SHORT_TERM_MESSAGE_LIMIT = 20


def get_recent_messages(session: Session, session_id: str, limit: int = SHORT_TERM_MESSAGE_LIMIT) -> list[ChatMessage]:
    """Last `limit` ChatMessage rows for this session, oldest first (the
    order a prompt needs them in).

    Ordered by SQLite's implicit rowid, not created_at: two messages
    written in the same request (or in a fast test loop) can land on the
    exact same microsecond timestamp, and ORDER BY on a tied column has no
    defined tie-break in SQLite — rowid always reflects true insertion
    order regardless. This service is SQLite-only by design (see db.py),
    so this isn't a portability concern.
    """
    if not session_id:
        return []
    rows = session.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(text("chat_messages.rowid DESC"))
        .limit(limit)
    ).scalars().all()
    return list(reversed(rows))


def build_rolling_summary(messages: list[ChatMessage], max_turns: int = 6, max_chars: int = 400) -> str:
    """Compact single-string summary for the planner prompt's
    turn_history_summary slot (a template placeholder, not a message list —
    generate_node uses the full `messages` window directly instead, see
    agents/nodes.py).
    """
    if not messages:
        return "no prior context"
    recent = messages[-max_turns:]
    parts = [f"{'User' if m.role == 'user' else 'EVA'}: {m.text}" for m in recent]
    summary = " | ".join(parts)
    return summary[:max_chars]
