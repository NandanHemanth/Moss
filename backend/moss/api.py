"""HTTP API for the Moss frontend. Roles are enforced here, not in the UI."""
import asyncio
import logging
import time
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from . import actions, agents, cache, connectors, dashboard, db, graph, llm, notify, pipeline, seed, voice, workflows
from .config import AGENTS, settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("moss.api")


AUTO_TOOLS = ("gmail", "slack", "jira", "confluence")   # calendar is pulled on Sync only: future events are not "news"
POLL = {"enabled": False, "every_seconds": settings.poll_seconds, "runs": 0, "last_run": None, "last_new": 0,
        "triggered": 0, "errors": {}, "watching": []}
STARTED_LOCAL = (datetime.now() - timedelta(minutes=2)).isoformat(timespec="seconds")


async def _pull(tools) -> tuple[list[str], dict]:
    """Fetch from connectors and store anything new. Returns (new event ids, errors by tool)."""
    new, errors = [], {}
    for tool in tools:
        try:
            for ev in await connectors.get(tool).fetch_events():
                if pipeline.store_event(ev, dedupe=True):
                    new.append(ev["id"])
        except Exception as e:
            errors[tool] = " ".join(str(e).split())[:220]
    return new, errors


async def _poll_loop():
    """Watch live tools. Items that arrived after the server started run through the pipeline at once, so an incoming
    email or Slack message produces proposals for the manager without anyone clicking Sync. Older items wait for Sync."""
    await asyncio.sleep(4)
    while True:
        try:
            live = [t for t in AUTO_TOOLS if connectors.get(t).mode == "live"]
            POLL.update(enabled=bool(live), watching=live)
            if live:
                new, errors = await _pull(live)
                marks = ",".join("?" * len(AUTO_TOOLS))
                fresh = db.q(f"SELECT id FROM events WHERE processed=0 AND occurred_at>=? AND source IN ({marks}) "
                             "ORDER BY occurred_at LIMIT 3", (STARTED_LOCAL, *AUTO_TOOLS))
                for row in fresh:
                    await pipeline.process_event(row["id"])
                POLL.update(runs=POLL["runs"] + 1, last_run=db.now(), last_new=len(new), errors=errors,
                            triggered=POLL["triggered"] + len(fresh))
                if new:
                    notify.publish("timeline", {"new": len(new)})
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never let the watcher die
            POLL["errors"] = {"poller": str(e)[:200]}
            log.warning("poll failed: %s", e)
        await asyncio.sleep(max(settings.poll_seconds, 10))


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not db.one("SELECT id FROM users LIMIT 1"):
        await seed.load()
    task = asyncio.create_task(_poll_loop()) if settings.poll_seconds > 0 else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Moss", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def access_gate(request: Request, call_next):
    """Optional shared access code for a hosted demo (set MOSS_ACCESS_CODE). The role switcher is not real login."""
    path = request.url.path
    if settings.access_code and request.method != "OPTIONS" and path.startswith(("/api/", "/agui/")) and path != "/api/health":
        if (request.headers.get("x-moss-code") or request.query_params.get("code")) != settings.access_code:
            return JSONResponse({"detail": "access code required"}, status_code=401)
    return await call_next(request)


app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ auth
def current_user(request: Request, user: str | None = Query(default=None)) -> dict:
    uid = request.headers.get("x-moss-user") or user
    row = db.one("SELECT * FROM users WHERE id=?", (uid,)) if uid else None
    if not row:
        raise HTTPException(401, "Unknown user. Send the X-Moss-User header.")
    return row


