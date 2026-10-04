"""LLM router: Gemini first, then any OpenAI-compatible endpoint (freellmapi), else offline.

Offline is a real mode, not an error: the pipeline then uses the extraction stored with
seeded events and a rule-based proposer, so the demo still runs with no key and no quota.
"""
import contextvars
import json
import logging
import re
import time
from typing import TypeVar

import httpx
from pydantic import BaseModel

from . import cache
from .config import settings

log = logging.getLogger("moss.llm")
T = TypeVar("T", bound=BaseModel)
state = {"last_route": None, "gemini_errors": 0, "fallback_errors": 0, "last_error": None}
_client = None
_cooldown: dict[str, float] = {}   # model -> time until which it is skipped after failing
COOLDOWN_SECONDS = 120


def model_chain(fast: bool = False) -> list[str]:
    """Gemini models to try, in order: the configured one, then GEMINI_FALLBACK_MODELS. Recently failed ones go last."""
    first = settings.gemini_fast_model if fast else settings.gemini_model
    chain = list(dict.fromkeys([first, *settings.gemini_fallback_models]))
    now = time.monotonic()
    return sorted(chain, key=lambda m: _cooldown.get(m, 0) > now)


def mark_down(model: str, error: Exception | str) -> None:
    """Skip a failing model for a while: as long as the API asks for on a rate limit, longer if the model is gone."""
    text = str(error)
    wait = COOLDOWN_SECONDS
    asked = re.search(r"retry in ([\d.]+)s", text)
    if asked:
        wait = float(asked.group(1)) + 2
    elif "429" in text or "RESOURCE_EXHAUSTED" in text:
        wait = 60
    elif "404" in text or "NOT_FOUND" in text:
        wait = 3600
    _cooldown[model] = time.monotonic() + wait
    state["gemini_errors"] += 1
    state["last_error"] = f"gemini {model}: {error}"[:300]


actor: contextvars.ContextVar[tuple[str, str]] = contextvars.ContextVar("moss_actor", default=("system", "stag"))


def record(model: str, tokens: int | None, purpose: str = "") -> None:
    """Count tokens against the person and agent that caused the call (system = background pipeline)."""
    if not tokens:
        return
    from . import db
    user_id, agent_id = actor.get()
    db.insert("usage", {"id": db.new_id("use"), "ts": db.now(), "user_id": user_id, "agent_id": agent_id, "model": model,
                        "tokens": int(tokens), "purpose": purpose})


class LLMUnavailable(Exception):
    pass


def mode() -> str:
    if settings.gemini_key:
        return "gemini"
    if settings.fallback_base_url and settings.fallback_model:
        return "fallback"
    return "offline"


def has_fallback() -> bool:
    return bool(settings.fallback_base_url and settings.fallback_model)


def _gemini():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=settings.gemini_key)
    return _client


async def _gemini_call(prompt: str, system: str, model: str, schema: type[BaseModel] | None):
    from google.genai import types
    cfg = types.GenerateContentConfig(system_instruction=system or None, temperature=0.2)
    if schema is not None:
        cfg.response_mime_type = "application/json"
        cfg.response_schema = schema
    resp = await _gemini().aio.models.generate_content(model=model, contents=prompt, config=cfg)
    record(model, getattr(resp.usage_metadata, "total_token_count", None), schema.__name__ if schema else "text")
    return resp.text or ""


async def _fallback_call(prompt: str, system: str, schema: type[BaseModel] | None) -> str:
    messages = []
    sys_text = system
    if schema is not None:
        sys_text += ("\nReply with one JSON object only, matching this JSON schema:\n"
                     + json.dumps(schema.model_json_schema()))
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    messages.append({"role": "user", "content": prompt})
    body = {"model": settings.fallback_model, "messages": messages, "temperature": 0.2}
    if schema is not None:
        body["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{settings.fallback_base_url.rstrip('/')}/chat/completions", json=body,
                            headers={"Authorization": f"Bearer {settings.fallback_key}"})
        r.raise_for_status()
        data = r.json()
        record(settings.fallback_model, (data.get("usage") or {}).get("total_tokens"), "fallback")
        return data["choices"][0]["message"]["content"] or ""


def _parse(text: str, schema: type[T]) -> T:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    return schema.model_validate_json(text)


async def _route(prompt: str, system: str, schema: type[BaseModel] | None, fast: bool) -> str:
    if settings.gemini_key:
        for model in model_chain(fast):
            try:
                out = await _gemini_call(prompt, system, model, schema)
                state["last_route"] = f"gemini:{model}"
                return out
            except Exception as e:  # overloaded, quota, network, unknown model: try the next one
                mark_down(model, e)
                log.warning("Gemini model %s failed, trying next: %s", model, str(e)[:160])
    if has_fallback():
        try:
            out = await _fallback_call(prompt, system, schema)
            state["last_route"] = f"fallback:{settings.fallback_model}"
            return out
        except Exception as e:
            state["fallback_errors"] += 1
            state["last_error"] = f"fallback: {e}"[:300]
            log.warning("Fallback LLM failed: %s", e)
    raise LLMUnavailable(state["last_error"] or "no LLM configured")


async def generate_json(prompt: str, schema: type[T], system: str = "", fast: bool = False) -> T:
    key = cache.key_of("json", schema.__name__, system, prompt, fast)

    async def run() -> T:
        return _parse(await _route(prompt, system, schema, fast), schema)

    return await cache.get_or_set("llm", key, 3600, run)


async def generate_text(prompt: str, system: str = "") -> str:
    key = cache.key_of("text", system, prompt)
    return await cache.get_or_set("llm", key, 600, lambda: _route(prompt, system, None, False))


def snapshot() -> dict:
    return {"mode": mode(), "primary": settings.gemini_model if settings.gemini_key else None,
            "fast": settings.gemini_fast_model if settings.gemini_key else None,
            "fallback": settings.fallback_model if has_fallback() else None,
            "gemini_chain": model_chain() if settings.gemini_key else [], **state}
