"""Notifications ("whispers") and the server-sent-events broadcaster."""
import asyncio
import json

from . import db
from .config import AGENTS

_subscribers: dict[asyncio.Queue, dict] = {}


def subscribe(user: dict) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers[queue] = user
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.pop(queue, None)


def publish(kind: str, data: dict, managers_only: bool = False) -> None:
    for queue, user in list(_subscribers.items()):
        if managers_only and user["role"] != "manager":
            continue
        try:
            queue.put_nowait(f"event: {kind}\ndata: {json.dumps(data)}\n\n")
        except asyncio.QueueFull:
            pass


def notify(agent_id: str, text: str, event_id: str | None = None) -> dict:
    """Store a 1–2 sentence status update for managers and push it to open clients."""
    row = db.insert("notifications", {"id": db.new_id("n"), "agent_id": agent_id, "text": text.strip(),
                                      "created_at": db.now(), "event_id": event_id})
    publish("notification", {**row, "agent_name": AGENTS[agent_id]["name"]}, managers_only=True)
    return row
