"""FastAPI app — EVA RAG service.

Run with:  uvicorn src.main:app --host 0.0.0.0 --port 8001
(from backend/eva_service/, mirroring estimator_agents' run convention)
"""
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .cache.promotion import promote_cache_entries
from .config import settings
from .memory.extraction import extract_memories
from .providers.embedding_factory import get_embeddings
from .providers.llm_factory import get_llm
from .routes import chat_route, documents_route, health, ingest_route, plan_route
from .security.internal_auth import require_internal_key
from .storage.db import init_db, session_scope
from .storage.faiss_manager import get_faiss_manager

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("eva_service")


def _run_cache_promotion() -> None:
    try:
        embeddings, provider_key = get_embeddings(settings)
        faiss_manager = get_faiss_manager()
        with session_scope() as session:
            promote_cache_entries(session, embeddings, provider_key, faiss_manager, settings.cache_promotion_hit_count)
    except Exception:  # noqa: BLE001 — a failed promotion tick must never crash the service
        log.exception("Cache-promotion job failed")


def _run_memory_extraction() -> None:
    try:
        llm = get_llm(settings)
    except RuntimeError:
        return  # no LLM provider configured — nothing to extract with, skip silently
    try:
        with session_scope() as session:
            extract_memories(session, llm)
    except Exception:  # noqa: BLE001 — a failed extraction tick must never crash the service
        log.exception("Memory-extraction job failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    log.info("EVA service DB ready at %s", settings.db_path)
    if settings.openai_api_key and settings.openai_ssl_insecure:
        log.warning(
            "OPENAI_SSL_INSECURE=true — TLS certificate verification is DISABLED "
            "for the OpenAI client. This is an explicit operator choice and exposes "
            "the corporate proxy connection to MITM. Never enable this by accident."
        )

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _run_cache_promotion, "interval",
        minutes=settings.cache_promotion_interval_minutes,
        id="cache_promotion",
    )
    scheduler.add_job(
        _run_memory_extraction, "interval",
        minutes=settings.memory_extraction_interval_minutes,
        id="memory_extraction",
    )
    scheduler.start()
    log.info("Cache-promotion job scheduled every %d minutes", settings.cache_promotion_interval_minutes)
    log.info("Memory-extraction job scheduled every %d minutes", settings.memory_extraction_interval_minutes)

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(title="Calibre EVA RAG Service", version="0.1.0", lifespan=lifespan)

# Same origins estimator_agents/src/api.py trusts, plus the upload-server
# proxy (3001) which is the actual frontend-facing caller.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
# Every route below is called only by upload-server and trusts identity
# fields (callerRole/callerUserId/callerName/actorRole/actorUserId/
# actorName) from its request body — require_internal_key runs before any
# of those route handlers, so a request without the correct shared secret
# never reaches a point where those fields are trusted. health.router is
# deliberately excluded: it carries no identity-bearing data.
_internal_only = [Depends(require_internal_key)]
app.include_router(ingest_route.router, dependencies=_internal_only)
app.include_router(documents_route.router, dependencies=_internal_only)
app.include_router(plan_route.router, dependencies=_internal_only)
app.include_router(chat_route.router, dependencies=_internal_only)
