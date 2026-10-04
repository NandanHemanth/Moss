"""Runs a question through the orchestrator (managers) or a single service agent (employees)."""

import uuid
from functools import cache as memoize
from typing import Any

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..memory.cache import cache
from . import team, trace
from .tools import AGENT_LABEL

APP_NAME = "moss"
SUB_AGENT_KEYS = {spec["name"]: key for key, spec in team.SERVICE_AGENTS.items()}

_sessions = InMemorySessionService()


class AccessDenied(Exception):
    pass


@memoize
def _runner(agent_key: str) -> Runner:
    agent = team.orchestrator() if agent_key == "orchestrator" else team.service_agent(agent_key)
    return Runner(app_name=APP_NAME, agent=agent, session_service=_sessions)


async def ask(question: str, role: str, agent_key: str, user: str, session_id: str | None = None) -> dict[str, Any]:
    if agent_key == "orchestrator" and role != "manager":
        raise AccessDenied("The Orchestrator is available to managers only.")
    if agent_key not in AGENT_LABEL:
        raise KeyError(agent_key)

    cache_key = cache.key(role, agent_key, question)
    if not session_id and (hit := cache.get(cache_key)):
        cached, age = hit
        minutes = max(1, round(age / 60))
        return {**cached, "plan": [{"agent": "cache", "text": f"Cache: hit ({minutes} min old)"}, *cached["plan"][1:]], "cached": True}

    t = trace.start()
    t.step("cache", "Cache: no fresh answer, continuing")
    runner = _runner(agent_key)
    session_id = session_id or uuid.uuid4().hex
    if not await _sessions.get_session(app_name=APP_NAME, user_id=user, session_id=session_id):
        await _sessions.create_session(app_name=APP_NAME, user_id=user, session_id=session_id, state={"user": user, "role": role})

    answer_parts: list[str] = []
    async for event in runner.run_async(
        user_id=user,
        session_id=session_id,
        new_message=types.Content(role="user", parts=[types.Part(text=question)]),
    ):
        for call in event.get_function_calls():
            if call.name in SUB_AGENT_KEYS:
                key = SUB_AGENT_KEYS[call.name]
                t.step("orchestrator", f"Orchestrator delegated to the {AGENT_LABEL[key]}")
        if event.author == runner.agent.name and event.is_final_response() and event.content and event.content.parts:
            answer_parts.extend(p.text for p in event.content.parts if p.text and not getattr(p, "thought", False))

    result = {
        "answer": "\n".join(answer_parts).strip() or "I couldn't produce an answer from the available sources.",
        "plan": t.steps,
        "citations": t.citations,
        "proposals": t.proposals,
        "agent": agent_key,
        "sessionId": session_id,
        "cached": False,
    }
    if not t.proposals:
        cache.set(cache_key, result)
    return result
