"""Canvas workflows: flows a manager draws (or asks Stag to draw) from plain-language nodes.

A workflow is a small graph. The first node is a trigger (a tool that "listens", or a manual input); the nodes after it
are LLM steps and tool actions; the last is an output. Running one costs a single LLM call for the whole flow.
Tool actions are never executed here: they are queued for manager approval like every other write in Moss.
"""
import logging
import re
from datetime import datetime, timedelta

from . import actions, db, llm, notify
from .config import AGENTS, settings
from .schemas import ActionParams, Matches, WorkflowDraft, WorkflowResult

log = logging.getLogger("moss.workflows")
ACTION_KIND = {"gmail": "gmail.create_draft", "calendar": "calendar.create_event", "slack": "slack.post_message",
               "jira": "jira.create_issue", "confluence": "confluence.create_page"}
NODE_TYPES = [
    {"type": "input", "label": "Input", "agent_id": None, "can_trigger": True, "can_act": False, "hint": "Start by hand with any text."},
    {"type": "meeting", "label": "Meeting", "agent_id": "owl", "can_trigger": True, "can_act": False, "hint": "Starts when a meeting transcript arrives."},
    {"type": "gmail", "label": "Gmail", "agent_id": "raven", "can_trigger": True, "can_act": True, "hint": "Start on an email, or draft one."},
    {"type": "calendar", "label": "Calendar", "agent_id": "raven", "can_trigger": True, "can_act": True, "hint": "Start on an event, or schedule one."},
    {"type": "slack", "label": "Slack", "agent_id": "firefly", "can_trigger": True, "can_act": True, "hint": "Start on a message, or post one."},
    {"type": "jira", "label": "Jira", "agent_id": "fox", "can_trigger": True, "can_act": True, "hint": "Start on a ticket, or create one."},
    {"type": "confluence", "label": "Confluence", "agent_id": "tortoise", "can_trigger": True, "can_act": True, "hint": "Start on a page, or create one."},
    {"type": "llm", "label": "LLM", "agent_id": "stag", "can_trigger": False, "can_act": False, "hint": "Read, decide, summarise or rewrite."},
    {"type": "output", "label": "Output", "agent_id": None, "can_trigger": False, "can_act": False, "hint": "What the manager is told at the end."},
]
_TYPES = {n["type"] for n in NODE_TYPES}
_STOP = set("when a an the is are to of in on for and or with about that this it from new any arrives comes sent gets asks asking "
            "someone something email message ticket page meeting".split())

RUN_SYSTEM = """You are Stag, executing a workflow a manager drew on the Moss canvas. Work through the nodes in order.
For every node return what it produces. LLM nodes return text. Action nodes also return params:
jira (summary, description, assignee) · slack (channel without #, text) · calendar (title, start as ISO datetime, duration_minutes,
attendees, description) · gmail (to, subject, body) · confluence (title, body).
Follow each node's description exactly and use only facts present in the input.
Slack channel is {channel} unless a node names another one. Nothing has been created yet, so never mention ticket keys,
ids or links, and Jira summaries never contain a ticket key. Use full names as given. Today is {today}."""

GENERATE_SYSTEM = """You are Stag, designing a workflow for the Moss canvas from a manager's description.
Node types: input (manual start), meeting, gmail, calendar, slack, jira, confluence (each can be the trigger when first, or an
action when later), llm (reads, decides, summarises), output (always last).
Use 3 to 7 nodes in execution order. The first node is the trigger and states its condition in `trigger`. Put one llm node
before the actions when the flow needs understanding or a decision. Keep every field short and concrete."""


# ------------------------------------------------------------------ storage
def clean_graph(graph: dict | None) -> dict:
    nodes, seen = [], set()
    for n in (graph or {}).get("nodes") or []:
        if n.get("type") not in _TYPES or not n.get("id") or n["id"] in seen or len(nodes) >= 20:
            continue
        seen.add(n["id"])
        nodes.append({"id": str(n["id"]), "type": n["type"], "label": (n.get("label") or n["type"].title())[:60],
                      "x": float(n.get("x") or 0), "y": float(n.get("y") or 0),
                      **{k: (n.get(k) or "")[:600] for k in ("trigger", "description", "input", "output")}})
    edges = [{"id": str(e.get("id") or f"{e['source']}-{e['target']}"), "source": str(e["source"]), "target": str(e["target"])}
             for e in (graph or {}).get("edges") or []
             if e.get("source") in seen and e.get("target") in seen and e.get("source") != e.get("target")]
    return {"nodes": nodes, "edges": edges}