def manager(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "manager":
        raise HTTPException(403, "Managers only.")
    return user


def _first(user: dict) -> str:
    return user["name"].split()[0].lower()


# ------------------------------------------------------------------ identity + status
@app.get("/api/health")
def health():
    return {"ok": True, "locked": bool(settings.access_code)}


@app.get("/api/users")
def users():
    return db.q("SELECT id, name, role, title FROM users ORDER BY role DESC, name")


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return user


@app.get("/api/agents")
def list_agents(user: dict = Depends(current_user)):
    modes = connectors.modes()
    tool_mode = {"raven": f"{modes['gmail']}/{modes['calendar']}", "firefly": modes["slack"], "fox": modes["jira"],
                 "owl": modes["meeting"], "tortoise": modes["confluence"], "stag": llm.mode()}
    why = {"raven": connectors.reason("gmail") or connectors.reason("calendar"), "firefly": connectors.reason("slack"),
           "fox": connectors.reason("jira"), "tortoise": connectors.reason("confluence"),
           "stag": None if llm.mode() != "offline" else "No GEMINI_API_KEY in backend/.env, so Stag answers from memory only."}
    return [{"id": aid, **a, "mode": tool_mode[aid], "reason": why.get(aid),
             "allowed": user["role"] == "manager" or not a["manager_only"]} for aid, a in AGENTS.items()]


@app.get("/api/status")
def status(_: dict = Depends(current_user)):
    count = lambda t: db.one(f"SELECT count(*) AS n FROM {t}")["n"]  # noqa: E731
    return {"llm": llm.snapshot(), "graph": graph.snapshot(), "cache": cache.snapshot(), "connectors": connectors.modes(),
            "voice": "elevenlabs" if settings.elevenlabs_key else "browser", "voice_detail": voice.state,
            "counts": {t: count(t) for t in ("events", "facts", "commitments", "proposals", "notifications")},
            "backlog": db.one("SELECT count(*) AS n FROM events WHERE processed=0")["n"], "watch": POLL}


# ------------------------------------------------------------------ proposals + actions
def _can_see(user: dict, proposal: dict) -> bool:
    if user["role"] == "manager":
        return True
    ev = proposal.get("event")
    if ev and any(_first(user) in (p or "").lower() for p in ev.get("participants") or []):
        return True
    return any(a.get("requested_by") == user["id"] for a in proposal["actions"])


@app.get("/api/proposals")
def proposals(status: str | None = "pending", user: dict = Depends(current_user)):
    return [p for p in actions.list_proposals(None if status in ("all", "") else status) if _can_see(user, p)]


class Decision(BaseModel):
    decision: str  # approve | skip
    title: str | None = None
    detail: str | None = None
    params: dict | None = None


@app.post("/api/actions/{action_id}/decide")
async def decide(action_id: str, body: Decision, user: dict = Depends(manager)):
    if body.decision not in ("approve", "skip"):
        raise HTTPException(422, "decision must be approve or skip")
    try:
        return await actions.decide(action_id, body.decision, user, body.model_dump(exclude={"decision"}, exclude_none=True))
    except KeyError:
        raise HTTPException(404, "No such action")


@app.post("/api/proposals/{proposal_id}/approve-all")
async def approve_all(proposal_id: str, user: dict = Depends(manager)):
    prop = actions.get_proposal(proposal_id)
    if not prop:
        raise HTTPException(404, "No such proposal")
    for a in prop["actions"]:
        if a["status"] == "pending":
            await actions.decide(a["id"], "approve", user)
    return actions.get_proposal(proposal_id)


# ------------------------------------------------------------------ commitments, timeline, accounts, graph
@app.get("/api/commitments")
def commitments(status: str = "open", account: str | None = None, user: dict = Depends(current_user)):
    rows = db.q("SELECT c.*, e.title AS event_title FROM commitments c LEFT JOIN events e ON e.id=c.event_id "
                "WHERE (?='all' OR c.status=?) ORDER BY c.due IS NULL, c.due", (status, status))
    if user["role"] != "manager":
        rows = [r for r in rows if _first(user) in (r["owner"] or "").lower()]
    return [r for r in rows if not account or (r["account"] or "").lower() == account.lower()]


class CommitmentPatch(BaseModel):
    status: str  # open | done


@app.patch("/api/commitments/{cid}")
def patch_commitment(cid: str, body: CommitmentPatch, user: dict = Depends(current_user)):
    row = db.one("SELECT * FROM commitments WHERE id=?", (cid,))
    if not row:
        raise HTTPException(404, "No such commitment")
    if user["role"] != "manager" and _first(user) not in (row["owner"] or "").lower():
        raise HTTPException(403, "You can only update your own commitments.")
    db.update("commitments", cid, {"status": body.status})
    db.audit(user["id"], "commitment.update", f"{cid} -> {body.status}")
    return db.one("SELECT * FROM commitments WHERE id=?", (cid,))


@app.get("/api/timeline")
def timeline(account: str | None = None, source: str | None = None, limit: int = 60, user: dict = Depends(current_user)):
    rows = db.q("SELECT id, source, agent_id, title, summary, occurred_at, account, participants, url, importance "
                "FROM events WHERE processed=1 ORDER BY occurred_at DESC LIMIT 400")
    visible = agents.visible_event_ids(user)
    out = [r for r in rows if (visible is None or r["id"] in visible)
           and (not account or (r["account"] or "").lower() == account.lower()) and (not source or r["source"] == source)]
    return out[:limit]


@app.get("/api/accounts")
def accounts(_: dict = Depends(current_user)):
    rows = db.q("SELECT * FROM accounts ORDER BY kind, name")
    for r in rows:
        r["open_commitments"] = db.one("SELECT count(*) AS n FROM commitments WHERE status='open' AND account=?", (r["name"],))["n"]
        r["events"] = db.one("SELECT count(*) AS n FROM events WHERE account=?", (r["name"],))["n"]
    return rows


@app.get("/api/graph")
def graph_view(user: dict = Depends(current_user)):
    return graph.export(agents.visible_event_ids(user))


# ------------------------------------------------------------------ notifications + voice + stream
@app.get("/api/notifications")
def notifications(limit: int = 20, _: dict = Depends(manager)):
    rows = db.q("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,))
    return [{**r, "agent_name": AGENTS[r["agent_id"]]["name"]} for r in rows]


@app.get("/api/notifications/{nid}/audio")
async def notification_audio(nid: str, _: dict = Depends(manager)):
    row = db.one("SELECT text FROM notifications WHERE id=?", (nid,))
    if not row:
        raise HTTPException(404, "No such notification")
    audio = await cache.get_or_set("tts", nid, 3600, lambda: voice.synthesize(row["text"]))
    if not audio:
        return Response(status_code=204)  # client falls back to the browser's speech synthesis
    return Response(content=audio, media_type="audio/mpeg")


class Speak(BaseModel):
    text: str


@app.post("/api/speak")
async def speak(body: Speak, user: dict = Depends(current_user)):
    """Read a short text aloud on request (for example the stakeholder summary). 204 = use the browser's voice."""
    text = " ".join(body.text.split())[:900]
    if not text:
        raise HTTPException(422, "Nothing to read.")
    audio = await cache.get_or_set("tts", cache.key_of("speak", text), 3600, lambda: voice.synthesize(text))
    db.audit(user["id"], "speak", text[:80])
    return Response(content=audio, media_type="audio/mpeg") if audio else Response(status_code=204)


@app.get("/api/sfx/{name}")
async def sfx(name: str, _: dict = Depends(current_user)):
    """A grove creature's sound (stag, fox, owl, raven, tortoise, firefly). 204 = no sound available; synthesise one."""
    if name not in voice.SFX:
        raise HTTPException(404, "No such sound")
    audio = await voice.sound_effect(name)
    if not audio:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


def music_file() -> Path | None:
    """The grove's music: GROVE_MUSIC, else the first .mp3 in backend/data/music, else in the backend folder."""
    if settings.grove_music:
        path = Path(settings.grove_music)
        return path if path.is_file() else None
    root = Path(__file__).resolve().parents[1]
    for folder in (root / "data" / "music", root):
        found = sorted(folder.glob("*.mp3"))
        if found:
            return found[0]
    return None


@app.get("/api/music")
async def music(_: dict = Depends(current_user)):
    """Music for "View the grove". 204 = no audio file on this machine."""
    path = music_file()
    if not path:
        return Response(status_code=204)
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/stream")
async def stream(request: Request, user: dict = Depends(current_user)):
    queue = notify.subscribe(user)

    async def gen():
        try:
            yield "event: ready\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            notify.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ ask
class Ask(BaseModel):
    agent_id: str
    message: str
    session_id: str = "default"


@app.post("/api/ask")
async def ask(body: Ask, user: dict = Depends(current_user)):
    if body.agent_id not in AGENTS:
        raise HTTPException(404, "No such agent")
    if AGENTS[body.agent_id]["manager_only"] and user["role"] != "manager":
        raise HTTPException(403, f"{AGENTS[body.agent_id]['name']} answers to managers only.")
    db.audit(user["id"], "ask", f"{body.agent_id}: {body.message[:120]}")
    return await agents.ask(body.agent_id, body.message, user, body.session_id)


# ------------------------------------------------------------------ dashboard tiles
@app.get("/api/dashboard")
def dashboard_tiles(user: dict = Depends(current_user)):
    return dashboard.tiles(user)


@app.get("/api/dashboard/brief")
async def dashboard_brief(user: dict = Depends(current_user)):
    return await dashboard.brief(user)


# ------------------------------------------------------------------ asking HR, Finance or DevOps for help
@app.post("/api/escalations/{esc_id}/draft")
async def draft_escalation(esc_id: str, user: dict = Depends(manager)):
    try:
        return await actions.draft_help(esc_id, user)
    except KeyError:
        raise HTTPException(404, "No such help request")


# ------------------------------------------------------------------ canvas workflows (managers)
class WorkflowBody(BaseModel):
    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    graph: dict | None = None


class GenerateBody(BaseModel):
    prompt: str


class RunBody(BaseModel):
    input: str = ""
    queue: bool = False
    graph: dict | None = None      # run the canvas as it is on screen, even if unsaved
    name: str | None = None


@app.get("/api/workflows/node-types")
def workflow_node_types(_: dict = Depends(manager)):
    return [{**n, "agent_name": AGENTS[n["agent_id"]]["name"] if n["agent_id"] else None} for n in workflows.NODE_TYPES]


@app.get("/api/workflows")
def workflow_list(_: dict = Depends(manager)):
    return workflows.list_all()


@app.post("/api/workflows")
def workflow_create(body: WorkflowBody, user: dict = Depends(manager)):
    return workflows.save(None, body.model_dump(), user)


@app.post("/api/workflows/generate")
async def workflow_generate(body: GenerateBody, user: dict = Depends(manager)):
    if not body.prompt.strip():
        raise HTTPException(422, "Describe the workflow first.")
    llm.actor.set((user["id"], "stag"))
    db.audit(user["id"], "workflow.generate", body.prompt[:120])
    return await workflows.generate(body.prompt)


@app.put("/api/workflows/{wid}")
def workflow_update(wid: str, body: WorkflowBody, user: dict = Depends(manager)):
    if not workflows.get(wid):
        raise HTTPException(404, "No such workflow")
    return workflows.save(wid, body.model_dump(), user)


@app.delete("/api/workflows/{wid}")
def workflow_delete(wid: str, user: dict = Depends(manager)):
    workflows.delete(wid, user)
    return {"deleted": wid}


@app.post("/api/workflows/{wid}/run")
async def workflow_run(wid: str, body: RunBody, user: dict = Depends(manager)):
    """Try a workflow on some text. With queue=true its actions go to the approval queue; otherwise it is a dry run."""
    wf = workflows.get(wid) if wid != "draft" else {"id": None, "name": body.name or "Draft", "graph": {"nodes": [], "edges": []}}
    if not wf:
        raise HTTPException(404, "No such workflow")
    if body.graph is not None:
        wf = {**wf, "graph": workflows.clean_graph(body.graph), "name": body.name or wf["name"]}
    llm.actor.set((user["id"], "stag"))
    return await workflows.run(wf, text=body.input, queue=body.queue, user=user)


# ------------------------------------------------------------------ memory: what each layer is for, with live numbers
@app.get("/api/memory")
def memory(user: dict = Depends(current_user)):
    visible = agents.visible_event_ids(user)
    facts = [f for f in db.q("SELECT f.object_type, f.account, f.event_id, e.source FROM facts f LEFT JOIN events e ON e.id=f.event_id")
             if visible is None or f["event_id"] in visible]
    per_account: dict[str, dict] = {}
    for f in facts:
        if f["account"]:
            a = per_account.setdefault(f["account"], {"account": f["account"], "tools": set(), "facts": 0})
            a["facts"] += 1
            if f["source"]:
                a["tools"].add(f["source"])
    cross = sorted(({**a, "tools": sorted(a["tools"])} for a in per_account.values()), key=lambda a: (-len(a["tools"]), -a["facts"]))
    count = lambda t: db.one(f"SELECT count(*) AS n FROM {t}")["n"]  # noqa: E731
    decided = {r["status"]: r["n"] for r in db.q("SELECT status, count(*) AS n FROM actions GROUP BY status")}
    audit = db.q("SELECT ts, user_id, action, detail FROM audit ORDER BY ts DESC LIMIT 8") if user["role"] == "manager" else []
    return {
        "cache": cache.snapshot(),
        "graph": {**graph.snapshot(), "facts": len(facts), "by_type": dict(Counter(f["object_type"] for f in facts)),
                  "by_tool": dict(Counter(f["source"] or "moss" for f in facts)), "cross_tool": cross[:6]},
        "store": {"tables": {t: count(t) for t in ("events", "insights", "commitments", "proposals", "actions", "notifications", "audit")},
                  "decisions": decided, "recent_audit": audit},
        "llm": llm.snapshot(),
    }


class Compare(BaseModel):
    question: str
    with_llm: bool = False


@app.post("/api/memory/compare")
async def memory_compare(body: Compare, user: dict = Depends(current_user)):
    """Answer one question three ways so the value of each memory layer is measurable."""
    visible = agents.visible_event_ids(user)
    q = body.question.strip()
    words = [w for w in graph._tokens(q)]

    # 0. No memory: hand the model every raw document that mentions a keyword.
    t = time.perf_counter()
    docs = [e for e in db.q("SELECT id, source, title, body FROM events") if (visible is None or e["id"] in visible)
            and any(w in f"{e['title']} {e['body']}".lower() for w in words)]
    raw = {"documents": len(docs), "chars": sum(len(d["title"]) + len(d["body"]) for d in docs),
           "ms": round((time.perf_counter() - t) * 1000, 2), "sample": [d["title"] for d in docs[:5]],
           "tools": sorted({d["source"] for d in docs})}
    raw["tokens"] = raw["chars"] // 4

    # 2. Knowledge graph, cold (cache cleared), then 1. the same lookup again through the cache.
    cache.invalidate("graph")
    t = time.perf_counter()
    facts = await graph.search(q, limit=12, event_ids=visible)
    cold = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    await graph.search(q, limit=12, event_ids=visible)
    warm = (time.perf_counter() - t) * 1000
    g = {"facts": len(facts), "chars": sum(len(f["fact"]) for f in facts), "ms": round(cold, 2),
         "tools": sorted({f["event_source"] for f in facts if f.get("event_source")}),
         "sample": [{"fact": f["fact"], "date": (f["valid_at"] or "")[:10], "source": f.get("event_title")} for f in facts[:6]]}
    g["tokens"] = g["chars"] // 4
    c = {"cold_ms": round(cold, 2), "warm_ms": round(warm, 3), "speedup": round(cold / warm, 1) if warm > 0 else None}

    # LLM answer from graph facts, twice: the second call is served by the cache.
    answer = None
    if body.with_llm and llm.mode() != "offline" and facts:
        prompt = ("Answer the question in two sentences using only these facts.\nQuestion: " + q + "\nFacts:\n"
                  + "\n".join(f"- {f['fact']} ({(f['valid_at'] or '')[:10]})" for f in facts))
        try:
            t = time.perf_counter()
            text = await llm.generate_text(prompt)
            first = (time.perf_counter() - t) * 1000
            t = time.perf_counter()
            await llm.generate_text(prompt)
            second = (time.perf_counter() - t) * 1000
            answer = {"text": text, "first_ms": round(first), "repeat_ms": round(second, 2), "route": llm.state["last_route"]}
        except Exception as e:
            answer = {"error": str(e)[:160]}

    # 3. SQLite: exact state and accountability the graph does not hold.
    accounts = {f["account"] for f in facts if f.get("account")}
    commits = [r for r in db.q("SELECT text, owner, due, account, status FROM commitments WHERE status='open' ORDER BY due IS NULL, due")
               if r["account"] in accounts and (user["role"] == "manager" or _first(user) in (r["owner"] or "").lower())]
    store = {"open_commitments": commits[:5],
             "approved_actions": db.one("SELECT count(*) AS n FROM actions WHERE status='executed'")["n"],
             "audit_entries": db.one("SELECT count(*) AS n FROM audit")["n"]}
    saving = round(100 * (1 - g["tokens"] / raw["tokens"])) if raw["tokens"] else 0
    return {"question": q, "raw": raw, "graph": g, "cache": c, "store": store, "llm_answer": answer, "context_saving_percent": saving}


# ------------------------------------------------------------------ ingest
@app.get("/api/demo/queue")
def demo_queue(_: dict = Depends(manager)):
    return [{"id": e["id"], "title": e["title"], "source": e["source"]} for e in seed.demo_queue()]


class DemoTrigger(BaseModel):
    id: str | None = None


@app.post("/api/demo/meeting-ended")
async def demo_meeting(body: DemoTrigger, user: dict = Depends(manager)):
    """Simulate "a meeting just ended": ingest the next seeded transcript and run the pipeline."""
    pending = seed.demo_queue()
    ev = next((e for e in pending if body.id in (None, e["id"])), None)
    if not ev:
        raise HTTPException(404, "No seeded meetings left. Re-run the seeder to reset.")
    pipeline.store_event(seed.materialize(ev))
    db.audit(user["id"], "demo.meeting", ev["id"])
    return await pipeline.process_event(ev["id"])


def _hint(tool: str, message: str) -> str:
    """Turn an upstream error into the next thing the user should do."""
    m = message.lower()
    if "missing_scope" in m:
        return ("Slack app is missing a permission. api.slack.com/apps → your app → OAuth & Permissions → add the scope "
                "named above under Bot Token Scopes → Reinstall to Workspace → restart the backend.")
    if "not_in_channel" in m or "channel_not_found" in m:
        return "Invite the bot to the channel (type /invite @your-app-name in it), or check SLACK_DEFAULT_CHANNEL."
    if tool == "confluence" and (" 401 " in m or " 403 " in m):
        return ("If Jira is live the token is fine. Open your-site/wiki signed in as ATLASSIAN_EMAIL; if Confluence is "
                "missing, add it (free) at admin.atlassian.com → Products. Then run: python -m moss.doctor")
    if tool == "confluence" and "not found" in m:
        return "Set CONFLUENCE_SPACE to a real space key. `python -m moss.doctor` lists the keys it can see."
    if any(w in m for w in (" 401 ", "invalid_auth", "expired", "revoked", "not_authed")):
        return "Credentials were rejected. Re-check this tool's values in backend/.env and restart the backend."
    return "Run `python -m moss.doctor` in the backend folder for details."


SYNC_BATCH = 5  # events understood per click, to stay inside free LLM quotas


@app.post("/api/sync")
async def sync(user: dict = Depends(manager)):
    """Pull new items from every live connector, then run the oldest-waiting items through the pipeline."""
    new, errors = await _pull(("gmail", "calendar", "slack", "jira", "confluence"))
    backlog = [r["id"] for r in db.q("SELECT id FROM events WHERE processed=0 ORDER BY occurred_at DESC")]
    results = []
    for eid in backlog[:SYNC_BATCH]:
        try:
            results.append(await pipeline.process_event(eid))
        except Exception as e:
            errors["pipeline"] = " ".join(str(e).split())[:220]
            break
    db.audit(user["id"], "sync", f"{len(new)} new, {len(results)} processed")
    return {"new": len(new), "processed": results, "deferred": max(len(backlog) - len(results), 0),
            "errors": errors, "hints": {tool: _hint(tool, msg) for tool, msg in errors.items()}}


# ------------------------------------------------------------------ AG-UI (streaming protocol) for Stag
try:
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from fastapi import APIRouter

    if settings.gemini_key:
        _router = APIRouter(dependencies=[Depends(manager)])
        add_adk_fastapi_endpoint(_router, ADKAgent(adk_agent=agents.build()["stag"], app_name="moss", user_id="maya",
                                                   use_in_memory_services=True), path="/agui/stag")
        app.include_router(_router)
except Exception as e:  # AG-UI is optional; the REST ask endpoint is the default path
    log.warning("AG-UI endpoint not mounted: %s", e)


# ------------------------------------------------------------------ serve the built frontend (one process to deploy)
_dist = settings.frontend_dist
if (_dist / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "agui/", "assets/")) and not (_dist / path).is_file():
            raise HTTPException(404, "Not found")
        target = (_dist / path).resolve()
        if path and target.is_file() and _dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_dist / "index.html")
