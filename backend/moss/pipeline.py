"""Event pipeline: understand → connect → recommend.

  event ─▶ extract (source agent) ─▶ SQLite insights + knowledge graph
        ─▶ propose (Stag, with graph context and manager feedback) ─▶ approval queue ─▶ notification
"""
import logging
import re
from datetime import date, datetime, timedelta

from . import actions, db, graph, llm, notify
from .config import AGENTS, SOURCE_AGENT, settings
from .schemas import Extraction, Proposal

log = logging.getLogger("moss.pipeline")

EXTRACT_SYSTEM = """You are {agent}, a Moss agent that reads {source} content for a company.
Extract only what is explicitly stated. Never invent owners, dates, customers or decisions.
A commitment is something a named person agreed to do. A decision is something the group settled.
A risk is a stated blocker or danger. Dates are ISO (YYYY-MM-DD); today is {today}."""

PROPOSE_SYSTEM = """You are Stag, the orchestrator of Moss. A new event was just understood by another agent.
Propose between 0 and 4 concrete next actions for the manager to approve. Rules:
- Every action must be justified by the event; propose nothing if nothing is needed.
- Allowed kinds: jira.create_issue (summary, description, assignee), slack.post_message (channel, text),
  calendar.create_event (title, start ISO datetime, duration_minutes, attendees, description),
  gmail.create_draft (to, subject, body), confluence.create_page (title, body).
- Do not propose something the related context shows already exists.
- Default Slack channel is #{channel}. Jira project is {project}. Today is {today}; schedule follow-ups on a weekday.
- notification: one or two plain sentences for the manager, no greeting.
Manager feedback so far: {feedback}"""


def _next_weekday(days: int = 2) -> str:
    d = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=days)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat(timespec="minutes")


async def extract(event: dict, prefer_stored: bool = False) -> Extraction:
    stored = (event.get("meta") or {}).get("_extraction")
    if stored and (prefer_stored or llm.mode() == "offline"):
        return Extraction.model_validate(stored)
    agent = AGENTS[event["agent_id"]]["name"]
    prompt = (f"Title: {event['title']}\nWhen: {event['occurred_at']}\nPeople: {', '.join(event.get('participants') or [])}\n"
              f"Known account: {event.get('account') or 'unknown'}\n\n{event['body'][:14000]}")
    try:
        return await llm.generate_json(prompt, Extraction, EXTRACT_SYSTEM.format(
            agent=agent, source=event["source"], today=date.today().isoformat()), fast=True)
    except Exception as e:
        log.warning("extract fell back for %s: %s", event["id"], e)
        if stored:
            return Extraction.model_validate(stored)
        return Extraction(summary=event["body"][:200], intent="unknown", importance=1, account=event.get("account"))


def _rule_based(event: dict, ex: Extraction) -> Proposal:
    """Offline proposer: predictable, used when no LLM is reachable."""
    acts, people = [], [p for p in (event.get("participants") or []) if p]
    decisions = [i for i in ex.insights if i.kind == "decision"]
    commits = [i for i in ex.insights if i.kind == "commitment"]
    risks = [i for i in ex.insights if i.kind == "risk"]
    for d in decisions[:1]:
        owner = next((c.owner for c in commits if c.owner), None)
        acts.append({"kind": "jira.create_issue", "title": "Create Jira ticket",
                     "detail": f"{d.text}" + (f" · assign {owner}" if owner else ""),
                     "params": {"summary": d.text[:120], "description": f"From “{event['title']}”.\n\n{ex.summary}", "assignee": owner}})
    if decisions or commits:
        lines = [f"Decision: {d.text}" for d in decisions] + [
            f"{c.owner or 'Someone'}: {c.text}" + (f" (due {c.due})" if c.due else "") for c in commits]
        acts.append({"kind": "slack.post_message", "title": f"Post in #{settings.slack_channel}",
                     "detail": "Share the outcome with the team",
                     "params": {"channel": settings.slack_channel, "text": f"From {event['title']}:\n• " + "\n• ".join(lines)}})
    if risks or (decisions and commits):
        topic = (risks[0].text if risks else decisions[0].text)[:60]
        start = _next_weekday()
        acts.append({"kind": "calendar.create_event", "title": "Schedule follow-up",
                     "detail": f"Follow-up: {topic} · {start.replace('T', ' ')} · {', '.join(people[:4])}",
                     "params": {"title": f"Follow-up: {topic}", "start": start, "duration_minutes": 30, "attendees": people[:6],
                                "description": f"Follow-up from “{event['title']}”."}})
    n_d, n_c = len(decisions), len(commits)
    note = (f"{event['title']} finished. {n_d} decision{'s' * (n_d != 1)} and {n_c} commitment{'s' * (n_c != 1)} found; "
            f"{len(acts)} action{'s' * (len(acts) != 1)} waiting for you.") if acts else f"{event['title']}: {ex.summary}"
    return Proposal(notification=note, actions=acts)


