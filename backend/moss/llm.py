"""LLM router: Gemini first, then any OpenAI-compatible endpoint (freellmapi), else offline.

Offline is a real mode, not an error: the pipeline then uses the extraction stored with
seeded events and a rule-based proposer, so the demo still runs with no key and no quota.
"""
import json
import logging
import re
from typing import TypeVar

import httpx
from pydantic import BaseModel

from . import cache
from .config import settings

log = logging.getLogger("moss.llm")
T = TypeVar("T", bound=BaseModel)
state = {"last_route": None, "gemini_errors": 0, "fallback_errors": 0, "last_error": None}
_client = None


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
        return r.json()["choices"][0]["message"]["content"] or ""


def _parse(text: str, schema: type[T]) -> T:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    return schema.model_validate_json(text)


async def _route(prompt: str, system: str, schema: type[BaseModel] | None, fast: bool) -> str:
    if settings.gemini_key:
        try:
            model = settings.gemini_fast_model if fast else settings.gemini_model
            out = await _gemini_call(prompt, system, model, schema)
            state["last_route"] = f"gemini:{model}"
            return out
        except Exception as e:  # quota, network, bad model name
            state["gemini_errors"] += 1
            state["last_error"] = f"gemini: {e}"[:300]
            log.warning("Gemini failed, trying fallback: %s", e)
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
            "fallback": settings.fallback_model if has_fallback() else None, **state}
