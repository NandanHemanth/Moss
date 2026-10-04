"""The grove: one orchestrator (Stag) and five tool agents, built on Google ADK.

Each agent owns its tools (its data access) and shares the memory tools. Writes never execute here:
every write tool queues an action for manager approval. Employees may talk to a single tool agent;
only managers may talk to Stag, who can call every agent.
"""
import contextvars
import logging
import os
import time
from datetime import date, datetime, timedelta

from . import actions, cache, connectors, db, graph, llm
from .config import AGENTS, settings

log = logging.getLogger("moss.agents")
_ctx: contextvars.ContextVar[dict] = contextvars.ContextVar("moss_ctx")
_services: dict = {}


def _c() -> dict:
    try:
        return _ctx.get()
    except LookupError:  # called outside ask(), e.g. through the AG-UI endpoint (managers only)
        c = {"user": db.one("SELECT * FROM users WHERE role='manager' LIMIT 1"), "sources": [], "queued": [], "event_ids": None}
        _ctx.set(c)
        return c


def _src(agent_id: str, label: str, url: str | None = None, event_id: str | None = None) -> None:
    item = {"agent_id": agent_id, "label": label, "url": url, "event_id": event_id}
    if item not in _c()["sources"]:
        _c()["sources"].append(item)


def _queue(kind: str, title: str, detail: str, params: dict) -> str:
    prop = actions.add_proposal(None, [{"kind": kind, "title": title, "detail": detail, "params": params}],
                                requested_by=_c()["user"]["id"])
    _c()["queued"].append(prop["actions"][0]["id"])
    return "Queued for manager approval. Nothing has been sent or created yet."


# ----------------------------------------------------------------- memory tools (shared)
async def recall(query: str, account: str = "", since: str = "", until: str = "") -> list[dict]:
    """Search Moss's knowledge graph for facts, decisions, commitments and risks.

    Args:
        query: What to look for, in plain words.
        account: Optional customer or project name to restrict to.
        since: Optional ISO date; only facts on or after it.
        until: Optional ISO date; only facts on or before it.
    """
    c = _c()
    facts = await graph.search(query, account or None, since or None, (until + "T23:59:59") if until else None,
                               limit=12, event_ids=c["event_ids"])
    c["facts"] = c.get("facts", 0) + len(facts)
    for f in facts:
        if f.get("event_title"):
            _src(db.one("SELECT agent_id FROM events WHERE id=?", (f["event_id"],))["agent_id"],
                 f"{f['event_title']} · {(f['valid_at'] or '')[:10]}", f.get("event_url"), f["event_id"])
    return [{"fact": f["fact"], "date": (f["valid_at"] or "")[:10], "source": f.get("event_title") or "knowledge graph"}
            for f in facts]


async def open_commitments(owner: str = "", account: str = "") -> list[dict]:
    """List open commitments (things people agreed to do).

    Args:
        owner: Optional first name to filter by.
        account: Optional customer or project to filter by.
    """
    c = _c()
    rows = db.q("SELECT text, owner, due, account, event_id FROM commitments WHERE status='open' ORDER BY due")
    if c["user"]["role"] != "manager":
        owner = c["user"]["name"].split()[0]
    return [r for r in rows if (not owner or owner.lower() in (r["owner"] or "").lower())
            and (not account or account.lower() in (r["account"] or "").lower())]


# ----------------------------------------------------------------- Raven: Gmail + Calendar
async def search_email(query: str = "") -> list[dict]:
    """Search email. Args: query: words to look for; empty returns the latest mail."""
    rows = await connectors.gmail().search(query, 8)
    for r in rows[:4]:
        _src("raven", f"Email: {r['subject']}", r.get("url"))
    return rows


async def upcoming_events(days: int = 7) -> list[dict]:
    """List calendar events for the next days. Args: days: how many days ahead."""
    return await connectors.calendar().list_events(days)


async def propose_calendar_event(title: str, start: str, duration_minutes: int = 30, attendees: str = "") -> str:
    """Queue a calendar event for manager approval.

    Args:
        title: Event title.
        start: Start as ISO datetime, e.g. 2026-10-08T10:00.
        duration_minutes: Length in minutes.
        attendees: Comma-separated names or emails.
    """
    people = [a.strip() for a in attendees.split(",") if a.strip()]
    return _queue("calendar.create_event", "Schedule meeting", f"{title} · {start.replace('T', ' ')} · {', '.join(people)}",
                  {"title": title, "start": start, "duration_minutes": duration_minutes, "attendees": people})


async def propose_email_draft(to: str, subject: str, body: str) -> str:
    """Queue an email draft for manager approval. Args: to: recipient; subject: subject line; body: plain text body."""
    return _queue("gmail.create_draft", "Draft email", f"To {to}: {subject}", {"to": to, "subject": subject, "body": body})


