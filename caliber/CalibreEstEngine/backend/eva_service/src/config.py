"""Settings — env var reads, mirrors the JS `process.env.X || default` convention
used throughout upload-server/index.js and estimator_agents.
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVICE_ROOT / ".env", extra="ignore")

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


settings = Settings()
