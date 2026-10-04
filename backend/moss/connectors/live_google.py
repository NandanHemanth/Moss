"""Live Gmail and Google Calendar adapters for a personal Google account.

Auth: OAuth installed-app flow; see `google_auth.py` (scopes gmail.readonly, gmail.compose, calendar.events).
A connector is live only when the token file (`GOOGLE_TOKEN`) exists. Expired access tokens are refreshed
and written back before each call.

The Google client library is synchronous and not thread-safe, so every call runs in a worker thread
(`asyncio.to_thread`) behind a per-connector lock, with a 20 s socket timeout.

Safety: Moss only creates Gmail *drafts*. Calendar invitations go only to real addresses: names are mapped
to emails through the `users` table, and anything on a reserved test domain (the seeded `*.example`
addresses) is never invited; those people are named in the event description instead.
"""
import asyncio
import base64
import html
import threading
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr
from pathlib import Path

from ..config import settings
from .live_common import local_iso, strip_html

HTTP_TIMEOUT = 20
GMAIL_WEB = "https://mail.google.com/mail/u/0/"
META_HEADERS = ["From", "To", "Subject", "Date"]
SEND_UPDATES = ("all", "externalOnly", "none")
_FAKE_DOMAINS = ("example", "invalid", "test", "localhost")   # reserved names: mail can never be delivered
_FAKE_HOSTS = ("example.com", "example.org", "example.net")


# ---------------------------------------------------------------------------- pure helpers (unit-tested)
def is_fake_address(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].strip().strip(".").lower()
    return domain.rsplit(".", 1)[-1] in _FAKE_DOMAINS or domain in _FAKE_HOSTS or any(domain.endswith("." + h) for h in _FAKE_HOSTS)


def split_attendees(attendees: list[str] | None, users: list[dict]) -> tuple[list[str], list[str]]:
    """Split requested attendees into (emails to invite, people to name in the description instead).

    Entries with "@" are used as given; names are looked up in `users` ({name, email}). Addresses on reserved
    test domains and names without a known address are never invited.
    """
    by_name = {(u.get("name") or "").casefold(): u for u in users}
    by_email = {(u.get("email") or "").casefold(): u for u in users}
    first: dict[str, list[dict]] = {}
    for u in users:
        first.setdefault((u.get("name") or "").split(" ")[0].casefold(), []).append(u)
    invite, mention = [], []
    for raw in attendees or []:
        entry = (raw or "").strip()
        if not entry:
            continue
        if "@" in entry:
            email = parseaddr(entry)[1] or entry
            label = (by_email.get(email.casefold()) or {}).get("name") or parseaddr(entry)[0] or email
        else:
            same_first = first.get(entry.casefold(), [])
            user = by_name.get(entry.casefold()) or (same_first[0] if len(same_first) == 1 else None)
            email, label = (user or {}).get("email") or "", (user or {}).get("name") or entry
        if email and "@" in email and not is_fake_address(email):
            if email.lower() not in (e.lower() for e in invite):
                invite.append(email)
        elif label not in mention:
            mention.append(label)
    return invite, mention


def build_raw_message(to: str, subject: str, body: str) -> str:
    """An RFC 5322 message, base64url-encoded, as the Gmail API expects in `message.raw`."""
    msg = EmailMessage()
    if to:
        msg["To"] = to
    msg["Subject"] = " ".join((subject or "").split())
    msg.set_content(body or "")
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def _header(msg: dict, name: str) -> str:
    for h in (msg.get("payload") or {}).get("headers") or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value") or ""
    return ""


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def plain_text(payload: dict | None) -> str:
    """The text/plain part of a message payload; falls back to stripped text/html; "" when neither exists."""
    found = {"text/plain": "", "text/html": ""}

    def walk(part: dict) -> None:
        mime, data = part.get("mimeType", ""), (part.get("body") or {}).get("data")
        if mime in found and data and not found[mime] and not part.get("filename"):
            found[mime] = _decode(data)
        for child in part.get("parts") or []:
            walk(child)

    walk(payload or {})
    return found["text/plain"].strip() or strip_html(found["text/html"])


def _sender(msg: dict) -> str:
    name, address = parseaddr(_header(msg, "From"))
    return name or address or "unknown"


def _message_url(msg: dict) -> str:
    return f"{GMAIL_WEB}#all/{msg.get('threadId') or msg['id']}"


def _message_time(msg: dict) -> str:
    return local_iso(int(msg["internalDate"]) / 1000) if msg.get("internalDate") else local_iso(None)


