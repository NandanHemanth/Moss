"""End-to-end check of the demo spine in offline mode (no keys, mock connectors)."""
import pytest
from fastapi.testclient import TestClient

from moss import db
from moss.api import app

MAYA, SAM = {"X-Moss-User": "maya"}, {"X-Moss-User": "sam"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_seed_loaded(client):
    s = client.get("/api/status", headers=MAYA).json()
    assert s["llm"]["mode"] == "offline" and s["graph"]["backend"] == "local"
    assert s["counts"]["events"] == 15 and s["counts"]["facts"] > 30
    assert set(s["connectors"].values()) == {"mock", "seeded"}
    raven = next(a for a in client.get("/api/agents", headers=MAYA).json() if a["id"] == "raven")
    assert raven["mode"] == "mock/mock" and raven["reason"]


def test_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=SAM).json()["role"] == "employee"
    assert client.get("/api/notifications", headers=SAM).status_code == 403
    assert client.post("/api/ask", headers=SAM, json={"agent_id": "stag", "message": "hi"}).status_code == 403
    agents = {a["id"]: a for a in client.get("/api/agents", headers=SAM).json()}
    assert agents["stag"]["allowed"] is False and agents["fox"]["allowed"] is True


def test_meeting_to_approved_actions(client):
    assert client.post("/api/demo/meeting-ended", headers=SAM, json={}).status_code == 403
    r = client.post("/api/demo/meeting-ended", headers=MAYA, json={}).json()
    assert r["proposal_id"] and r["insights"] == 7

    props = client.get("/api/proposals", headers=MAYA).json()
    prop = next(p for p in props if p["id"] == r["proposal_id"])
    assert [a["kind"] for a in prop["actions"]] == ["jira.create_issue", "slack.post_message", "calendar.create_event"]
    assert prop["event"]["title"] == "Platform sync" and len(prop["insights"]) == 7
    assert "{" not in prop["actions"][2]["params"]["start"]  # date placeholders resolved

    # Sam took part in the meeting: he can see the proposal but cannot decide.
    assert any(p["id"] == prop["id"] for p in client.get("/api/proposals", headers=SAM).json())
    jira = prop["actions"][0]
    assert client.post(f"/api/actions/{jira['id']}/decide", headers=SAM, json={"decision": "approve"}).status_code == 403

    done = client.post(f"/api/actions/{jira['id']}/decide", headers=MAYA, json={"decision": "approve"}).json()
    assert done["status"] == "executed" and done["result"]["key"] == "PLAT-139"
    again = client.post(f"/api/actions/{jira['id']}/decide", headers=MAYA, json={"decision": "approve"}).json()
    assert again["status"] == "executed" and len(db.q("SELECT id FROM outbox WHERE tool='jira'")) == 1  # no double execution

    skipped = client.post(f"/api/actions/{prop['actions'][1]['id']}/decide", headers=MAYA, json={"decision": "skip"}).json()
    assert skipped["status"] == "skipped"
    rest = client.post(f"/api/proposals/{prop['id']}/approve-all", headers=MAYA).json()
    assert rest["status"] == "done" and rest["actions"][2]["status"] == "executed"

    notes = client.get("/api/notifications", headers=MAYA).json()
    assert any("Platform sync finished" in n["text"] for n in notes) and any("PLAT-139" in n["text"] for n in notes)
    assert client.get(f"/api/notifications/{notes[0]['id']}/audio", headers=MAYA).status_code == 204


def test_commitments_scoped(client):
    all_c = client.get("/api/commitments", headers=MAYA).json()
    mine = client.get("/api/commitments", headers=SAM).json()
    assert len(all_c) > len(mine) > 0 and all("Sam" in c["owner"] for c in mine)
    other = next(c for c in all_c if "Sam" not in (c["owner"] or ""))
    assert client.patch(f"/api/commitments/{other['id']}", headers=SAM, json={"status": "done"}).status_code == 403
    assert client.patch(f"/api/commitments/{mine[0]['id']}", headers=SAM, json={"status": "done"}).json()["status"] == "done"


def test_ask_offline(client):
    a = client.post("/api/ask", headers=MAYA, json={"agent_id": "stag", "message": "What did we discuss with Harborline last month?"}).json()
    assert a["route"] == "offline" and "Harborline" in a["answer"] and a["sources"]
    b = client.post("/api/ask", headers=MAYA, json={"agent_id": "stag", "message": "Show me all customers interested in payroll integration"}).json()
    assert "Pinecrest" in b["answer"] and "Harborline" in b["answer"]


def test_timeline_and_graph_scoped(client):
    full = client.get("/api/timeline", headers=MAYA).json()
    part = client.get("/api/timeline", headers=SAM).json()
    assert len(full) > len(part) > 0 and all(any("Sam" in p for p in e["participants"]) for e in part)
    g = client.get("/api/graph", headers=MAYA).json()
    assert g["nodes"] and g["edges"]
    assert len(client.get("/api/accounts", headers=SAM).json()) == 5


