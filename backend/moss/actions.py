"""The approval queue. Agents propose; a manager approves, edits or skips; only then does anything execute."""
import re
from datetime import datetime

from . import connectors, db, graph, notify
from .config import AGENTS, settings
from .schemas import KIND_AGENT


def add_proposal(event_id: str | None, actions: list[dict], requested_by: str | None = None) -> dict | None:
    """actions: [{kind, title, detail, params}]. Returns the stored proposal, or None if nothing to propose."""
    actions = [a for a in actions if a["kind"] in KIND_AGENT]
    if not actions:
        return None
    pid = db.new_id("prop")
    db.insert("proposals", {"id": pid, "event_id": event_id, "created_at": db.now(), "status": "pending"})
    for i, a in enumerate(actions):
        params = {k: v for k, v in (a.get("params") or {}).items() if v not in (None, "", [])}
        db.insert("actions", {"id": db.new_id("act"), "proposal_id": pid, "agent_id": KIND_AGENT[a["kind"]],
                              "kind": a["kind"], "title": a["title"], "detail": a["detail"], "params": params,
                              "status": "pending", "requested_by": requested_by, "position": i})
    proposal = get_proposal(pid)
    notify.publish("proposal", {"id": pid})
    return proposal


def get_proposal(pid: str) -> dict | None:
    p = db.one("SELECT * FROM proposals WHERE id=?", (pid,))
    if not p:
        return None
    p["actions"] = db.q("SELECT * FROM actions WHERE proposal_id=? ORDER BY position", (pid,))
    p["event"] = db.one("SELECT id,source,agent_id,title,summary,occurred_at,account,participants,url,meta FROM events "
                        "WHERE id=?", (p["event_id"],)) if p["event_id"] else None
    p["insights"] = db.q("SELECT kind,text,owner,due FROM insights WHERE event_id=?", (p["event_id"],)) if p["event_id"] else []
    p["escalations"] = db.q("SELECT id, team, reason, subject, body, status, result FROM escalations WHERE proposal_id=? ORDER BY created_at", (pid,))
    by = next((a["requested_by"] for a in p["actions"] if (a.get("requested_by") or "").startswith("workflow:")), None)
    p["workflow"] = by.split(":", 1)[1] if by else None
    return p


HELP_WORDS = {"DevOps": ("keys", "rotate", "rotation", "staging", "deploy", "outage", "rollback", "infrastructure", "incident", "latency", "server"),
              "Finance": ("budget", "pricing", "invoice", "spend", "discount", "billing", "purchase"),
              "HR": ("hire", "hiring", "headcount", "capacity", "staffing", "contractor", "understaffed", "onboarding")}


def rule_help(event: dict, insights: list) -> list[dict]:
    """Offline stand-in for the model's judgement: suggest outside help only when a risk or request names the area."""
    out = []
    for team, words in HELP_WORDS.items():
        hit = next((i for i in insights if i.kind in ("risk", "request") and any(w in i.text.lower() for w in words)), None)
        if hit:
            out.append({"team": team, "reason": hit.text, "subject": f"Help needed: {event['title']}"[:120],
                        "body": f"Hi {team} team,\n\nIn “{event['title']}” this came up: {hit.text}\n\n"
                                "Could you help us with it, or tell us who can? Happy to give more detail.\n\nThanks"})
    return out


def save_help(proposal_id: str, helps: list[dict]) -> None:
    for h in helps[:3]:
        if h.get("team") in settings.help_emails:
            db.insert("escalations", {"id": db.new_id("esc"), "proposal_id": proposal_id, "team": h["team"], "reason": h.get("reason", ""),
                                      "subject": h.get("subject", ""), "body": h.get("body", ""), "status": "suggested", "created_at": db.now()})


async def draft_help(esc_id: str, user: dict) -> dict:
    """The manager asked for it: create an email draft to HR, Finance or DevOps. A draft only; nothing is sent."""
    esc = db.one("SELECT * FROM escalations WHERE id=?", (esc_id,))
    if not esc:
        raise KeyError(esc_id)
    if esc["status"] == "suggested":
        try:
            res = await connectors.gmail().create_draft(settings.help_emails[esc["team"]], esc["subject"], esc["body"])
            db.update("escalations", esc_id, {"status": "drafted", "result": res})
            notify.notify("raven", f"Raven drafted an email to {esc['team']}: {esc['subject']}.")
        except Exception as e:
            db.update("escalations", esc_id, {"status": "failed", "result": {"error": str(e)[:300]}})
        db.audit(user["id"], "help.draft", f"{esc_id} {esc['team']}")
        notify.publish("proposal", {"id": esc["proposal_id"]})
    return db.one("SELECT id, proposal_id, team, reason, subject, body, status, result FROM escalations WHERE id=?", (esc_id,))


def list_proposals(status: str | None = "pending") -> list[dict]:
    sql = "SELECT id FROM proposals" + (" WHERE status=?" if status else "") + " ORDER BY created_at DESC LIMIT 50"
    return [get_proposal(r["id"]) for r in db.q(sql, (status,) if status else ())]


