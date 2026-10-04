"""HTTP API for the Moss frontend. Roles are enforced here, not in the UI."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from . import actions, agents, cache, connectors, db, graph, llm, notify, pipeline, seed, voice
from .config import AGENTS, settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("moss.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not db.one("SELECT id FROM users LIMIT 1"):
        await seed.load()
    yield


app = FastAPI(title="Moss", version="0.1.0", lifespan=lifespan)
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
    return [{"id": aid, **a, "mode": tool_mode[aid], "allowed": user["role"] == "manager" or not a["manager_only"]}
            for aid, a in AGENTS.items()]


@app.get("/api/status")
def status(_: dict = Depends(current_user)):
    count = lambda t: db.one(f"SELECT count(*) AS n FROM {t}")["n"]  # noqa: E731
    return {"llm": llm.snapshot(), "graph": graph.snapshot(), "cache": cache.snapshot(), "connectors": connectors.modes(),
            "voice": "elevenlabs" if settings.elevenlabs_key else "browser",
            "counts": {t: count(t) for t in ("events", "facts", "commitments", "proposals", "notifications")}}


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


@app.post("/api/sync")
async def sync(user: dict = Depends(manager)):
    """Pull new items from every live connector and run up to 5 of them through the pipeline."""
    new, errors = [], {}
    for tool in ("gmail", "calendar", "slack", "jira", "confluence"):
        try:
            for ev in await connectors.get(tool).fetch_events():
                if pipeline.store_event(ev, dedupe=True):
                    new.append(ev["id"])
        except Exception as e:
            errors[tool] = str(e)[:200]
    results = [await pipeline.process_event(eid) for eid in new[:5]]
    db.audit(user["id"], "sync", f"{len(new)} new")
    return {"new": len(new), "processed": results, "deferred": len(new) - len(results), "errors": errors}


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
