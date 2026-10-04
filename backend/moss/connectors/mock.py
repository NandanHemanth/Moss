"""Mock adapters. Reads come from seeded events in SQLite; writes land in the `outbox` table."""
import json
from datetime import datetime, timedelta, timezone

from .. import db


def _match(rows: list[dict], text: str) -> list[dict]:
    words = [w for w in text.lower().split() if len(w) > 2]
    if not words:
        return rows
    return [r for r in rows if any(w in f"{r['title']} {r['body']}".lower() for w in words)]


def _events(source: str, limit: int = 50) -> list[dict]:
    return db.q("SELECT * FROM events WHERE source=? ORDER BY occurred_at DESC LIMIT ?", (source, limit))


def _write(tool: str, kind: str, payload: dict) -> str:
    oid = db.new_id("out")
    db.insert("outbox", {"id": oid, "tool": tool, "kind": kind, "payload": json.dumps(payload), "created_at": db.now()})
    return oid


class MockJira:
    mode = "mock"

    async def search(self, text: str = "", limit: int = 10) -> list[dict]:
        rows = _match(_events("jira"), text)[:limit]
        out = [{"key": (r["meta"] or {}).get("key", r["id"]), "summary": r["title"],
                "status": (r["meta"] or {}).get("status", "To Do"), "assignee": (r["meta"] or {}).get("assignee"),
                "url": r["url"], "updated": r["occurred_at"]} for r in rows]
        for o in db.q("SELECT * FROM outbox WHERE tool='jira' AND kind='issue' ORDER BY created_at DESC"):
            p = json.loads(o["payload"])
            if not text or any(w in p["summary"].lower() for w in text.lower().split()):
                out.insert(0, {"key": p["key"], "summary": p["summary"], "status": "To Do",
                               "assignee": p.get("assignee"), "url": p["url"], "updated": o["created_at"]})
        return out[:limit]

    async def create_issue(self, summary: str, description: str = "", assignee: str | None = None) -> dict:
        nums = [int(k.split("-")[1]) for k in
                [(r["meta"] or {}).get("key", "") for r in _events("jira", 500)] +
                [json.loads(o["payload"])["key"] for o in db.q("SELECT payload FROM outbox WHERE tool='jira' AND kind='issue'")]
                if "-" in k and k.split("-")[1].isdigit()]
        key = f"PLAT-{max(nums, default=140) + 1}"
        url = f"mock://jira/{key}"
        _write("jira", "issue", {"key": key, "summary": summary, "description": description, "assignee": assignee, "url": url})
        return {"key": key, "url": url, "text": f"Created {key}: {summary}" + (f" (assigned to {assignee})" if assignee else "")}

    async def add_comment(self, key: str, text: str) -> dict:
        _write("jira", "comment", {"key": key, "text": text})
        return {"key": key, "url": f"mock://jira/{key}", "text": f"Commented on {key}"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        return []


class MockSlack:
    mode = "mock"

    async def history(self, channel: str | None = None, limit: int = 30) -> list[dict]:
        rows = _events("slack", 200)
        if channel:
            rows = [r for r in rows if (r["meta"] or {}).get("channel", "").lstrip("#") == channel.lstrip("#")]
        return [{"channel": (r["meta"] or {}).get("channel"), "user": (r["participants"] or ["?"])[0], "text": r["body"],
                 "ts": r["occurred_at"], "url": r["url"]} for r in rows[:limit]]

    async def post_message(self, channel: str, text: str) -> dict:
        channel = "#" + channel.lstrip("#")
        oid = _write("slack", "message", {"channel": channel, "text": text})
        return {"id": oid, "url": f"mock://slack/{channel.lstrip('#')}/{oid}", "text": f"Posted in {channel}"}

    async def fetch_events(self, limit: int = 30) -> list[dict]:
        return []


class MockGmail:
    mode = "mock"

    async def search(self, query: str = "", limit: int = 10) -> list[dict]:
        return [{"id": r["id"], "sender": (r["participants"] or ["?"])[0], "to": (r["meta"] or {}).get("to"),
                 "subject": r["title"], "snippet": r["body"][:240], "date": r["occurred_at"], "url": r["url"]}
                for r in _match(_events("gmail"), query)[:limit]]

    async def create_draft(self, to: str, subject: str, body: str) -> dict:
        oid = _write("gmail", "draft", {"to": to, "subject": subject, "body": body})
        return {"id": oid, "url": f"mock://gmail/drafts/{oid}", "text": f"Drafted email to {to}: {subject}"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        return []


class MockCalendar:
    mode = "mock"

    async def list_events(self, days: int = 7) -> list[dict]:
        out = []
        for r in _events("calendar", 100):
            m = r["meta"] or {}
            out.append({"id": r["id"], "title": r["title"], "start": m.get("start", r["occurred_at"]),
                        "end": m.get("end"), "attendees": r["participants"] or [], "url": r["url"]})
        for o in db.q("SELECT * FROM outbox WHERE tool='calendar' ORDER BY created_at"):
            p = json.loads(o["payload"])
            out.append({"id": o["id"], "title": p["title"], "start": p["start"], "end": p.get("end"),
                        "attendees": p.get("attendees") or [], "url": p["url"]})
        horizon = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        today = datetime.now(timezone.utc).replace(hour=0, minute=0).isoformat()
        return sorted([e for e in out if today[:10] <= (e["start"] or "")[:10] <= horizon[:10]], key=lambda e: e["start"])

    async def create_event(self, title: str, start: str, duration_minutes: int = 30,
                           attendees: list[str] | None = None, description: str = "") -> dict:
        oid = db.new_id("cal")
        end = None
        try:
            end = (datetime.fromisoformat(start) + timedelta(minutes=duration_minutes or 30)).isoformat()
        except ValueError:
            pass
        url = f"mock://calendar/{oid}"
        _write("calendar", "event", {"title": title, "start": start, "end": end, "attendees": attendees or [],
                                     "description": description, "url": url})
        return {"id": oid, "url": url, "text": f"Scheduled “{title}” for {start[:16].replace('T', ' ')}"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        return []


class MockConfluence:
    mode = "mock"

    async def search(self, text: str = "", limit: int = 10) -> list[dict]:
        return [{"id": r["id"], "title": r["title"], "excerpt": r["body"][:240], "url": r["url"], "updated": r["occurred_at"]}
                for r in _match(_events("confluence"), text)[:limit]]

    async def create_page(self, title: str, body: str) -> dict:
        oid = _write("confluence", "page", {"title": title, "body": body})
        return {"id": oid, "url": f"mock://confluence/{oid}", "text": f"Created page “{title}”"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        return []
