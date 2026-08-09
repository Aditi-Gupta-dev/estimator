"""SQLAlchemy engine/session — SQLite file, no migrations framework at this
scale (Base.metadata.create_all() on startup handles new tables; _migrate()
below handles the rare new-column-on-an-existing-table case with a plain
ALTER TABLE rather than pulling in Alembic for a two-column change).
"""
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from ..config import settings
from .models import Base

_engine = None
_SessionLocal: sessionmaker | None = None

# (table, column, SQL type) — columns added to a pre-existing table after
# its initial release. create_all() only creates missing *tables*, so
# these need an explicit ALTER TABLE on databases created before this list
# had an entry. Safe to re-run: each column is only added if missing.
_COLUMN_MIGRATIONS = [
    ("chat_sessions", "client_id", "VARCHAR"),
    ("chat_sessions", "last_memory_extraction_at", "DATETIME"),
]


def get_engine():
    global _engine
    if _engine is None:
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{settings.db_path}",
            connect_args={"check_same_thread": False},
        )
    return _engine


def _migrate(engine) -> None:
    inspector = inspect(engine)
    if "chat_sessions" not in inspector.get_table_names():
        return  # fresh DB — create_all() will define the full up-to-date schema
    existing_columns = {c["name"] for c in inspector.get_columns("chat_sessions")}
    with engine.begin() as conn:
        for table, column, sql_type in _COLUMN_MIGRATIONS:
            if table == "chat_sessions" and column not in existing_columns:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    _migrate(engine)


def get_sessionmaker() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal


@contextmanager
def session_scope() -> Session:
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
