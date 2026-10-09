"""Provider wrappers for the WAYMARK assistant (Groq and Anthropic).

- Prompt caching (`cache_control`) on the system block and on the digest block.
- A `propose_measures` tool whose input schema is the recommendation card schema.
- Server-side validation of every card before it can reach a client.
- The report digest is untrusted DATA in the user turn, in delimiters. It is never part of the system prompt.
Any provider problem raises LLMError; the caller then falls back to the rule-based cards.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

import httpx

from .auth import Role
from .config import settings
from .config_loader import get_effects
from .playbooks import MAX_CARDS, clean_text, owners_for, system_prompt
from .schemas_ops import RecommendationCard

log = logging.getLogger("waymark.llm")
DIGEST_OPEN, DIGEST_CLOSE = "<untrusted_report_data>", "</untrusted_report_data>"
MAX_HISTORY_TURNS = 10


class LLMError(RuntimeError):
    """Any failure talking to the model (never shown to users verbatim)."""


@dataclass
class LLMResult:
    text: str = ""
    raw_cards: list[dict] = field(default_factory=list)
    used_tool: bool = False


@dataclass(frozen=True)
class GroqClient:
    api_key: str
    model: str


def get_client():
    """Return the selected provider client, or None when its API key is missing."""
    provider = settings.llm_provider
    if provider == "auto":
        provider = "groq" if settings.groq_api_key else "anthropic" if settings.anthropic_api_key else "groq"

    if provider == "groq":
        if not settings.groq_api_key:
            return None
        return GroqClient(settings.groq_api_key, settings.groq_model)
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            return None
        import anthropic

        return anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=45.0, max_retries=1)

    log.error("unsupported WAYMARK_LLM_PROVIDER: %s", provider)
    return None


def _groq_messages(role: Role, digest: Optional[dict], history: list[tuple[str, str]], question: str) -> list[dict]:
    """Build OpenAI-compatible messages, flattening the report block used by Anthropic."""
    messages = [{"role": "system", "content": system_prompt(role)}]
    for message in build_messages(digest, history, question):
        content = message["content"]
        if isinstance(content, list):
            content = "\n\n".join(block["text"] for block in content if isinstance(block, dict) and block.get("type") == "text")
        messages.append({"role": message["role"], "content": content})
    return messages


def _stream_groq(*, role: Role, digest: Optional[dict], history: list[tuple[str, str]], question: str,
                 client: GroqClient) -> Iterator[tuple[str, Any]]:
    """Stream a Groq Chat Completions response and collect proposal tool arguments."""
    result = LLMResult()
    payload: dict[str, Any] = {
        "model": client.model,
        "messages": _groq_messages(role, digest, history, question),
        "max_completion_tokens": settings.chat_max_tokens,
        "stream": True,
    }
    if digest is not None:
        tool = propose_tool()
        payload["tools"] = [{"type": "function", "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["input_schema"],
        }}]
        payload["tool_choice"] = "auto"

    tool_calls: dict[int, dict[str, str]] = {}
    try:
        with httpx.Client(timeout=httpx.Timeout(45.0, connect=10.0)) as http:
            with http.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {client.api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    log.warning("Groq assistant request returned HTTP %s", response.status_code)
                    raise LLMError(f"Groq returned HTTP {response.status_code}")
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        result.text += content
                        yield "token", content
                    for call in delta.get("tool_calls") or []:
                        index = call.get("index", 0)
                        collected = tool_calls.setdefault(index, {"name": "", "arguments": ""})
                        function = call.get("function") or {}
                        if function.get("name"):
                            collected["name"] += function["name"]
                        if function.get("arguments"):
                            collected["arguments"] += function["arguments"]
    except LLMError:
        raise
    except Exception as e:  # timeouts, rate limits, malformed streams: the caller uses the rule-based fallback.
        log.warning("Groq assistant call failed: %s: %s", type(e).__name__, str(e)[:200])
        raise LLMError(type(e).__name__) from None

    for call in tool_calls.values():
        if call["name"] != "propose_measures":
            continue
        try:
            arguments = json.loads(call["arguments"])
        except json.JSONDecodeError:
            raise LLMError("invalid Groq tool response") from None
        result.used_tool = True
        cards = arguments.get("cards") if isinstance(arguments, dict) else None
        if isinstance(cards, list):
            result.raw_cards.extend(card for card in cards if isinstance(card, dict))
    yield "result", result


def _stream_anthropic(*, role: Role, digest: Optional[dict], history: list[tuple[str, str]], question: str,
                      client) -> Iterator[tuple[str, Any]]:
    system = [{"type": "text", "text": system_prompt(role), "cache_control": {"type": "ephemeral"}}]
    kwargs: dict[str, Any] = dict(model=settings.anthropic_model, max_tokens=settings.chat_max_tokens, system=system,
                                  messages=build_messages(digest, history, question))
    if digest is not None:
        kwargs["tools"] = [propose_tool()]
        kwargs["tool_choice"] = {"type": "auto"}
    result = LLMResult()
    try:
        with client.messages.stream(**kwargs) as stream:
            for piece in stream.text_stream:
                if piece:
                    result.text += piece
                    yield "token", piece
            final = stream.get_final_message()
        for block in getattr(final, "content", []) or []:
            if getattr(block, "type", "") == "tool_use" and getattr(block, "name", "") == "propose_measures":
                result.used_tool = True
                inp = getattr(block, "input", None)
                cards = inp.get("cards") if isinstance(inp, dict) else None
                if isinstance(cards, list):
                    result.raw_cards.extend(c for c in cards if isinstance(c, dict))
    except LLMError:
        raise
    except Exception as e:                       # timeouts, rate limits, auth, malformed streams: all handled the same way
        log.warning("assistant call failed: %s: %s", type(e).__name__, str(e)[:200])
        raise LLMError(type(e).__name__) from None
    yield "result", result


def propose_tool() -> dict:
    cats = get_effects().categories
    return {
        "name": "propose_measures",
        "description": "Optional: propose 1–3 useful road-safety actions when the user asks for recommendations or next steps. "
                       "Tie each action to valid report cells and choose a "
                       "category and owner allowed by the schema.",
        "input_schema": {
            "type": "object",
            "properties": {"cards": {"type": "array", "maxItems": MAX_CARDS, "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "maxLength": 200},
                    "category": {"type": "string", "enum": sorted(cats)},
                    "owner_role": {"type": "string", "enum": [r.value for r in Role]},
                    "cell_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 10},
                    "rationale": {"type": "string", "maxLength": 1000,
                                  "description": "Why, using only numbers from the digest."},
                    "evidence_needed": {"type": "array", "items": {"type": "string", "enum": ["before", "during", "after"]}},
                },
                "required": ["title", "category", "owner_role", "cell_ids", "rationale"],
            }}},
            "required": ["cards"],
        },
    }


def digest_block(digest: dict) -> str:
    """JSON-encoded digest inside delimiters. Angle brackets are escaped so report text cannot close the delimiter."""
    body = json.dumps(digest, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")
    return f"{DIGEST_OPEN}\n{body}\n{DIGEST_CLOSE}"


def build_messages(digest: Optional[dict], history: list[tuple[str, str]], question: str) -> list[dict]:
    turns = [(a, c) for a, c in history if c.strip()][-MAX_HISTORY_TURNS:]
    turns.append(("user", question))
    # The API needs alternating roles starting with "user"; merge neighbours and drop a leading assistant turn.
    merged: list[tuple[str, str]] = []
    for author, content in turns:
        if merged and merged[-1][0] == author:
            merged[-1] = (author, merged[-1][1] + "\n\n" + content)
        else:
            merged.append((author, content))
    while merged and merged[0][0] != "user":
        merged.pop(0)
    messages: list[dict] = []
    for i, (author, content) in enumerate(merged):
        if author == "user" and i == 0 and digest is not None:
            blocks = [{"type": "text", "text": digest_block(digest), "cache_control": {"type": "ephemeral"}},
                      {"type": "text", "text": content}]
            messages.append({"role": "user", "content": blocks})
        else:
            messages.append({"role": author, "content": content})
    return messages


def stream_chat(*, role: Role, digest: Optional[dict], history: list[tuple[str, str]], question: str,
                client=None) -> Iterator[tuple[str, Any]]:
    """Yield ("token", text) while the model writes, then ("result", LLMResult). Raises LLMError on any failure."""
    client = client or get_client()
    if client is None:
        raise LLMError("no API key configured")
    if isinstance(client, GroqClient):
        yield from _stream_groq(role=role, digest=digest, history=history, question=question, client=client)
    else:
        yield from _stream_anthropic(role=role, digest=digest, history=history, question=question, client=client)


# ------------------------------------------------------------------ validation
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    return {m.group(0).replace(",", "").rstrip(".") for m in _NUM.finditer(text)}


def ungrounded_numbers(text: str, digest_text: str) -> list[str]:
    """Numbers above 10 in `text` that do not appear anywhere in the digest."""
    known = _numbers(digest_text)
    bad = []
    for n in _numbers(text):
        try:
            if float(n) > 10 and n not in known:
                bad.append(n)
        except ValueError:
            continue
    return sorted(bad)


def validate_cards(raw_cards: list[dict], digest: dict, role: Role | str) -> list[RecommendationCard]:
    """Keep only cards that are safe to show: real cell ids, known category, in-scope owner, grounded numbers."""
    cats = get_effects().categories
    allowed_owners = {r.value for r in owners_for(role)}
    valid_cells = set(digest.get("valid_cell_ids", []))
    digest_text = json.dumps(digest)
    out: list[RecommendationCard] = []
    for i, c in enumerate(raw_cards):
        why = None
        category, owner = c.get("category"), c.get("owner_role")
        cell_ids = c.get("cell_ids")
        title, rationale = clean_text(c.get("title"), 200), clean_text(c.get("rationale"), 1000)
        if category not in cats:
            why = f"unknown category {category!r}"
        elif owner not in allowed_owners:
            why = f"owner_role {owner!r} is outside the {Role(role).value} scope"
        elif not isinstance(cell_ids, list) or not cell_ids or not all(isinstance(x, str) for x in cell_ids):
            why = "cell_ids missing or not a list of strings"
        elif any(x not in valid_cells for x in cell_ids):
            why = "cell_id not present in the report"
        elif len(title) < 3 or len(rationale) < 3:
            why = "title or rationale missing"
        else:
            bad = ungrounded_numbers(title + " " + rationale, digest_text)
            if bad:
                why = f"numbers not found in the report: {', '.join(bad[:4])}"
        if why:
            log.warning("dropped card %d from the model: %s", i, why)
            continue
        needed = c.get("evidence_needed")
        if not (isinstance(needed, list) and needed and all(x in ("before", "during", "after") for x in needed)):
            needed = list(cats[category].evidence_required)
        out.append(RecommendationCard(card_id=f"card-{uuid.uuid4().hex[:8]}", title=title, category=category,
                                      owner_role=Role(owner), cell_ids=list(dict.fromkeys(cell_ids))[:10],
                                      rationale=rationale, evidence_needed=needed))
        if len(out) >= MAX_CARDS:
            break
    return out