def message_row(msg: dict) -> dict:
    """Gmail message resource -> the search row of the connector contract."""
    return {"id": msg["id"], "sender": _sender(msg), "to": _header(msg, "To") or None,
            "subject": _header(msg, "Subject") or "(no subject)", "snippet": html.unescape(msg.get("snippet") or "")[:240],
            "date": _message_time(msg), "url": _message_url(msg)}


def message_event(msg: dict) -> dict:
    """Gmail message resource (format=full) -> normalized event."""
    body = plain_text(msg.get("payload")) or html.unescape(msg.get("snippet") or "")
    return {"id": f"gmail:{msg['id']}", "source": "gmail", "title": _header(msg, "Subject") or "(no subject)", "body": body,
            "occurred_at": _message_time(msg), "account": None, "participants": [_sender(msg)], "url": _message_url(msg),
            "meta": {"to": _header(msg, "To") or None, "thread_id": msg.get("threadId")}}


def _wall(point: dict | None) -> str | None:
    """Calendar start/end -> wall time in the calendar's zone ("2026-10-08T10:00"), or a date for all-day events."""
    if not point:
        return None
    if point.get("dateTime"):
        try:
            return datetime.fromisoformat(point["dateTime"].replace("Z", "+00:00")).replace(tzinfo=None).isoformat(timespec="minutes")
        except ValueError:
            return point["dateTime"]
    return point.get("date")


def _people(ev: dict) -> list[str]:
    return [a.get("displayName") or a.get("email") for a in ev.get("attendees") or []
            if not a.get("resource") and (a.get("displayName") or a.get("email"))]


def calendar_row(ev: dict) -> dict:
    """Calendar event resource -> the list row of the connector contract."""
    return {"id": ev["id"], "title": ev.get("summary") or "(no title)", "start": _wall(ev.get("start")),
            "end": _wall(ev.get("end")), "attendees": _people(ev), "url": ev.get("htmlLink")}


def calendar_event(ev: dict) -> dict:
    """Calendar event resource -> normalized event."""
    row = calendar_row(ev)
    start = row["start"] or local_iso(ev.get("created"))
    return {"id": f"calendar:{ev['id']}", "source": "calendar", "title": row["title"],
            "body": strip_html(ev.get("description") or "") or row["title"],
            "occurred_at": start if "T" in start else f"{start}T00:00", "account": None, "participants": row["attendees"],
            "url": row["url"], "meta": {"start": row["start"], "end": row["end"]}}


def build_event(title: str, start: str, duration_minutes: int, invite: list[str], mention: list[str],
                description: str, time_zone: str | None) -> dict:
    """Request body for events.insert. `start` is an ISO datetime; a bare date means 10:00 that day."""
    try:
        begin = datetime.fromisoformat((start or "").strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"calendar event needs an ISO start time, got “{start}”") from None
    if "T" not in start and " " not in start.strip():
        begin = begin.replace(hour=10)
    end = begin + timedelta(minutes=duration_minutes or 30)
    if begin.tzinfo is None and not time_zone:      # no calendar zone known: pin the wall time to this machine's zone
        begin, end = begin.astimezone(), end.astimezone()
    point = lambda d: {"dateTime": d.isoformat(timespec="seconds"), **({"timeZone": time_zone} if time_zone else {})}  # noqa: E731
    text = (description or "").strip()
    if mention:
        text = f"{text}\n\n".lstrip() + "Also involved (not invited, no real address on file): " + ", ".join(mention)
    body = {"summary": title or "Untitled event", "start": point(begin), "end": point(end)}
    if text:
        body["description"] = text
    if invite:
        body["attendees"] = [{"email": e} for e in invite]
    return body


# ---------------------------------------------------------------------------- service plumbing
class _Google:
    mode = "live"
    api = ("", "")
    label = "Google"

    def __init__(self, service=None):
        """`service` lets tests inject a fake googleapiclient resource; normally it is built on first use."""
        self._service, self._injected = service, service is not None
        self._creds = None
        self._lock = threading.Lock()

    @staticmethod
    def is_configured() -> bool:
        return Path(settings.google_token).is_file()

    def _svc(self):
        if self._injected:
            return self._service
        from . import google_auth
        self._creds = google_auth.ensure_fresh(self._creds) if self._creds else google_auth.load_credentials()
        if self._service is None:
            import google_auth_httplib2
            import httplib2
            from googleapiclient.discovery import build
            http = google_auth_httplib2.AuthorizedHttp(self._creds, http=httplib2.Http(timeout=HTTP_TIMEOUT))
            self._service = build(*self.api, http=http, cache_discovery=False)
        return self._service

    async def _run(self, fn):
        """Run `fn(service)` in a worker thread; upstream errors are re-raised with Google's message."""
        def work():
            with self._lock:
                try:
                    return fn(self._svc())
                except (RuntimeError, ValueError):
                    raise
                except Exception as e:
                    status = getattr(e, "status_code", None) or getattr(getattr(e, "resp", None), "status", "")
                    reason = getattr(e, "reason", None) or str(e)
                    raise RuntimeError(f"{self.label} {status}: {reason}".replace("  ", " ")) from e
        return await asyncio.to_thread(work)