async def propose(event: dict, ex: Extraction) -> Proposal:
    stored = (event.get("meta") or {}).get("_proposal")
    if llm.mode() == "offline":
        return Proposal.model_validate(stored) if stored else _rule_based(event, ex)
    related = await graph.search(f"{ex.account or ''} {ex.intent} {event['title']}", limit=10)
    related = [r for r in related if r.get("event_id") != event["id"]]
    open_c = db.q("SELECT text, owner, due FROM commitments WHERE status='open' AND (account=? OR ? IS NULL) LIMIT 10",
                  (ex.account, ex.account))
    prompt = (f"EVENT ({event['source']}): {event['title']} on {event['occurred_at'][:10]}\n"
              f"People: {', '.join(event.get('participants') or [])}\nSummary: {ex.summary}\nIntent: {ex.intent}\n"
              "Insights:\n" + "\n".join(f"- {i.kind}: {i.text} (owner {i.owner or '?'}, due {i.due or '?'})" for i in ex.insights)
              + "\n\nRELATED CONTEXT FROM THE KNOWLEDGE GRAPH:\n" + ("\n".join(f"- {r['fact']}" for r in related) or "- none")
              + "\n\nOPEN COMMITMENTS:\n" + ("\n".join(f"- {c['owner']}: {c['text']} (due {c['due']})" for c in open_c) or "- none"))
    try:
        return await llm.generate_json(prompt, Proposal, PROPOSE_SYSTEM.format(
            channel=settings.slack_channel, project=settings.jira_project, today=datetime.now().strftime("%A %Y-%m-%d"),
            feedback=actions.feedback_summary()))
    except Exception as e:
        log.warning("propose fell back for %s: %s", event["id"], e)
        return Proposal.model_validate(stored) if stored else _rule_based(event, ex)


def _bare(title: str) -> str:
    return re.sub(r"^[A-Z][A-Z0-9]+-\d+\s+", "", title or "").strip().lower()


def already_known(ev: dict) -> bool:
    """True when a synced item matches a seeded one (same tool, same title or same opening text)."""
    for r in db.q("SELECT title, body FROM events WHERE source=?", (ev["source"],)):
        if _bare(r["title"]) == _bare(ev["title"]) or (ev.get("body") and r["body"][:60] == ev["body"][:60]):
            return True
    return False


def store_event(ev: dict, dedupe: bool = False) -> bool:
    """Insert a normalized event. Returns False if it was already known."""
    if db.one("SELECT id FROM events WHERE id=?", (ev["id"],)) or (dedupe and already_known(ev)):
        return False
    db.insert("events", {"id": ev["id"], "source": ev["source"], "agent_id": SOURCE_AGENT.get(ev["source"], "stag"),
                         "title": ev["title"], "body": ev.get("body", ""), "summary": "", "occurred_at": ev["occurred_at"],
                         "account": ev.get("account"), "participants": ev.get("participants") or [], "url": ev.get("url"),
                         "meta": ev.get("meta") or {}, "importance": 0, "processed": 0})
    return True


async def process_event(event_id: str, historical: bool = False, wait_graph: bool = False) -> dict:
    """Run one event through the pipeline. `historical` = learn from it but do not propose or notify."""
    event = db.one("SELECT * FROM events WHERE id=?", (event_id,))
    ex = await extract(event, prefer_stored=historical)
    account = ex.account or event.get("account")
    db.update("events", event_id, {"summary": ex.summary, "importance": ex.importance, "account": account, "processed": 1})
    db.x("DELETE FROM insights WHERE event_id=?", (event_id,))
    db.x("DELETE FROM commitments WHERE event_id=?", (event_id,))
    for ins in ex.insights:
        db.insert("insights", {"id": db.new_id("ins"), "event_id": event_id, "kind": ins.kind, "text": ins.text,
                               "owner": ins.owner, "due": ins.due})
        if ins.kind == "commitment":
            db.insert("commitments", {"id": db.new_id("com"), "event_id": event_id, "text": ins.text, "owner": ins.owner,
                                      "due": ins.due, "status": (event.get("meta") or {}).get("commitment_status", "open"),
                                      "agent_id": event["agent_id"], "account": account, "created_at": event["occurred_at"]})
    await graph.add_episode(event, ex, wait=wait_graph)
    result = {"event_id": event_id, "insights": len(ex.insights), "proposal_id": None}
    if historical:
        return result
    notify.publish("timeline", {"id": event_id})
    if ex.importance >= 3 and ex.insights:
        prop = await propose(event, ex)
        saved = actions.add_proposal(event_id, [a.model_dump() if hasattr(a, "model_dump") else a for a in prop.actions])
        result["proposal_id"] = saved["id"] if saved else None
        notify.notify(event["agent_id"], prop.notification, event_id)
    elif ex.importance >= 3:
        notify.notify(event["agent_id"], f"{event['title']}: {ex.summary}", event_id)
    return result