def _row(w: dict) -> dict:
    last = db.one("SELECT ts, status, proposal_id FROM workflow_runs WHERE workflow_id=? ORDER BY ts DESC LIMIT 1", (w["id"],))
    return {**w, "enabled": bool(w["enabled"]), "graph": w["graph"] or {"nodes": [], "edges": []}, "last_run": last}


def list_all() -> list[dict]:
    return [_row(w) for w in db.q("SELECT * FROM workflows ORDER BY updated_at DESC")]


def get(wid: str) -> dict | None:
    w = db.one("SELECT * FROM workflows WHERE id=?", (wid,))
    return _row(w) if w else None


def save(wid: str | None, fields: dict, user: dict) -> dict:
    data = {k: fields[k] for k in ("name", "description") if fields.get(k) is not None}
    if fields.get("graph") is not None:
        data["graph"] = clean_graph(fields["graph"])
    if fields.get("enabled") is not None:
        data["enabled"] = 1 if fields["enabled"] else 0
    data["updated_at"] = db.now()
    if wid:
        db.update("workflows", wid, data)
    else:
        wid = db.new_id("wf")
        db.insert("workflows", {"id": wid, "name": data.get("name") or "Untitled workflow", "description": data.get("description") or "",
                                "enabled": data.get("enabled", 0), "graph": data.get("graph") or {"nodes": [], "edges": []},
                                "created_by": user["id"], "updated_at": data["updated_at"]})
    db.audit(user["id"], "workflow.save", wid)
    return get(wid)


def delete(wid: str, user: dict) -> None:
    db.x("DELETE FROM workflows WHERE id=?", (wid,))
    db.x("DELETE FROM workflow_runs WHERE workflow_id=?", (wid,))
    db.audit(user["id"], "workflow.delete", wid)


# ------------------------------------------------------------------ graph helpers
def ordered(graph: dict) -> list[dict]:
    """Nodes in execution order (topological; ties broken left to right). Unconnected nodes are left out."""
    nodes = {n["id"]: n for n in graph["nodes"]}
    incoming = {i: 0 for i in nodes}
    for e in graph["edges"]:
        incoming[e["target"]] += 1
    linked = {e["source"] for e in graph["edges"]} | {e["target"] for e in graph["edges"]}
    ready = sorted([n for i, n in nodes.items() if incoming[i] == 0 and (i in linked or len(nodes) == 1)], key=lambda n: n["x"])
    out = []
    while ready:
        node = ready.pop(0)
        out.append(node)
        for e in graph["edges"]:
            if e["source"] == node["id"]:
                incoming[e["target"]] -= 1
                if incoming[e["target"]] == 0:
                    ready.append(nodes[e["target"]])
        ready.sort(key=lambda n: n["x"])
    return out


def role_of(node: dict, graph: dict) -> str:
    has_in = any(e["target"] == node["id"] for e in graph["edges"])
    if node["type"] in ("input", "meeting") or (node["type"] in ACTION_KIND and not has_in):
        return "trigger"
    return {"llm": "llm", "output": "output"}.get(node["type"], "action")


def trigger_of(graph: dict) -> dict | None:
    return next((n for n in ordered(graph) if role_of(n, graph) == "trigger"), None)


def _layout(drafts: list[dict]) -> dict:
    nodes = [{"id": f"n{i + 1}", "x": 60 + i * 270, "y": 140 + (40 if i % 2 else 0), **d} for i, d in enumerate(drafts)]
    return clean_graph({"nodes": nodes, "edges": [{"source": a["id"], "target": b["id"]} for a, b in zip(nodes, nodes[1:])]})


# ------------------------------------------------------------------ Stag builds a flow from a sentence
_WORDS = {"gmail": r"\b(e-?mails?|gmail|mail|inbox)\b", "slack": r"\b(slack|channel)\b", "jira": r"\b(jira|tickets?|issues?)\b",
          "confluence": r"\b(confluence|wiki|page|runbook)\b", "calendar": r"\b(calendar|schedule|invite)\b",
          "meeting": r"\b(meeting|call|transcript|zoom)\b"}
_TITLES = {"gmail": ("New email", "Draft email"), "slack": ("New Slack message", "Post to Slack"), "jira": ("New ticket", "Create ticket"),
           "confluence": ("Page updated", "Create page"), "calendar": ("New event", "Schedule event"), "meeting": ("Meeting ended", "")}


