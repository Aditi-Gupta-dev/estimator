"""Embedding provider selection — follows the same OpenAI-else-Groq branch
as llm_factory, but since Groq has no embeddings API, the "else" branch is
a local sentence-transformers model instead.

Returns a (embeddings, provider_key) pair where provider_key namespaces
both the SQLite chunk_embeddings rows and the on-disk FAISS index
directory (e.g. "openai::text-embedding-3-small" or
"local::all-MiniLM-L6-v2"), so a network switch never touches or
invalidates the other space's cache.
"""
from langchain_core.embeddings import Embeddings

from ..config import Settings


class LocalSentenceTransformerEmbeddings(Embeddings):
    """Thin LangChain Embeddings adapter over sentence-transformers, used
    directly instead of langchain-community's HuggingFaceEmbeddings (which
    is deprecated/sunset) or the separate langchain-huggingface package.
    """

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self._model = SentenceTransformer(model_name)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], convert_to_numpy=True)[0].tolist()


# Memoized by provider_key — constructing OpenAIEmbeddings is cheap, but
# LocalSentenceTransformerEmbeddings loads a real model into memory, which
# must not happen on every single chat request.
_cache: dict[str, Embeddings] = {}


def get_embeddings(settings: Settings) -> tuple[Embeddings, str]:
    if settings.openai_api_key:
        model = settings.openai_embedding_model
        provider_key = f"openai::{model}"
        if provider_key not in _cache:
            from langchain_openai import OpenAIEmbeddings

            _cache[provider_key] = OpenAIEmbeddings(model=model, api_key=settings.openai_api_key)
        return _cache[provider_key], provider_key

    model = settings.local_embedding_model
    provider_key = f"local::{model}"
    if provider_key not in _cache:
        _cache[provider_key] = LocalSentenceTransformerEmbeddings(model)
    return _cache[provider_key], provider_key


def provider_key_parts(provider_key: str) -> tuple[str, str]:
    """"openai::text-embedding-3-small" -> ("openai", "text-embedding-3-small")"""
    provider, _, model = provider_key.partition("::")
    return provider, model


def sanitize_provider_key(provider_key: str) -> str:
    """Filesystem-safe directory name for the FAISS index."""
    return provider_key.replace("::", "__").replace("/", "_")
