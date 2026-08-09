import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.config import settings  # noqa: E402
from src.retrieval.short_term_memory import (  # noqa: E402
    SHORT_TERM_MESSAGE_LIMIT,
    build_rolling_summary,
    get_recent_messages,
)
from src.storage import db as db_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.models import ChatMessage, ChatSession  # noqa: E402


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    init_db()
    return tmp_path


def _seed_session_with_messages(session, count):
    chat_session = ChatSession(caller_role="estimator")
    session.add(chat_session)
    session.flush()
    for i in range(count):
        session.add(ChatMessage(session_id=chat_session.id, role="user" if i % 2 == 0 else "eva", text=f"message {i}"))
    session.flush()
    return chat_session.id


def test_get_recent_messages_returns_oldest_first(isolated_env):
    with session_scope() as session:
        session_id = _seed_session_with_messages(session, 5)
        messages = get_recent_messages(session, session_id, limit=20)
        assert [m.text for m in messages] == [f"message {i}" for i in range(5)]


def test_get_recent_messages_caps_at_limit(isolated_env):
    with session_scope() as session:
        session_id = _seed_session_with_messages(session, 30)
        messages = get_recent_messages(session, session_id, limit=SHORT_TERM_MESSAGE_LIMIT)
        assert len(messages) == SHORT_TERM_MESSAGE_LIMIT
        # The most recent 20 of 30, still oldest-first within that window.
        assert [m.text for m in messages] == [f"message {i}" for i in range(10, 30)]


def test_get_recent_messages_empty_for_unknown_session(isolated_env):
    with session_scope() as session:
        assert get_recent_messages(session, "does-not-exist") == []


def test_get_recent_messages_empty_for_no_session_id(isolated_env):
    with session_scope() as session:
        assert get_recent_messages(session, None) == []


def test_build_rolling_summary_empty_when_no_messages():
    assert build_rolling_summary([]) == "no prior context"


def test_build_rolling_summary_caps_turns_and_chars(isolated_env):
    with session_scope() as session:
        session_id = _seed_session_with_messages(session, 10)
        messages = get_recent_messages(session, session_id, limit=20)
        summary = build_rolling_summary(messages, max_turns=2, max_chars=1000)
        # Only the last 2 turns should appear.
        assert "message 8" in summary
        assert "message 9" in summary
        assert "message 7" not in summary