@pytest.mark.asyncio
async def test_adk_agent_loop_with_fake_model(client):
    """The ADK wiring (agent tree, runner, tool call, final answer) works without a real model."""
    from google.adk.models import BaseLlm, LlmResponse
    from google.genai import types

    from moss import agents

    class Fake(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            said = any(p.function_response for c in llm_request.contents for p in (c.parts or []))
            part = types.Part(text="Two issues are assigned to Sam.") if said else \
                types.Part(function_call=types.FunctionCall(name="search_issues", args={"text": "provider"}))
            yield LlmResponse(content=types.Content(role="model", parts=[part]))

    tree = agents.build(Fake(model="fake"), cache_key="fake")
    assert set(tree) == {"stag", "raven", "firefly", "fox", "owl", "tortoise"} and len(tree["stag"].tools) == 7
    user = db.one("SELECT * FROM users WHERE id='sam'")
    token = agents._ctx.set({"user": user, "sources": [], "queued": [], "event_ids": agents.visible_event_ids(user)})
    try:
        answer, trace = await agents._run(tree, "fox", "What is assigned to me?", user, "t1", "fake")
        assert answer == "Two issues are assigned to Sam." and trace == ["search_issues"]
        assert any(s["agent_id"] == "fox" for s in agents._c()["sources"])
    finally:
        agents._ctx.reset(token)


def test_sync_works_through_backlog(client):
    from moss import pipeline
    for i in range(7):
        pipeline.store_event({"id": f"jira:TEST-{i}", "source": "jira", "title": f"TEST-{i} backlog item {i}",
                              "body": f"body {i}", "occurred_at": f"2026-10-01T10:0{i}", "participants": ["Sam Ortiz"]})
    first = client.post("/api/sync", headers=MAYA).json()
    assert len(first["processed"]) == 5 and first["deferred"] == 2 and first["errors"] == {} and first["hints"] == {}
    second = client.post("/api/sync", headers=MAYA).json()
    assert len(second["processed"]) == 2 and second["deferred"] == 0
    assert client.get("/api/status", headers=MAYA).json()["backlog"] == 0


def test_html_error_pages_become_short_messages():
    import httpx

    from moss.api import _hint
    from moss.connectors.live_common import error_text
    page = "<html><head><title>Unauthorized (401)</title><script>var contextPath = '';window.WRM=window.WRM||{};</script></head><body>x</body></html>"
    assert error_text(httpx.Response(401, text=page)) == "Unauthorized (401)"
    noisy = "<html><body><script>var a = 1;</script>(null) var contextPath = ''; window.WRM=window.WRM||{};</body></html>"
    assert "window" not in error_text(httpx.Response(401, text=noisy))
    assert "Reinstall" in _hint("slack", "Slack conversations.list: missing_scope (needs scope channels:read)")
    assert "admin.atlassian.com" in _hint("confluence", "Confluence 401 on GET /wiki/api/v2/spaces: Unauthorized")


async def test_gemini_falls_back_to_next_model(monkeypatch):
    from moss import cache, llm
    from moss.config import settings
    monkeypatch.setattr(settings, "gemini_key", "test-key")
    monkeypatch.setattr(settings, "gemini_model", "busy-model")
    monkeypatch.setattr(settings, "gemini_fallback_models", ["good-model", "other-model"])
    monkeypatch.setattr(llm, "_cooldown", {})
    cache.invalidate("llm")
    calls = []

    async def fake(prompt, system, model, schema):
        calls.append(model)
        if model == "busy-model":
            raise RuntimeError("503 UNAVAILABLE. This model is currently experiencing high demand.")
        return "pong"

    monkeypatch.setattr(llm, "_gemini_call", fake)
    assert await llm.generate_text("ping one") == "pong"
    assert calls == ["busy-model", "good-model"] and llm.state["last_route"] == "gemini:good-model"
    assert await llm.generate_text("ping two") == "pong"
    assert calls[2:] == ["good-model"], "the overloaded model is skipped while it cools down"
    assert llm.model_chain()[-1] == "busy-model"


def test_memory_layers_are_measurable(client):
    m = client.get("/api/memory", headers=MAYA).json()
    assert m["graph"]["facts"] > 30 and m["graph"]["cross_tool"][0]["tools"] and m["store"]["tables"]["events"] >= 15
    harbor = next(a for a in m["graph"]["cross_tool"] if a["account"] == "Harborline Freight")
    assert len(harbor["tools"]) >= 3, "one account is connected across several tools"
    r = client.post("/api/memory/compare", headers=MAYA, json={"question": "What did we discuss with Harborline last month?"}).json()
    assert r["raw"]["documents"] > 0 and 0 < r["graph"]["tokens"] < r["raw"]["tokens"] and r["context_saving_percent"] > 0
    assert r["cache"]["warm_ms"] < r["cache"]["cold_ms"] and r["llm_answer"] is None
    assert client.get("/api/memory", headers=SAM).json()["store"]["recent_audit"] == []
    a = client.post("/api/ask", headers=MAYA, json={"agent_id": "stag", "message": "What do we know about Pinecrest?"}).json()
    assert a["memory"]["graph_facts"] > 0 and "ms" in a["memory"]


async def test_request_email_gets_a_proposal_offline(client):
    from moss import actions, pipeline
    pipeline.store_event({"id": "gmail:test-1", "source": "gmail", "title": "Bug in payroll export", "occurred_at": "2026-10-04T01:00",
                          "body": "Hi, the payroll export drops the overtime column. Can you fix it by Friday?", "participants": ["Riya Shah"],
                          "meta": {"from_email": "riya@example.org", "_extraction": {"summary": "Riya reports the payroll export drops the overtime column and asks for a fix by Friday.",
                                   "intent": "Report a bug", "importance": 4, "account": None,
                                   "insights": [{"kind": "request", "text": "Fix the payroll export dropping the overtime column", "owner": None, "due": None}], "entities": []}}})
    out = await pipeline.process_event("gmail:test-1")
    kinds = [a["kind"] for a in actions.get_proposal(out["proposal_id"])["actions"]]
    assert "jira.create_issue" in kinds and "slack.post_message" in kinds


def test_dashboard_tiles_by_role(client):
    m = client.get("/api/dashboard", headers=MAYA).json()
    assert m["role"] == "manager" and m["burndown"]["source"] == "sample" and m["cloud"]["source"] == "sample"
    assert len(m["burndown"]["ideal"]) == m["burndown"]["length_days"] + 1 and m["team"]["people"] and "by_person" in m["tokens"]
    s = client.get("/api/dashboard", headers=SAM).json()
    assert s["role"] == "employee" and s["velocity"]["average"] > 0 and "cloud" not in s and "team" not in s
    assert all("Sam" in d["owner"] for d in s["deadlines"]["items"])
    b = client.get("/api/dashboard/brief", headers=SAM).json()
    assert b["source"] == "rules" and 0 < len(b["next_tasks"]) <= 3 and b["summary"] == []
    assert client.get("/api/dashboard/brief", headers=MAYA).json()["summary"]


def test_help_request_only_when_relevant(client):
    done = [p for p in client.get("/api/proposals?status=all", headers=MAYA).json() if p["event"] and p["event"]["title"] == "Platform sync"]
    esc = done[0]["escalations"]
    assert [e["team"] for e in esc] == ["DevOps"] and esc[0]["status"] == "suggested"
    assert client.post(f"/api/escalations/{esc[0]['id']}/draft", headers=SAM).status_code == 403
    out = client.post(f"/api/escalations/{esc[0]['id']}/draft", headers=MAYA).json()
    assert out["status"] == "drafted" and "devops@" in db.q("SELECT payload FROM outbox WHERE tool='gmail' ORDER BY created_at DESC LIMIT 1")[0]["payload"]
    assert client.post(f"/api/escalations/{esc[0]['id']}/draft", headers=MAYA).json()["status"] == "drafted"  # idempotent
    client.post("/api/demo/meeting-ended", headers=MAYA, json={})  # Harborline call: no outside help needed
    other = [p for p in client.get("/api/proposals?status=all", headers=MAYA).json() if p["event"] and "Harborline payroll" in p["event"]["title"]]
    assert other and other[0]["escalations"] == []


def test_canvas_workflow_build_run_and_trigger(client):
    assert client.get("/api/workflows", headers=SAM).status_code == 403
    kinds = {n["type"] for n in client.get("/api/workflows/node-types", headers=MAYA).json()}
    assert {"input", "gmail", "calendar", "slack", "jira", "confluence", "llm", "output"} <= kinds
    draft = client.post("/api/workflows/generate", headers=MAYA,
                        json={"prompt": "When an email reports a bug, create a Jira ticket and post it in Slack"}).json()
    types = [n["type"] for n in draft["graph"]["nodes"]]
    assert types[0] == "gmail" and types[-1] == "output" and "jira" in types and "slack" in types and "llm" in types
    assert len(draft["graph"]["edges"]) == len(types) - 1
    dry = client.post("/api/workflows/draft/run", headers=MAYA, json={"input": "The export is broken\nPlease fix it.", "graph": draft["graph"]}).json()
    assert dry["status"] == "ok" and dry["proposal_id"] is None
    assert [s["action"]["kind"] for s in dry["steps"] if s.get("action")] == ["jira.create_issue", "slack.post_message"]
    wf = client.post("/api/workflows", headers=MAYA, json={"name": "Bug mail to ticket", "graph": draft["graph"], "enabled": True}).json()
    assert wf["enabled"] is True and client.get("/api/workflows", headers=MAYA).json()[0]["id"] == wf["id"]
    queued = client.post(f"/api/workflows/{wf['id']}/run", headers=MAYA, json={"input": "Login page crashes", "queue": True}).json()
    prop = next(p for p in client.get("/api/proposals", headers=MAYA).json() if p["id"] == queued["proposal_id"])
    assert prop["workflow"] == "Bug mail to ticket" and len(prop["actions"]) == 2
    assert client.put(f"/api/workflows/{wf['id']}", headers=MAYA, json={"enabled": False}).json()["enabled"] is False
    assert client.delete(f"/api/workflows/{wf['id']}", headers=MAYA).json() == {"deleted": wf["id"]}


async def test_enabled_workflow_handles_matching_email(client):
    from moss import actions, pipeline, workflows
    maya = db.one("SELECT * FROM users WHERE id='maya'")
    draft = await workflows.generate("When an email reports a bug, create a Jira ticket and post it in Slack")
    draft["graph"]["nodes"][0]["trigger"] = "an email that reports a bug or something broken"
    wf = workflows.save(None, {"name": "Bug triage", "graph": draft["graph"], "enabled": True}, maya)
    pipeline.store_event({"id": "gmail:wf-1", "source": "gmail", "title": "Bug: export button broken", "occurred_at": "2026-10-04T02:00",
                          "body": "The export button is broken since this morning. This bug blocks our reports.", "participants": ["Riya Shah"],
                          "meta": {"from_email": "riya@example.org"}})
    out = await pipeline.process_event("gmail:wf-1")
    assert out["workflows"] == ["Bug triage"] and actions.get_proposal(out["proposal_id"])["workflow"] == "Bug triage"
    pipeline.store_event({"id": "gmail:wf-2", "source": "gmail", "title": "Lunch on Friday?", "occurred_at": "2026-10-04T02:05",
                          "body": "Are you free for lunch on Friday?", "participants": ["Riya Shah"], "meta": {}})
    assert "workflows" not in await pipeline.process_event("gmail:wf-2")
    workflows.delete(wf["id"], maya)


def test_access_code_gate(client, monkeypatch):
    from moss.config import settings
    monkeypatch.setattr(settings, "access_code", "grove")
    assert client.get("/api/health").json() == {"ok": True, "locked": True}
    assert client.get("/api/me", headers=MAYA).status_code == 401
    assert client.get("/api/me", headers={**MAYA, "X-Moss-Code": "grove"}).status_code == 200


def test_tokens_are_counted_per_person(client):
    from moss import llm
    llm.actor.set(("sam", "fox"))
    llm.record("test-model", 1200, "chat")
    assert client.get("/api/dashboard", headers=SAM).json()["tokens"]["total"] == 1200
    team = client.get("/api/dashboard", headers=MAYA).json()["tokens"]
    assert team["total"] >= 1200 and any(p["name"] == "Sam Ortiz" for p in team["by_person"])


def test_speak_and_sfx_fall_back_cleanly_without_a_key(client):
    assert client.post("/api/speak", headers=MAYA, json={"text": "The team shipped the endpoint."}).status_code == 204
    assert client.post("/api/speak", headers=MAYA, json={"text": "  "}).status_code == 422
    assert client.get("/api/sfx/owl", headers=SAM).status_code == 204
    assert client.get("/api/sfx/dragon", headers=SAM).status_code == 404


async def test_voice_falls_back_to_default_voice_and_caches_sfx(monkeypatch, tmp_path):
    import httpx

    from moss import voice
    from moss.config import settings
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/my-missing-voice"):
            return httpx.Response(404, json={"detail": {"status": "voice_not_found"}})
        return httpx.Response(200, content=b"ID3-audio")

    monkeypatch.setattr(voice, "_http", httpx.AsyncClient(base_url=voice.API, transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(settings, "elevenlabs_key", "k")
    monkeypatch.setattr(settings, "elevenlabs_voice", "my-missing-voice")
    monkeypatch.setattr(settings, "db_path", tmp_path / "moss.db")
    assert await voice.synthesize("hello") == b"ID3-audio"
    assert calls == ["/v1/text-to-speech/my-missing-voice", f"/v1/text-to-speech/{voice.DEFAULT_VOICE_ID}"]
    assert "not available" in voice.state["note"] and voice.state["voice"] == "default"
    assert await voice.sound_effect("owl") == b"ID3-audio" and (tmp_path / "sfx" / "owl.mp3").is_file()
    before = len(calls)
    assert await voice.sound_effect("owl") == b"ID3-audio" and len(calls) == before   # second time comes from disk
    assert await voice.sound_effect("dragon") is None