class LiveGmail(_Google):
    api = ("gmail", "v1")
    label = "Gmail"

    @staticmethod
    def _fetch(svc, query: str, limit: int, full: bool) -> list[dict]:
        args = {"userId": "me", "maxResults": max(1, min(limit, 50))}
        if (query or "").strip():
            args["q"] = query.strip()
        else:
            args["labelIds"] = ["INBOX"]
        refs = svc.users().messages().list(**args).execute().get("messages") or []
        get = svc.users().messages().get
        return [get(userId="me", id=r["id"], format="full").execute() if full
                else get(userId="me", id=r["id"], format="metadata", metadataHeaders=META_HEADERS).execute() for r in refs]

    async def search(self, query: str = "", limit: int = 10) -> list[dict]:
        return [message_row(m) for m in await self._run(lambda svc: self._fetch(svc, query, limit, full=False))]

    async def create_draft(self, to: str, subject: str, body: str) -> dict:
        to = (to or "").strip()
        note = ""
        if to and "@" not in to:  # a name, not an address: use a known real address or leave the recipient open
            from .. import db
            invite, _ = split_attendees([to], db.q("SELECT name,email FROM users"))
            note = "" if invite else f" (no address for {to}; add the recipient before sending)"
            address = invite[0] if invite else ""
        else:
            address = ", ".join(a for _, a in getaddresses([to]) if a)
        raw = build_raw_message(address, subject, body)
        draft = await self._run(lambda svc: svc.users().drafts().create(userId="me", body={"message": {"raw": raw}}).execute())
        message_id = (draft.get("message") or {}).get("id")
        url = f"{GMAIL_WEB}#drafts" + (f"?compose={message_id}" if message_id else "")
        return {"id": draft["id"], "url": url, "text": f"Drafted email to {to or 'nobody yet'}: {subject}{note}"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        return [message_event(m) for m in await self._run(lambda svc: self._fetch(svc, "", limit, full=True))]


class LiveCalendar(_Google):
    api = ("calendar", "v3")
    label = "Google Calendar"

    def __init__(self, service=None):
        super().__init__(service)
        self._tz: str | None = None

    def _window(self, svc, start: datetime, end: datetime, limit: int) -> list[dict]:
        data = svc.events().list(calendarId="primary", timeMin=start.astimezone().isoformat(timespec="seconds"),
                                 timeMax=end.astimezone().isoformat(timespec="seconds"), singleEvents=True,
                                 orderBy="startTime", maxResults=max(1, min(limit, 250))).execute()
        self._tz = data.get("timeZone") or self._tz
        return [e for e in data.get("items") or [] if e.get("status") != "cancelled"]

    def _time_zone(self, svc) -> str | None:
        """The primary calendar's IANA time zone, as reported by events.list."""
        if self._tz is None:
            self._tz = svc.events().list(calendarId="primary", maxResults=1, fields="timeZone").execute().get("timeZone")
        return self._tz

    async def list_events(self, days: int = 7) -> list[dict]:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        horizon = datetime.now() + timedelta(days=max(1, days))
        return [calendar_row(e) for e in await self._run(lambda svc: self._window(svc, today, horizon, 100))]

    async def create_event(self, title: str, start: str, duration_minutes: int = 30,
                           attendees: list[str] | None = None, description: str = "") -> dict:
        from .. import db
        invite, mention = split_attendees(attendees, db.q("SELECT name,email FROM users"))

        def work(svc):
            body = build_event(title, start, duration_minutes, invite, mention, description, self._time_zone(svc))
            updates = settings.calendar_send_updates if invite and settings.calendar_send_updates in SEND_UPDATES else "none"
            return body, svc.events().insert(calendarId="primary", body=body, sendUpdates=updates).execute()

        body, ev = await self._run(work)
        when = body["start"]["dateTime"][:16].replace("T", " ")
        text = f"Scheduled “{body['summary']}” for {when}"
        if invite:
            text += f", invited {', '.join(invite)}"
        if mention:
            text += f"; not invited (no real address): {', '.join(mention)}"
        return {"id": ev["id"], "url": ev.get("htmlLink") or "https://calendar.google.com/", "text": text}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        now = datetime.now()
        events = await self._run(lambda svc: self._window(svc, now - timedelta(days=1), now + timedelta(days=7), limit))
        return [calendar_event(e) for e in events]
