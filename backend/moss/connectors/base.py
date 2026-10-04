"""Connector contracts. Every tool has a live adapter (real API) and a mock adapter (seeded data).

All methods are async. `fetch_events` returns normalized events for ingestion:
    {"id": "jira:PLAT-138", "source": "jira", "title": str, "body": str, "occurred_at": ISO-8601 str,
     "account": str | None, "participants": [display names], "url": str | None, "meta": dict}
Event ids must be stable across calls so a re-sync never duplicates.
Write methods return {"id" or "key": str, "url": str, "text": one-line human summary}.
"""
from typing import Protocol


class JiraConnector(Protocol):
    mode: str  # "live" | "mock"
    async def search(self, text: str = "", limit: int = 10) -> list[dict]: ...      # {key, summary, status, assignee, url, updated}
    async def create_issue(self, summary: str, description: str = "", assignee: str | None = None) -> dict: ...
    async def add_comment(self, key: str, text: str) -> dict: ...
    async def fetch_events(self, limit: int = 20) -> list[dict]: ...


class SlackConnector(Protocol):
    mode: str
    async def history(self, channel: str | None = None, limit: int = 30) -> list[dict]: ...  # {channel, user, text, ts, url}
    async def post_message(self, channel: str, text: str) -> dict: ...
    async def fetch_events(self, limit: int = 30) -> list[dict]: ...


class GmailConnector(Protocol):
    mode: str
    async def search(self, query: str = "", limit: int = 10) -> list[dict]: ...     # {id, sender, to, subject, snippet, date, url}
    async def create_draft(self, to: str, subject: str, body: str) -> dict: ...
    async def fetch_events(self, limit: int = 20) -> list[dict]: ...


class CalendarConnector(Protocol):
    mode: str
    async def list_events(self, days: int = 7) -> list[dict]: ...                    # {id, title, start, end, attendees, url}
    async def create_event(self, title: str, start: str, duration_minutes: int = 30,
                           attendees: list[str] | None = None, description: str = "") -> dict: ...
    async def fetch_events(self, limit: int = 20) -> list[dict]: ...


class ConfluenceConnector(Protocol):
    mode: str
    async def search(self, text: str = "", limit: int = 10) -> list[dict]: ...      # {id, title, excerpt, url, updated}
    async def create_page(self, title: str, body: str) -> dict: ...
    async def fetch_events(self, limit: int = 20) -> list[dict]: ...