def _heuristic(prompt: str) -> WorkflowDraft:
    hits = sorted((m.start(), t) for t, pat in _WORDS.items() for m in [re.search(pat, prompt, re.I)] if m)
    types = list(dict.fromkeys(t for _, t in hits))
    first = types[0] if types else "input"
    nodes = [{"type": first, "label": _TITLES.get(first, ("Manual input",))[0], "trigger": prompt.strip()[:200],
              "description": "Starts the workflow.", "input": None, "output": "The item's text."},
             {"type": "llm", "label": "Understand it", "trigger": None, "description": "Read the input and work out what is being asked.",
              "input": "The item's text.", "output": "A short summary and what to do."}]
    for t in types[1:]:
        if t != "meeting":
            nodes.append({"type": t, "label": _TITLES[t][1], "trigger": None, "description": f"{_TITLES[t][1]} based on the summary.",
                          "input": "The summary.", "output": "Queued for manager approval."})
    nodes.append({"type": "output", "label": "Tell the manager", "trigger": None, "description": "Report what was prepared.",
                  "input": "Everything above.", "output": "One sentence."})
    return WorkflowDraft(name=" ".join(prompt.split()[:6]).strip(" .,") or "New workflow", description=prompt.strip()[:200], nodes=nodes)


async def generate(prompt: str) -> dict:
    draft, source = None, "rules"
    if llm.mode() != "offline":
        try:
            draft = await llm.generate_json(f"Design a workflow for this request:\n{prompt}", WorkflowDraft, GENERATE_SYSTEM)
            source = llm.state["last_route"] or "llm"
        except Exception as e:
            log.warning("workflow generation fell back to rules: %s", e)
    draft = draft or _heuristic(prompt)
    nodes = [n.model_dump() for n in draft.nodes][:8]
    if nodes and nodes[-1]["type"] != "output":
        nodes.append({"type": "output", "label": "Tell the manager", "trigger": None, "description": "Report what was prepared.",
                      "input": None, "output": "One sentence."})
    return {"name": draft.name[:80], "description": draft.description[:300], "graph": _layout(nodes), "source": source}


# ------------------------------------------------------------------ running
def _next_slot() -> str:
    d = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat(timespec="minutes")


def _offline_step(node: dict, role: str, text: str, event: dict | None) -> tuple[str, dict | None]:
    """Deterministic stand-in when no model is reachable, so a flow can still be tried end to end."""
    subject = re.search(r"^subject:\s*(.+)$", text, re.I | re.M)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not re.match(r"^(from|to|cc|date|subject):", ln.strip(), re.I)]
    first = (lines[0] if lines else node["label"])[:160]
    title = ((event or {}).get("title") or (subject.group(1).strip() if subject else first))[:110]
    body = "\n".join(lines)[:800] or text[:800]
    if role == "trigger":
        return text[:600], None
    if role == "llm":
        return f"{title}. {first}" if first != title else title, None
    if role == "output":
        return f"Workflow finished for “{title}”.", None
    t = node["type"]
    params = {"jira": {"summary": title, "description": body},
              "slack": {"channel": settings.slack_channel, "text": f"{title}\n{body[:500]}"},
              "calendar": {"title": f"Follow-up: {title}"[:90], "start": _next_slot(), "duration_minutes": 30,
                           "attendees": (event or {}).get("participants") or []},
              "gmail": {"to": ((event or {}).get("meta") or {}).get("from_email") or "", "subject": f"Re: {title}"[:120],
                        "body": f"Thanks for your message. We are on it.\n\n> {first}"},
              "confluence": {"title": title, "body": body}}[t]
    return f"{node['label']}: {title}"[:160], params


