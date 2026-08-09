"""LLM invocation for the final grounded answer. Takes the already fully
rendered {system, user} strings from system_prompt.build_eva_prompt() and
sends them directly as SystemMessage/HumanMessage — deliberately not routed
through a LangChain PromptTemplate, since retrieved document content may
contain literal `{`/`}` characters (JSON snippets, code) that a template's
f-string-style variable substitution would misinterpret and crash on.
"""
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage


def generate_answer(
    llm: BaseChatModel,
    system_prompt: str,
    user_prompt: str,
    prior_turns: list | None = None,
) -> str:
    """prior_turns: short-term memory — ChatMessage rows (role in
    {"user","eva"}, .text) for this session, oldest first, NOT including
    the current turn (chat_route.py fetches them before persisting the
    current turn — see retrieval/short_term_memory.py). Rendered as real
    alternating Human/AI turns so the model sees actual conversation, not a
    flattened summary string.
    """
    messages = [SystemMessage(content=system_prompt)]
    for turn in prior_turns or []:
        if turn.role == "user":
            messages.append(HumanMessage(content=turn.text))
        else:
            messages.append(AIMessage(content=turn.text))
    messages.append(HumanMessage(content=user_prompt))

    response = llm.invoke(messages)
    return response.content
