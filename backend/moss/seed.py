"""Seed loader. `python -m moss.seed --reset` wipes the database and reloads the demo company.

Seed files hold relative dates so the story is always fresh:
  days_ago / time  -> when the event happened
  {d+N}            -> today plus N days (ISO date)
  {wd+N}           -> today plus N working days (ISO date)
"""
import argparse
import asyncio
import json
import re
from datetime import date, datetime, timedelta

from . import cache, db
from .config import settings


def _wd(n: int) -> date:
    d = date.today()
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def _resolve(obj):
    text = json.dumps(obj)
    text = re.sub(r"\{d\+(\d+)\}", lambda m: (date.today() + timedelta(days=int(m[1]))).isoformat(), text)
    text = re.sub(r"\{wd\+(\d+)\}", lambda m: _wd(int(m[1])).isoformat(), text)
    return json.loads(text)


def _read(name: str):
    return json.loads((settings.seed_dir / name).read_text(encoding="utf-8"))


def materialize(ev: dict) -> dict:
    """Turn a seed entry into a normalized event."""
    ev = _resolve(ev)
    hh, mm = (ev.get("time") or "10:00").split(":")
    when = datetime.combine(date.today() - timedelta(days=ev.get("days_ago", 0)), datetime.min.time()).replace(hour=int(hh), minute=int(mm))
    meta = dict(ev.get("meta") or {})
    for k in ("_extraction", "_proposal"):
        if ev.get(k):
            meta[k] = ev[k]
    if ev["source"] == "calendar":
        meta["start"] = when.isoformat(timespec="minutes")
        meta["end"] = (when + timedelta(minutes=meta.get("duration_minutes", 30))).isoformat(timespec="minutes")
    return {"id": ev["id"], "source": ev["source"], "title": ev["title"], "body": ev["body"],
            "occurred_at": when.isoformat(timespec="minutes"), "account": ev.get("account"),
            "participants": ev.get("participants") or [], "url": ev.get("url"), "meta": meta}


def demo_queue() -> list[dict]:
    known = {r["id"] for r in db.q("SELECT id FROM events")}
    return [e for e in _read("demo.json") if e["id"] not in known]


async def load(reset: bool = False, wait_graph: bool = False) -> dict:
    from . import pipeline  # imported late: pipeline imports modules that read the database
    if reset:
        db.reset()
        cache.invalidate()
    company = _read("company.json")
    for u in company["users"]:
        db.insert("users", u, replace=True)
    for a in company["accounts"]:
        db.insert("accounts", a, replace=True)
    n = 0
    for ev in _read("events.json"):
        if pipeline.store_event(materialize(ev)):
            await pipeline.process_event(ev["id"], historical=True, wait_graph=wait_graph)
            n += 1
    return {"users": len(company["users"]), "accounts": len(company["accounts"]), "events": n, "demo_queue": len(demo_queue())}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Load the Moss demo company.")
    ap.add_argument("--reset", action="store_true", help="wipe the database first")
    ap.add_argument("--wait-graph", action="store_true", help="wait for Graphiti ingestion to finish (slow on free tiers)")
    args = ap.parse_args()
    print(asyncio.run(load(reset=args.reset, wait_graph=args.wait_graph)))