# ----------------------------------------------------------------- Firefly: Slack
async def read_channel(channel: str = "") -> list[dict]:
    """Read recent Slack messages. Args: channel: channel name without #; empty reads all joined channels."""
    rows = await connectors.slack().history(channel or None, 20)
    if rows:
        _src("firefly", f"Slack {rows[0].get('channel') or ''}".strip(), rows[0].get("url"))
    return rows


async def propose_slack_message(channel: str, text: str) -> str:
    """Queue a Slack message for manager approval. Args: channel: channel name; text: the message."""
    return _queue("slack.post_message", f"Post in #{channel.lstrip('#')}", text[:140], {"channel": channel.lstrip("#"), "text": text})


# ----------------------------------------------------------------- Fox: Jira
async def search_issues(text: str = "") -> list[dict]:
    """Search Jira issues. Args: text: words to look for; empty returns recent issues."""
    rows = await connectors.jira().search(text, 10)
    for r in rows[:4]:
        _src("fox", f"{r['key']} · {r['status']}", r.get("url"))
    return rows


async def propose_jira_issue(summary: str, description: str = "", assignee: str = "") -> str:
    """Queue a new Jira issue for manager approval. Args: summary: title; description: details; assignee: person's name."""
    return _queue("jira.create_issue", "Create Jira ticket", summary + (f" · assign {assignee}" if assignee else ""),
                  {"summary": summary, "description": description, "assignee": assignee or None})


# ----------------------------------------------------------------- Owl: meetings
async def list_meetings() -> list[dict]:
    """List meetings Moss has read, newest first."""
    c = _c()
    rows = db.q("SELECT id, title, occurred_at, account, summary FROM events WHERE source='meeting' ORDER BY occurred_at DESC LIMIT 15")
    return [r for r in rows if c["event_ids"] is None or r["id"] in c["event_ids"]]


async def meeting_notes(meeting_id: str) -> dict:
    """Get the summary, decisions, commitments and risks of one meeting. Args: meeting_id: id from list_meetings."""
    c = _c()
    ev = db.one("SELECT id, title, occurred_at, summary, participants, url FROM events WHERE id=?", (meeting_id,))
    if not ev or (c["event_ids"] is not None and ev["id"] not in c["event_ids"]):
        return {"error": "No such meeting, or you were not part of it."}
    _src("owl", f"{ev['title']} · {ev['occurred_at'][:10]}", ev.get("url"), ev["id"])
    return {**ev, "insights": db.q("SELECT kind, text, owner, due FROM insights WHERE event_id=?", (meeting_id,))}


# ----------------------------------------------------------------- Tortoise: Confluence
async def search_pages(text: str = "") -> list[dict]:
    """Search Confluence pages. Args: text: words to look for."""
    rows = await connectors.confluence().search(text, 8)
    for r in rows[:4]:
        _src("tortoise", f"Page: {r['title']}", r.get("url"))
    return rows


async def propose_confluence_page(title: str, body: str) -> str:
    """Queue a new Confluence page for manager approval. Args: title: page title; body: page text."""
    return _queue("confluence.create_page", "Create Confluence page", title, {"title": title, "body": body})


TOOLS = {
    "raven": [search_email, upcoming_events, propose_calendar_event, propose_email_draft],
    "firefly": [read_channel, propose_slack_message],
    "fox": [search_issues, propose_jira_issue],
    "owl": [list_meetings, meeting_notes],
    "tortoise": [search_pages, propose_confluence_page],
}
COMMON = """Today is {today}. Answer from tool results only; if the tools return nothing relevant, say you found nothing.
Never invent names, dates, ticket keys or quotes. Be brief: a short paragraph or a few bullets.
You cannot change anything directly: write tools only queue an action for manager approval, so say it is waiting for approval."""


def _instruction(agent_id: str) -> str:
    a = AGENTS[agent_id]
    if agent_id == "stag":
        return (f"You are {a['name']}, {a['epithet']}, orchestrator of Moss, an enterprise knowledge platform. "
                "Use `recall` first for questions about what was discussed, decided or promised. "
                "Delegate to the agent that owns the tool when you need fresh data or an action: "
                "raven (email, calendar), firefly (Slack), fox (Jira), owl (meetings), tortoise (Confluence). "
                "When asked what to do next, name concrete actions and queue them through the owning agent.\n" + COMMON)
    return (f"You are {a['name']}, {a['epithet']}, the Moss agent for {a['tool']}. {a['description']} "
            "You only handle your own tool; for anything else, say which agent to ask.\n" + COMMON)


def build(model=None, *, cache_key: str = "primary") -> dict:
    """Build the agent tree once per model. Returns {agent_id: LlmAgent}."""
    if cache_key in _services:
        return _services[cache_key]
    from google.adk.agents import LlmAgent
    from google.adk.tools.agent_tool import AgentTool
    if settings.gemini_key:
        os.environ["GOOGLE_API_KEY"] = settings.gemini_key   # ADK reads this name; keep it equal to Moss's key
    model = model or settings.gemini_model
    today = date.today().strftime("%A %Y-%m-%d")
    tree = {aid: LlmAgent(name=aid, model=model, description=f"{AGENTS[aid]['tool']}: {AGENTS[aid]['description']}",
                          instruction=_instruction(aid).format(today=today), tools=[*tools, recall, open_commitments])
            for aid, tools in TOOLS.items()}
    tree["stag"] = LlmAgent(name="stag", model=model, description=AGENTS["stag"]["description"],
                            instruction=_instruction("stag").format(today=today),
                            tools=[recall, open_commitments, *[AgentTool(agent=a) for a in tree.values()]])
    _services[cache_key] = tree
    return tree


