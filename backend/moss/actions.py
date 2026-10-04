"""The approval queue. Agents propose; a manager approves, edits or skips; only then does anything execute."""
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
    return p


def list_proposals(status: str | None = "pending") -> list[dict]:
    sql = "SELECT id FROM proposals" + (" WHERE status=?" if status else "") + " ORDER BY created_at DESC LIMIT 50"
    return [get_proposal(r["id"]) for r in db.q(sql, (status,) if status else ())]


async def _execute(action: dict) -> dict:
    p, kind = action["params"] or {}, action["kind"]
    if kind == "jira.create_issue":
        return await connectors.jira().create_issue(p.get("summary") or action["title"], p.get("description") or action["detail"],
                                                    p.get("assignee"))
    if kind == "slack.post_message":
        return await connectors.slack().post_message(p.get("channel") or settings.slack_channel, p.get("text") or action["detail"])
    if kind == "calendar.create_event":
        return await connectors.calendar().create_event(p.get("title") or action["title"], p.get("start") or "",
                                                        int(p.get("duration_minutes") or 30), p.get("attendees") or [],
                                                        p.get("description") or "")
    if kind == "gmail.create_draft":
        return await connectors.gmail().create_draft(p.get("to") or "", p.get("subject") or action["title"], p.get("body") or "")
    if kind == "confluence.create_page":
        return await connectors.confluence().create_page(p.get("title") or action["title"], p.get("body") or action["detail"])
    raise ValueError(f"unknown action kind {kind}")


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
