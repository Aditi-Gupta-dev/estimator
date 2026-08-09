import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.config import settings  # noqa: E402
from src.memory.extraction import extract_memories  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.models import ChatMessage, ChatSession, UserMemory  # noqa: E402


class _FakeResponse:
    def __init__(self, content):
        self.content = content


class FakeExtractionLLM:
    """Returns a scripted response for every .invoke() call (extraction is
    always a single string-prompt call, unlike the planner/generation
    split — no isinstance discrimination needed here)."""
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.calls = 0

    def invoke(self, prompt):
        self.calls += 1
        return _FakeResponse(self.response_text)


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    init_db()
    return tmp_path


def _seed_session(session, *, client_id, last_extracted=None):
    chat_session = ChatSession(caller_role="estimator", client_id=client_id, last_memory_extraction_at=last_extracted)
    session.add(chat_session)
    session.flush()
    session.add(ChatMessage(session_id=chat_session.id, role="user", text="I mostly work on BFSI Oracle Fusion rollouts."))
    session.add(ChatMessage(session_id=chat_session.id, role="eva", text="Noted — BFSI is a common domain here."))
    session.flush()
    return chat_session


def test_extract_memories_writes_facts_and_advances_watermark(isolated_env):
    llm = FakeExtractionLLM(json.dumps(["User's typical projects are in the BFSI industry."]))

    with session_scope() as session:
        chat_session = _seed_session(session, client_id="client-a")

        count = extract_memories(session, llm)
        assert count == 1

    with session_scope() as session:
        facts = session.query(UserMemory).filter_by(client_id="client-a").all()
        assert len(facts) == 1
        assert facts[0].fact_text == "User's typical projects are in the BFSI industry."
        assert facts[0].source_session_id == chat_session.id

        refreshed = session.get(ChatSession, chat_session.id)
        assert refreshed.last_memory_extraction_at is not None


def test_extract_memories_none_response_writes_nothing_but_advances_watermark(isolated_env):
    llm = FakeExtractionLLM("NONE")

    with session_scope() as session:
        chat_session = _seed_session(session, client_id="client-a")
        count = extract_memories(session, llm)
        assert count == 0

    with session_scope() as session:
        assert session.query(UserMemory).count() == 0
        refreshed = session.get(ChatSession, chat_session.id)
        # Advanced even with nothing found — so this session isn't
        # re-scanned every tick forever.
        assert refreshed.last_memory_extraction_at is not None


def test_extract_memories_skips_sessions_without_client_id(isolated_env):
    llm = FakeExtractionLLM(json.dumps(["some fact"]))

    with session_scope() as session:
        chat_session = ChatSession(caller_role="estimator", client_id=None)
        session.add(chat_session)
        session.flush()
        session.add(ChatMessage(session_id=chat_session.id, role="user", text="hello"))
        session.flush()

        count = extract_memories(session, llm)
        assert count == 0
        assert llm.calls == 0


def test_extract_memories_skips_sessions_with_no_new_messages_since_watermark(isolated_env):
    llm = FakeExtractionLLM(json.dumps(["some fact"]))
    future_watermark = datetime.now(timezone.utc) + timedelta(hours=1)

    with session_scope() as session:
        # last_memory_extraction_at is AFTER all seeded messages, so there's
        # nothing new to scan.
        _seed_session(session, client_id="client-a", last_extracted=future_watermark)
        count = extract_memories(session, llm)
        assert count == 0
        assert llm.calls == 0


def test_extract_memories_handles_llm_failure_gracefully(isolated_env):
    class _RaisingLLM:
        def invoke(self, prompt):
            raise RuntimeError("provider unavailable")

    with session_scope() as session:
        chat_session = _seed_session(session, client_id="client-a")
        count = extract_memories(session, _RaisingLLM())
        assert count == 0

    with session_scope() as session:
        # Watermark still advances so a permanently-broken session doesn't
        # get retried forever with no chance of success.
        refreshed = session.get(ChatSession, chat_session.id)
        assert refreshed.last_memory_extraction_at is not None
