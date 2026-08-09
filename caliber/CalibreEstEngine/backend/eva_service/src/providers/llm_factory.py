"""LLM provider selection: OpenAI (corporate) if a key is present, else Groq
(home network). Never silently insecure — verify=False is only reachable
behind the explicit OPENAI_SSL_INSECURE flag, and is logged loudly whenever
it's active (see main.py's startup hook for the one-time loud warning; this
module logs again at the point of construction so it can never be missed).
"""
import logging

import httpx
from langchain_core.language_models.chat_models import BaseChatModel

from ..config import Settings

log = logging.getLogger("eva_service.llm_factory")


def get_llm(settings: Settings) -> BaseChatModel:
    if settings.openai_api_key:
        from langchain_openai import ChatOpenAI

        if settings.openai_ssl_insecure:
            log.warning(
                "OPENAI_SSL_INSECURE=true — TLS certificate verification is DISABLED "
                "for the OpenAI client. This exposes the corporate proxy connection to "
                "MITM. This is an explicit operator choice, not a default."
            )
            http_client = httpx.Client(verify=False)
            return ChatOpenAI(
                model=settings.openai_llm_model,
                api_key=settings.openai_api_key,
                http_client=http_client,
            )
        return ChatOpenAI(model=settings.openai_llm_model, api_key=settings.openai_api_key)

    if settings.groq_api_key:
        from langchain_groq import ChatGroq

        return ChatGroq(model=settings.groq_llm_model, api_key=settings.groq_api_key)

    raise RuntimeError(
        "No LLM provider configured — set OPENAI_API_KEY or GROQ_API_KEY in .env."
    )


def active_llm_provider(settings: Settings) -> str:
    if settings.openai_api_key:
        return "openai"
    if settings.groq_api_key:
        return "groq"
    return "none"
