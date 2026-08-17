"""Settings — env var reads, mirrors the JS `process.env.X || default` convention
used throughout upload-server/index.js and estimator_agents.
"""
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parent.parent

# Same literal default as upload-server's auth/jwt.js DEV_INTERNAL_API_KEY /
# index.js DEV_INTERNAL_API_KEY and estimator_agents/src/api.py's fallback —
# must stay byte-identical across all three so an unconfigured local dev
# setup keeps working, and so validate_production_secrets() below can
# recognize "still the shared placeholder" the same way Node does.
DEV_INTERNAL_API_KEY = "dev-internal-key-change-me"


class Settings(BaseSettings):
    # populate_by_name lets tests construct Settings(node_env=...) directly
    # by field name, in addition to the normal NODE_ENV env-var alias.
    model_config = SettingsConfigDict(env_file=SERVICE_ROOT / ".env", extra="ignore", populate_by_name=True)

    # There is deliberately no ENVIRONMENT/ENV var introduced here — this
    # reads the SAME NODE_ENV the Node services already set, so one flag
    # governs "are we in production" across the whole stack rather than two
    # environment variables that could drift out of sync with each other.
    node_env: str = Field(default="development", validation_alias="NODE_ENV")

    # ── LLM / embedding providers ───────────────────────────────────────────
    openai_api_key: str | None = None
    openai_llm_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_ssl_insecure: bool = False

    groq_api_key: str | None = None
    groq_llm_model: str = "llama-3.1-8b-instant"

    local_embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # ── Storage ──────────────────────────────────────────────────────────────
    eva_db_path: str = "data/eva.db"
    eva_markdown_dir: str = "data/markdown_cache"
    eva_faiss_dir: str = "data/faiss_indexes"
    knowledge_hub_root: str = "../KnowledgeHub"

    # ── Server ───────────────────────────────────────────────────────────────
    eva_service_port: int = 8001

    # ── Peer services ────────────────────────────────────────────────────────
    # estimator_agents (Python/FastAPI) — called directly, not through the
    # upload-server Node proxy, since these are peer services with no CORS
    # boundary between them (see EVA_RAG_IMPLEMENTATION_PLAN.md / agents plan).
    estimator_service_url: str = "http://localhost:8000"

    # The Node gateway. Called back for /internal/estimator/scenario only,
    # which runs the same JS estimator engine the browser uses — so what-if
    # results come from one implementation rather than a Python copy of the
    # formulas. internal_api_key must match upload-server's INTERNAL_API_KEY.
    upload_server_url: str = "http://localhost:3001"
    internal_api_key: str = DEV_INTERNAL_API_KEY

    # ── Semantic cache ──────────────────────────────────────────────────────
    cache_similarity_threshold: float = 0.93
    cache_promotion_hit_count: int = 3
    cache_promotion_interval_minutes: int = 15

    # ── Long-term memory ─────────────────────────────────────────────────────
    memory_extraction_interval_minutes: int = 20
    short_term_message_limit: int = 20
    long_term_memory_limit: int = 30

    @property
    def db_path(self) -> Path:
        return (SERVICE_ROOT / self.eva_db_path).resolve()

    @property
    def markdown_dir(self) -> Path:
        return (SERVICE_ROOT / self.eva_markdown_dir).resolve()

    @property
    def faiss_dir(self) -> Path:
        return (SERVICE_ROOT / self.eva_faiss_dir).resolve()

    @property
    def kh_root(self) -> Path:
        return (SERVICE_ROOT / self.knowledge_hub_root).resolve()


def validate_production_secrets(s: "Settings") -> None:
    """Mirrors upload-server's auth/jwt.js / index.js: refuse to start in
    production with a missing or still-default internal secret, rather than
    silently running with a value that is committed in this repo's own
    source. Development is unaffected — this only triggers when NODE_ENV is
    explicitly 'production'. A standalone function (not inlined below) so
    tests can exercise every combination directly against a constructed
    Settings instance, without spawning a real process per scenario.
    """
    if s.node_env == "production" and s.internal_api_key == DEV_INTERNAL_API_KEY:
        raise RuntimeError(
            "INTERNAL_API_KEY is missing or still the insecure development default in a "
            "production environment (NODE_ENV=production). Set a real INTERNAL_API_KEY "
            "(matching the value configured for upload-server and estimator_agents) "
            "before starting this service."
        )


settings = Settings()
validate_production_secrets(settings)
