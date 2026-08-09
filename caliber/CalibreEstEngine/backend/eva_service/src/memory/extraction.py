"""Long-term memory extraction — the background job that turns finished
conversations into durable UserMemory facts. Mirrors cache/promotion.py's
shape deliberately: runs via APScheduler in main.py's lifespan, never on
the hot request path, one LLM call per session with new messages since its
own last-scanned watermark (ChatSession.last_memory_extraction_at) rather
than a call per turn.
"""
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import ChatMessage, ChatSession
from .store import write_memories

log = logging.getLogger("eva_service.memory_extraction")

_MAX_FACTS_PER_SESSION_BATCH = 10

EXTRACTION_PROMPT = """
Read this conversation transcript. Extract ONLY durable facts worth remembering
long-term about this user for FUTURE, separate conversations - stable preferences,
recurring project context, named entities they work with, their typical domain or
industry focus. Do NOT extract one-off question content, transient figures, or
anything generic/obvious.

If there is nothing durable worth remembering, output exactly: NONE

Otherwise output a JSON array of short fact strings (each one clause, at most 20
words), and nothing else. No markdown fences, no prose, no trailing text.

TRANSCRIPT
{transcript}
""".strip()


def _parse_facts(raw_text: str) -> list[str]:
    cleaned = raw_text.strip()
    if cleaned.upper().startswith("NONE"):
        return []
    cleaned = re.sub(r"```json\n?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"```\n?", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(f).strip() for f in parsed if str(f).strip()][:_MAX_FACTS_PER_SESSION_BATCH]


def extract_memories(session: Session, llm) -> int:
    """Scans ChatSessions with a client_id and messages newer than their
    own last_memory_extraction_at watermark, asks the LLM once per session
    for durable facts, writes them, and advances the watermark regardless
    of outcome (so a session with nothing durable this round isn't
    re-scanned every tick forever).
    """
    sessions_with_identity = session.execute(
        select(ChatSession).where(ChatSession.client_id.isnot(None))
    ).scalars().all()

    total_facts = 0

    for chat_session in sessions_with_identity:
        query = select(ChatMessage).where(ChatMessage.session_id == chat_session.id)
        if chat_session.last_memory_extraction_at:
            query = query.where(ChatMessage.created_at > chat_session.last_memory_extraction_at)
        new_messages = session.execute(query.order_by(ChatMessage.created_at)).scalars().all()

        if not new_messages:
            continue

        transcript = "\n".join(f"{m.role}: {m.text}" for m in new_messages)
        prompt = EXTRACTION_PROMPT.format(transcript=transcript)

        try:
            response = llm.invoke(prompt)
            facts = _parse_facts(response.content)
        except Exception as err:  # noqa: BLE001 — a failed extraction must never crash the job
            log.warning("Memory extraction failed for session %s: %s", chat_session.id, err)
            facts = []

        if facts:
            write_memories(session, chat_session.client_id, facts, source_session_id=chat_session.id)
            total_facts += len(facts)

        chat_session.last_memory_extraction_at = datetime.now(timezone.utc)

    if total_facts:
        log.info("Extracted %d long-term memory fact(s)", total_facts)
    return total_facts
