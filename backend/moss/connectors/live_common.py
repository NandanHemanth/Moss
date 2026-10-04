"""Helpers shared by the live adapters: time normalisation, HTML stripping, search keywords.

Event times follow the convention of the seeded data: local wall time, ISO-8601, no offset
("2026-10-03T14:00:05"). The timeline sorts `occurred_at` as text, so every source must agree.
"""
import html
import re
from datetime import datetime, timezone

_STOP = set("the a an and or of to in on for with about what is are was were do does did show me all any this that "
            "from at by it its our us you who when where which how have has had status latest recent".split())


def parse_time(value: str) -> datetime:
    """Parse the ISO flavours the APIs return ("…Z", "…+0000", "….000+00:00")."""
    text = value.strip().replace("Z", "+00:00")
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", text)
    return datetime.fromisoformat(text)


def local_iso(value: datetime | str | float | int | None) -> str:
    """Normalise a datetime, ISO string or Unix timestamp to local wall time without an offset."""
    if value is None or value == "":
        return datetime.now().isoformat(timespec="seconds")
    if isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
    elif isinstance(value, str):
        try:
            dt = parse_time(value)
        except ValueError:
            return value
    else:
        dt = value
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt.isoformat(timespec="seconds")


def strip_html(markup: str) -> str:
    """Reduce HTML/XHTML to readable text: block ends become newlines, tags go, entities are decoded."""
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h[1-6])>", "\n", markup or "")
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def keywords(text: str, limit: int = 6) -> list[str]:
    """Search words from free text: alphanumeric only (safe inside JQL/CQL quotes), no filler words."""
    words = []
    for w in re.findall(r"[A-Za-z0-9]+", text or ""):
        if len(w) > 2 and w.lower() not in _STOP and w.lower() not in (x.lower() for x in words):
            words.append(w)
    return words[:limit]


def error_text(response) -> str:
    """Best-effort upstream error message from an httpx response (never includes request headers)."""
    try:
        data = response.json()
    except ValueError:
        body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", response.text or "")
        title = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
        text = " ".join(strip_html(title.group(1) if title else body).split())
        if re.search(r"[{};]\s*(var|window|function)\b|window\.", text):  # leftover inline JavaScript, not a message
            text = ""
        return text[:120] or response.reason_phrase or "no details in the response"
    if isinstance(data, dict):
        parts = [str(m) for m in data.get("errorMessages") or []]
        errors = data.get("errors")
        if isinstance(errors, dict):
            parts += [f"{k}: {v}" for k, v in errors.items()]
        elif isinstance(errors, list):
            parts += [str(e.get("title") or e.get("detail") or e) if isinstance(e, dict) else str(e) for e in errors]
        for key in ("message", "detail", "error"):
            if isinstance(data.get(key), str):
                parts.append(data[key])
            elif isinstance(data.get(key), dict) and data[key].get("message"):
                parts.append(str(data[key]["message"]))
        if parts:
            return "; ".join(dict.fromkeys(parts))[:300]
    return str(data)[:300]
