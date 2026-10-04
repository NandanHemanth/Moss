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