async def run(wf: dict, text: str | None = None, event: dict | None = None, queue: bool = False, user: dict | None = None) -> dict:
    graph = wf["graph"]
    nodes = ordered(graph)
    if not nodes:
        return {"workflow_id": wf.get("id"), "status": "empty", "steps": [], "summary": "Connect at least two nodes first.",
                "proposal_id": None, "route": None}
    text = text or (f"{event['title']}\n{event['body']}" if event else "")
    roles = {n["id"]: role_of(n, graph) for n in nodes}
    result, route = None, "offline"
    if llm.mode() != "offline":
        listing = "\n".join(f"- id {n['id']} · {n['type']} ({roles[n['id']]}) · {n['label']}: {n['description']}"
                            + (f" | input: {n['input']}" if n["input"] else "") + (f" | output: {n['output']}" if n["output"] else "")
                            for n in nodes)
        people = ", ".join((event or {}).get("participants") or []) or "n/a"
        sender = ((event or {}).get("meta") or {}).get("from_email") or "n/a"
        prompt = f"WORKFLOW “{wf.get('name', 'Untitled')}”\n{listing}\n\nPeople: {people}\nSender address: {sender}\n\nINPUT:\n{text[:8000]}"
        try:
            result = await llm.generate_json(prompt, WorkflowResult, RUN_SYSTEM.format(
                channel=settings.slack_channel, today=datetime.now().strftime("%A %Y-%m-%d")))
            route = llm.state["last_route"] or "llm"
        except Exception as e:
            log.warning("workflow run fell back to rules: %s", e)
    by_id = {s.node_id: s for s in result.steps} if result else {}
    steps, acts = [], []
    for n in nodes:
        role, got = roles[n["id"]], by_id.get(n["id"])
        out, params = _offline_step(n, role, text, event)
        if got and role != "trigger":
            out = got.output or out
            if role == "action" and got.params:
                given = {k: v for k, v in got.params.model_dump().items() if v not in (None, "", [])}
                params = {**(params or {}), **given}
        step = {"node_id": n["id"], "type": n["type"], "label": n["label"], "role": role, "output": out[:1200]}
        if role == "action":
            params = {k: v for k, v in ActionParams(**(params or {})).model_dump().items() if v not in (None, "", [])}
            step["action"] = {"kind": ACTION_KIND[n["type"]], "title": n["label"], "detail": out[:220], "params": params}
            acts.append(step["action"])
        steps.append(step)
    summary = (result.summary if result else None) or f"{len(acts)} action{'s' * (len(acts) != 1)} prepared by “{wf.get('name', 'workflow')}”."
    proposal_id = None
    if queue and acts:
        saved = actions.add_proposal(event["id"] if event else None, acts, requested_by=f"workflow:{wf.get('name', 'Untitled')}")
        proposal_id = saved["id"] if saved else None
    if wf.get("id"):
        db.insert("workflow_runs", {"id": db.new_id("run"), "workflow_id": wf["id"], "ts": db.now(),
                                    "trigger": (event or {}).get("id") or "manual", "status": "ok", "steps": steps, "proposal_id": proposal_id})
    if user:
        db.audit(user["id"], "workflow.run", f"{wf.get('id') or 'draft'} queue={queue}")
    return {"workflow_id": wf.get("id"), "status": "ok", "steps": steps, "summary": summary, "proposal_id": proposal_id, "route": route}


# ------------------------------------------------------------------ triggering from live events
def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z\-]{3,}", text.lower()) if w not in _STOP}


async def match(event: dict, summary: str = "") -> list[dict]:
    """Enabled workflows whose trigger tool is this event's source and whose condition fits it."""
    pool = []
    for wf in list_all():
        trig = trigger_of(wf["graph"]) if wf["enabled"] else None
        if trig and trig["type"] == event["source"]:
            pool.append((wf, (trig.get("trigger") or "").strip()))
    if not pool:
        return []
    always = [wf for wf, cond in pool if not cond]
    conditional = [(wf, cond) for wf, cond in pool if cond]
    hits = []
    if conditional and llm.mode() != "offline":
        try:
            listing = "\n".join(f"- {wf['id']}: {cond}" for wf, cond in conditional)
            found = await llm.generate_json(
                f"EVENT ({event['source']}): {event['title']}\n{summary}\n{event['body'][:1500]}\n\nTRIGGERS:\n{listing}", Matches,
                "Return the ids of the triggers whose condition this event clearly satisfies. Return none if unsure.", fast=True)
            hits = [wf for wf, _ in conditional if wf["id"] in found.workflow_ids]
            conditional = []
        except Exception as e:
            log.warning("workflow match fell back to keywords: %s", e)
    hay = _keywords(f"{event['title']} {summary} {event['body']}")
    for wf, cond in conditional:
        want = _keywords(cond)
        if want and len(want & hay) >= max(1, round(len(want) * 0.34)):
            hits.append(wf)
    return always + hits


async def run_for_event(event: dict, summary: str) -> dict | None:
    """Called by the pipeline. Returns {'proposal_id', 'names'} when a workflow handled the event."""
    matched = await match(event, summary)
    if not matched:
        return None
    proposal_id, names = None, []
    for wf in matched[:2]:
        out = await run(wf, event=event, queue=True)
        proposal_id = out["proposal_id"] or proposal_id
        names.append(wf["name"])
    agent = AGENTS[event["agent_id"]]["name"]
    notify.notify(event["agent_id"], f"{agent} picked up “{event['title']}”. Your workflow “{names[0]}” prepared the next steps for approval.",
                  event["id"])
    return {"proposal_id": proposal_id, "names": names}