def _fallback_model():
    from google.adk.models.lite_llm import LiteLlm
    return LiteLlm(model=f"openai/{settings.fallback_model}", api_base=settings.fallback_base_url, api_key=settings.fallback_key)


async def _run(tree: dict, agent_id: str, message: str, user: dict, session_id: str, tag: str) -> tuple[str, list[str]]:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
    svc = _services.setdefault(f"sessions:{tag}", InMemorySessionService())
    sid = f"{agent_id}:{session_id}"
    if not await svc.get_session(app_name="moss", user_id=user["id"], session_id=sid):
        await svc.create_session(app_name="moss", user_id=user["id"], session_id=sid)
    runner = Runner(agent=tree[agent_id], app_name="moss", session_service=svc)
    answer, trace = "", []
    async for ev in runner.run_async(user_id=user["id"], session_id=sid,
                                     new_message=types.Content(role="user", parts=[types.Part(text=message)])):
        trace += [fc.name for fc in ev.get_function_calls()]
        if ev.is_final_response() and ev.content and ev.content.parts:
            answer = "".join(p.text or "" for p in ev.content.parts)
    return answer.strip(), trace


def visible_event_ids(user: dict) -> set[str] | None:
    """Managers see everything (None). Employees see events they took part in."""
    if user["role"] == "manager":
        return None
    first = user["name"].split()[0].lower()
    return {r["id"] for r in db.q("SELECT id, participants FROM events")
            if any(first in (p or "").lower() for p in (r["participants"] or []))}


async def _offline_answer(agent_id: str, message: str, c: dict) -> str:
    """No LLM reachable: answer straight from memory so the demo never dead-ends."""
    m = message.lower()
    if any(w in m for w in ("commitment", "next step", "assigned", "owe", "promised", "todo", "to do")):
        rows = await open_commitments()
        if rows:
            return "Open commitments:\n" + "\n".join(f"• {r['owner'] or 'Unassigned'}: {r['text']}"
                                                      + (f" (due {r['due']})" if r["due"] else "") for r in rows[:8])
    since = ""
    if "last month" in m:
        first = date.today().replace(day=1)
        since = (first - timedelta(days=1)).replace(day=1).isoformat()
    facts = await recall(message, since=since)
    if not facts:
        return "I found nothing about that in what I am allowed to see."
    return "Here is what I know:\n" + "\n".join(f"• {f['fact']} ({f['date']})" for f in facts[:7])


async def ask(agent_id: str, message: str, user: dict, session_id: str = "default") -> dict:
    c = {"user": user, "sources": [], "queued": [], "event_ids": visible_event_ids(user), "facts": 0}
    token = _ctx.set(c)
    started, before = time.perf_counter(), dict(cache.stats)
    route, trace, answer = "offline", [], ""
    try:
        if settings.gemini_key:
            for model in llm.model_chain():
                try:
                    answer, trace = await _run(build(model, cache_key=f"gemini:{model}"), agent_id, message, user,
                                               session_id, model)
                    if answer:
                        route = f"gemini:{model}"
                        llm.state["last_route"] = route
                        break
                except Exception as e:
                    llm.mark_down(model, e)
                    log.warning("Gemini chat on %s failed, trying next: %s", model, str(e)[:160])
        if not answer and llm.has_fallback():
            try:
                answer, trace = await _run(build(_fallback_model(), cache_key="fallback"), agent_id, message, user,
                                           session_id, "fallback")
                route = f"fallback:{settings.fallback_model}"
            except Exception as e:
                llm.state["fallback_errors"] += 1
                llm.state["last_error"] = f"fallback chat: {e}"[:300]
                log.warning("Fallback chat failed: %s", e)
        if not answer:
            answer, route, trace = await _offline_answer(agent_id, message, c), "offline", ["recall"]
        memory = {"ms": round((time.perf_counter() - started) * 1000),
                  "cache_hits": cache.stats["hits"] - before["hits"], "cache_misses": cache.stats["misses"] - before["misses"],
                  "graph_facts": c["facts"], "tools": sorted({s["agent_id"] for s in c["sources"]}),
                  "store_reads": sum(t in ("open_commitments", "list_meetings", "meeting_notes") for t in trace)}
        return {"agent_id": agent_id, "answer": answer, "sources": c["sources"][:8], "trace": trace,
                "queued_actions": c["queued"], "route": route, "memory": memory}
    finally:
        _ctx.reset(token)
