"""Dashboard tiles. `tiles()` is instant (SQLite and seed files only); `brief()` adds what needs the graph and the LLM
(suggested next tasks, stakeholder summary) and is cached, so opening the dashboard does not spend model quota each time.

Sprint points and cloud spend have no live source in Moss yet: those two tiles read sample figures from
data/seed/metrics.json and say so ("sample"). Everything else is computed from live Moss data.
"""
import json
import logging
from datetime import date, datetime, timedelta

from . import cache, db, llm
from .config import settings
from .schemas import Brief

log = logging.getLogger("moss.dashboard")


def _metrics() -> dict:
    try:
        return json.loads((settings.seed_dir / "metrics.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _first(user: dict) -> str:
    return user["name"].split()[0].lower()


def _mine(user: dict) -> set[str] | None:
    """Event ids an employee may see; None for managers (everything)."""
    if user["role"] == "manager":
        return None
    f = _first(user)
    return {r["id"] for r in db.q("SELECT id, participants FROM events") if any(f in (p or "").lower() for p in (r["participants"] or []))}


def _tokens(user: dict) -> dict:
    rows = db.q("SELECT ts, user_id, agent_id, tokens FROM usage")
    if user["role"] != "manager":
        rows = [r for r in rows if r["user_id"] == user["id"]]
    days = [(date.today() - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    series = [sum(r["tokens"] for r in rows if r["ts"][:10] == d) for d in days]
    out = {"total": sum(r["tokens"] for r in rows), "today": series[-1], "series": series, "calls": len(rows), "source": "live"}
    if user["role"] == "manager":
        names = {u["id"]: u["name"] for u in db.q("SELECT id, name FROM users")}
        by: dict[str, int] = {}
        for r in rows:
            who = names.get(r["user_id"], "Background agents")
            by[who] = by.get(who, 0) + r["tokens"]
        out["by_person"] = sorted(({"name": k, "tokens": v} for k, v in by.items()), key=lambda x: -x["tokens"])
    return out


def _commitments(user: dict) -> list[dict]:
    rows = db.q("SELECT c.id, c.text, c.owner, c.due, c.status, c.account, e.title AS event_title FROM commitments c "
                "LEFT JOIN events e ON e.id=c.event_id")
    if user["role"] != "manager":
        rows = [r for r in rows if _first(user) in (r["owner"] or "").lower()]
    return rows


def _risks(user: dict, limit: int = 5) -> list[dict]:
    visible = _mine(user)
    rows = db.q("SELECT i.text, i.event_id, e.title AS event_title, e.account, e.occurred_at FROM insights i JOIN events e ON e.id=i.event_id "
                "WHERE i.kind='risk' ORDER BY e.occurred_at DESC")
    return [r for r in rows if visible is None or r["event_id"] in visible][:limit]


def tiles(user: dict) -> dict:
    m, today = _metrics(), date.today().isoformat()
    commits = _commitments(user)
    open_c = sorted([c for c in commits if c["status"] == "open"], key=lambda c: (c["due"] is None, c["due"] or ""))
    out = {"role": user["role"], "sample_note": m.get("note"), "tokens": _tokens(user)}
    if user["role"] != "manager":
        mine = next((k for k in (m.get("current") or {}).get("by_person", {}) if _first(user) in k.lower()), None)
        velocity = None
        if mine:
            past = [s["by_person"].get(mine, 0) for s in m.get("sprints", [])]
            cur = m["current"]["by_person"][mine]
            velocity = {"average": round(sum(past) / len(past), 1) if past else None, "history": past, "sprint": m["current"]["name"],
                        "done": cur["done"], "committed": cur["committed"], "unit": "points", "source": "sample"}
        risks = _risks(user)
        out.update({"velocity": velocity, "risks": {"count": len(risks), "items": risks, "source": "live"},
                    "deadlines": {"count": len(open_c), "overdue": sum(bool(c["due"]) and c["due"] < today for c in open_c),
                                  "items": [{**c, "overdue": bool(c["due"]) and c["due"] < today} for c in open_c[:5]], "source": "live"}})
        return out
    cur = m.get("current") or {}
    remaining, length, committed = cur.get("remaining", []), cur.get("length_days", 10), cur.get("committed", 0)
    past = [s["completed"] for s in m.get("sprints", [])]
    out["burndown"] = {"sprint": cur.get("name"), "committed": committed, "length_days": length, "remaining": remaining,
                       "ideal": [round(committed * (1 - i / length), 1) for i in range(length + 1)],
                       "velocity": round(sum(past) / len(past), 1) if past else None, "history": past, "unit": "points",
                       "source": "sample"} if cur else None
    out["cloud"] = {**m["cloud"], "source": "sample"} if m.get("cloud") else None
    people: dict[str, dict] = {}
    for c in commits:
        if not c["owner"]:
            continue
        p = people.setdefault(c["owner"], {"name": c["owner"], "open": 0, "overdue": 0, "done": 0})
        if c["status"] == "open":
            p["open"] += 1
            p["overdue"] += bool(c["due"]) and c["due"] < today
        else:
            p["done"] += 1
    decided = {r["status"]: r["n"] for r in db.q("SELECT status, count(*) AS n FROM actions GROUP BY status")}
    out["team"] = {"people": sorted(people.values(), key=lambda p: (-p["overdue"], -p["open"])), "open": len(open_c),
                   "overdue": sum(p["overdue"] for p in people.values()), "approved": decided.get("executed", 0),
                   "skipped": decided.get("skipped", 0), "pending": decided.get("pending", 0), "source": "live"}
    risks = _risks(user)
    out["risks"] = {"count": len(risks), "items": risks, "source": "live"}
    return out


def _rule_brief(user: dict) -> dict:
    today = date.today().isoformat()
    open_c = sorted([c for c in _commitments(user) if c["status"] == "open"], key=lambda c: (c["due"] is None, c["due"] or ""))
    tasks = []
    for c in open_c[:3]:
        late = c["due"] and c["due"] < today
        who = "" if user["role"] != "manager" else f"{(c['owner'] or 'Someone').split()[0]}: "
        tasks.append({"task": f"{who}{c['text']}"[:110],
                      "why": ("Overdue since " + c["due"]) if late else (f"Due {c['due']}" if c["due"] else f"Promised in {c['event_title']}")})
    for r in _risks(user, 3):
        if len(tasks) < 3:
            tasks.append({"task": f"Deal with: {r['text']}"[:110], "why": f"Risk raised in {r['event_title']}"})
    summary = []
    if user["role"] == "manager":
        decisions = db.q("SELECT i.text, e.title FROM insights i JOIN events e ON e.id=i.event_id WHERE i.kind='decision' "
                         "ORDER BY e.occurred_at DESC LIMIT 2")
        summary = [f"Decided: {d['text']}" for d in decisions]
        risks = _risks(user, 1)
        if risks:
            summary.append(f"Main risk: {risks[0]['text']}")
    return {"next_tasks": tasks, "summary": summary[:3], "source": "rules", "route": "offline"}


async def brief(user: dict) -> dict:
    """Suggested next tasks (and, for managers, a stakeholder summary) from the graph facts, via the LLM when available."""
    stamp = (db.one("SELECT count(*) AS n FROM events WHERE processed=1")["n"], db.one("SELECT count(*) AS n FROM commitments WHERE status='open'")["n"],
             db.one("SELECT count(*) AS n FROM actions WHERE status='executed'")["n"])

    async def build() -> dict:
        base = _rule_brief(user)
        if llm.mode() == "offline":
            return base
        visible = _mine(user)
        facts = [f for f in db.q("SELECT fact, valid_at, event_id FROM facts WHERE object_type IN ('decision','commitment','risk','action') "
                                 "ORDER BY valid_at DESC LIMIT 60") if visible is None or f["event_id"] in visible][:28]
        open_c = [c for c in _commitments(user) if c["status"] == "open"]
        who = f"{user['name']} ({user['title']})"
        ask = ("three next tasks for the team and a three-sentence summary a stakeholder could read (progress, decisions, risks)"
               if user["role"] == "manager" else "three next tasks for this person; leave summary empty")
        prompt = (f"Person: {who}. Today: {datetime.now().strftime('%A %Y-%m-%d')}.\nOPEN COMMITMENTS:\n"
                  + ("\n".join(f"- {c['owner']}: {c['text']} (due {c['due'] or 'n/a'})" for c in open_c[:12]) or "- none")
                  + "\nRECENT FACTS FROM THE KNOWLEDGE GRAPH:\n" + ("\n".join(f"- {f['fact']} ({(f['valid_at'] or '')[:10]})" for f in facts) or "- none")
                  + f"\n\nWrite {ask}.")
        try:
            llm.actor.set((user["id"], "stag"))
            out = await llm.generate_json(prompt, Brief, "You are Stag, the orchestrator of Moss. Use only the facts given; never invent "
                                          "names, dates or numbers. Prefer overdue and blocking items. Plain text, no Markdown.")
            return {"next_tasks": [t.model_dump() for t in out.next_tasks[:3]] or base["next_tasks"],
                    "summary": out.summary[:3] if user["role"] == "manager" else [], "source": "llm", "route": llm.state["last_route"]}
        except Exception as e:
            log.warning("brief fell back to rules: %s", e)
            return base

    return await cache.get_or_set("brief", cache.key_of(user["id"], stamp, llm.mode()), 900, build)
