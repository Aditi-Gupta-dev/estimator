import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.config import settings  # noqa: E402
from src.memory.store import get_long_term_memory, write_memories  # noqa: E402
from src.storage import db as db_module  # noqa: E402
from src.storage.db import init_db, session_scope  # noqa: E402
from src.storage.models import UserMemory  # noqa: E402


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "eva_db_path", str(tmp_path / "eva.db"))
    monkeypatch.setattr(db_module, "_engine", None)
    monkeypatch.setattr(db_module, "_SessionLocal", None)
    init_db()
    return tmp_path


def test_write_then_read_round_trip(isolated_env):
    with session_scope() as session:
        write_memories(session, "client-a", ["Prefers BFSI projects", "Works with the ESU team"])

    with session_scope() as session:
        facts = get_long_term_memory(session, "client-a")
        assert {f.fact_text for f in facts} == {"Prefers BFSI projects", "Works with the ESU team"}


def test_client_isolation(isolated_env):
    with session_scope() as session:
        write_memories(session, "client-a", ["Fact about A"])
        write_memories(session, "client-b", ["Fact about B"])

    with session_scope() as session:
        a_facts = [f.fact_text for f in get_long_term_memory(session, "client-a")]
        b_facts = [f.fact_text for f in get_long_term_memory(session, "client-b")]
        assert a_facts == ["Fact about A"]
        assert b_facts == ["Fact about B"]


def test_get_long_term_memory_empty_without_client_id(isolated_env):
    with session_scope() as session:
        write_memories(session, "client-a", ["Fact about A"])

    with session_scope() as session:
        assert get_long_term_memory(session, None) == []


def test_write_memories_skips_blank_facts(isolated_env):
    with session_scope() as session:
        written = write_memories(session, "client-a", ["Real fact", "  ", "", "\n"])
        assert len(written) == 1
        assert written[0].fact_text == "Real fact"


def test_get_long_term_memory_increments_use_count(isolated_env):
    with session_scope() as session:
        write_memories(session, "client-a", ["Fact"])

    with session_scope() as session:
        facts = get_long_term_memory(session, "client-a")
        assert facts[0].use_count == 1

    with session_scope() as session:
        facts = get_long_term_memory(session, "client-a")
        assert facts[0].use_count == 2


def test_get_long_term_memory_respects_limit(isolated_env):
    with session_scope() as session:
        write_memories(session, "client-a", [f"Fact {i}" for i in range(5)])

    with session_scope() as session:
        facts = get_long_term_memory(session, "client-a", limit=2)
        assert len(facts) == 2
