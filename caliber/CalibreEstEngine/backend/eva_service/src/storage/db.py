"""SQLAlchemy engine/session — SQLite file, no migrations framework at this
scale (Base.metadata.create_all() on startup handles new tables; _migrate()
below handles the rare new-column-on-an-existing-table case with a plain
ALTER TABLE rather than pulling in Alembic for a handful of columns).

_migrate() iterates _COLUMN_MIGRATIONS generically, per-table. It used to be
hardcoded to only ever check/alter "chat_sessions" — which meant an entry for
any OTHER table (e.g. "documents") would silently never run: create_all()
only creates missing *tables*, never adds columns to an existing one, so a
new Document column would exist in models.py and nowhere in the real
database. Fixed here because the Knowledge Hub governance columns depend on
this actually working.
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
    # Knowledge Hub governance — additive only. No existing column is
    # touched, no row's status/access_roles changes as a side effect of
    # adding these; see _backfill_document_sensitivity for the one
    # data-filling step, which is derived to be access-decision-identical
    # to the pre-governance behaviour.
    ("documents", "sensitivity", "VARCHAR"),
    ("documents", "owner_user_id", "VARCHAR"),
    ("documents", "owner_name", "VARCHAR"),
    ("documents", "last_indexed_at", "DATETIME"),
    # Set the moment an admin explicitly changes governance fields via the
    # API. While NULL, ingestion may still bootstrap status/sensitivity from
    # a sidecar (first-ingest convenience); once set, the sidecar can never
    # again override them — see registrar.py.
    ("documents", "governance_set_at", "DATETIME"),
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
    existing_tables = set(inspector.get_table_names())
    if not existing_tables:
        return  # fresh DB — create_all() already defined the full up-to-date schema

    # Group by table so each table's columns are inspected once, not once
    # per migration entry.
    tables_touched = {t for t, _, _ in _COLUMN_MIGRATIONS if t in existing_tables}
    columns_by_table = {
        t: {c["name"] for c in inspector.get_columns(t)} for t in tables_touched
    }

    with engine.begin() as conn:
        for table, column, sql_type in _COLUMN_MIGRATIONS:
            if table not in existing_tables:
                continue  # table doesn't exist yet on this DB — create_all() will define it fresh
            if column not in columns_by_table[table]:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))
                columns_by_table[table].add(column)

    if "documents" in existing_tables:
        _backfill_document_sensitivity(engine)


def _backfill_document_sensitivity(engine) -> None:
    """One-time data fill for the new `sensitivity` column, run after the
    column migration above. Deliberately mirrors the exact rule
    access_roles.py already enforced (document_class == 'ratecard' is
    restricted, everything else is not) so this backfill changes NO access
    decision — it only names the rule that was already in effect. Idempotent:
    only touches rows where sensitivity is still NULL.
    """
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE documents SET sensitivity = 'RATE_CARD' "
            "WHERE sensitivity IS NULL AND document_class = 'ratecard'"
        ))
        conn.execute(text(
            "UPDATE documents SET sensitivity = 'INTERNAL' "
            "WHERE sensitivity IS NULL AND document_class != 'ratecard'"
        ))


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