async def _execute(action: dict) -> dict:
    p, kind = action["params"] or {}, action["kind"]
    if kind == "jira.create_issue":
        summary = re.sub(r"^[A-Z][A-Z0-9]+-\d+[:\s-]+", "", p.get("summary") or action["title"]).strip()  # drop an invented key
        return await connectors.jira().create_issue(summary, p.get("description") or action["detail"], p.get("assignee"))
    if kind == "slack.post_message":
        channel, text = (p.get("channel") or settings.slack_channel).lstrip("#"), p.get("text") or action["detail"]
        try:
            return await connectors.slack().post_message(channel, text)
        except Exception as e:  # the proposed channel does not exist: use the default one instead of failing the approval
            default = settings.slack_channel.lstrip("#")
            if "channel_not_found" not in str(e) or channel == default:
                raise
            out = await connectors.slack().post_message(default, text)
            return {**out, "text": f"{out.get('text', 'Posted')} (#{channel} does not exist)"}
    if kind == "calendar.create_event":
        return await connectors.calendar().create_event(p.get("title") or action["title"], p.get("start") or "",
                                                        int(p.get("duration_minutes") or 30), p.get("attendees") or [],
                                                        p.get("description") or "")
    if kind == "gmail.create_draft":
        return await connectors.gmail().create_draft(p.get("to") or "", p.get("subject") or action["title"], p.get("body") or "")
    if kind == "confluence.create_page":
        return await connectors.confluence().create_page(p.get("title") or action["title"], p.get("body") or action["detail"])
    raise ValueError(f"unknown action kind {kind}")


_OWN = {"jira.create_issue": ("jira", "key"), "calendar.create_event": ("calendar", "id"),
        "confluence.create_page": ("confluence", "id")}


def _remember_own(action: dict, result: dict) -> None:
    """File what Moss just created as a known, already-understood event, so the next sync or poll does not
    treat Moss's own ticket/page/event as news and propose actions about it (no feedback loops)."""
    tool, id_field = _OWN.get(action["kind"], (None, None))
    if not tool or connectors.get(tool).mode != "live" or not result.get(id_field):
        return
    p = action["params"] or {}
    name = p.get("summary") or p.get("title") or action["title"]
    title = f"{result[id_field]} {name}" if tool == "jira" else name
    prop = db.one("SELECT event_id FROM proposals WHERE id=?", (action["proposal_id"],))
    parent = db.one("SELECT account FROM events WHERE id=?", (prop["event_id"],)) if prop and prop["event_id"] else None
    meta = {"by_moss": True, "key": result.get("key"), "status": "To Do", "assignee": p.get("assignee"), "start": p.get("start")}
    db.insert("events", {"id": f"{tool}:{result[id_field]}", "source": tool, "agent_id": action["agent_id"], "title": title,
                         "body": p.get("description") or p.get("body") or action["detail"] or "", "summary": f"Created by Moss after approval. {result.get('text', '')}".strip(),
                         "occurred_at": datetime.now().isoformat(timespec="seconds"), "account": parent["account"] if parent else None,
                         "participants": [p["assignee"]] if p.get("assignee") else [], "url": result.get("url"),
                         "meta": {k: v for k, v in meta.items() if v is not None}, "importance": 2, "processed": 1})


def _close_if_done(pid: str) -> None:
    left = db.one("SELECT count(*) AS n FROM actions WHERE proposal_id=? AND status='pending'", (pid,))["n"]
    if left == 0:
        db.update("proposals", pid, {"status": "done"})


async def decide(action_id: str, decision: str, user: dict, edits: dict | None = None) -> dict:
    action = db.one("SELECT * FROM actions WHERE id=?", (action_id,))
    if not action:
        raise KeyError(action_id)
    if action["status"] != "pending":
        return action  # idempotent: a second click never executes twice
    if edits:
        merged = {**(action["params"] or {}), **(edits.get("params") or {})}
        db.update("actions", action_id, {"params": merged, **{k: edits[k] for k in ("title", "detail") if edits.get(k)}})
        action = db.one("SELECT * FROM actions WHERE id=?", (action_id,))
    stamp = {"decided_by": user["id"], "decided_at": db.now()}
    if decision == "skip":
        db.update("actions", action_id, {"status": "skipped", **stamp})
    else:
        db.update("actions", action_id, {"status": "approved", **stamp})  # claimed before the external call
        try:
            result = await _execute(action)
            db.update("actions", action_id, {"status": "executed", "result": result})
            _remember_own(action, result)
            agent = AGENTS[action["agent_id"]]["name"]
            prop = db.one("SELECT event_id FROM proposals WHERE id=?", (action["proposal_id"],))
            ev = db.one("SELECT title, account FROM events WHERE id=?", (prop["event_id"],)) if prop and prop["event_id"] else None
            graph.add_link(prop["event_id"] if prop else None, ev["title"] if ev else "Chat request", "led to",
                           result.get("text", action["title"]), "action", ev["account"] if ev else None)
            notify.notify(action["agent_id"], f"{agent} finished: {result.get('text', action['title'])}.")
        except Exception as e:
            db.update("actions", action_id, {"status": "failed", "result": {"error": str(e)[:300]}})
    db.audit(user["id"], f"action.{decision}", f"{action_id} {action['kind']}")
    _close_if_done(action["proposal_id"])
    out = db.one("SELECT * FROM actions WHERE id=?", (action_id,))
    notify.publish("action", {"id": action_id, "status": out["status"], "proposal_id": action["proposal_id"]})
    return out


def feedback_summary() -> str:
    """What the manager has approved or skipped so far, fed back into the proposer."""
    rows = db.q("SELECT kind, status, count(*) AS n FROM actions WHERE status IN ('executed','skipped') GROUP BY kind, status")
    if not rows:
        return "No feedback yet."
    return "; ".join(f"{r['kind']}: {r['status']} {r['n']}×" for r in rows)
