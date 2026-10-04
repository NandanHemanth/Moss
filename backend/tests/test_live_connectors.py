"""Live adapters against fake HTTP (httpx.MockTransport). No credentials, no network.

These tests pin the request shapes Moss sends and how responses are normalised. They cannot prove the real
services accept those requests; that needs a run with real accounts (docs/03-setup.md).
"""
import base64
import email
import json
from datetime import datetime

import httpx
import pytest

from moss import seed_live, voice
from moss.config import settings
from moss.connectors import live_google as g
from moss.connectors.live_atlassian import LiveConfluence, LiveJira, adf_text, to_adf, to_storage
from moss.connectors.live_slack import LiveSlack, SlackError

SITE = "https://tidewater.atlassian.net"


class Fake:
    """Routes requests to canned replies by (METHOD, path) and records every request."""

    def __init__(self, routes: dict):
        self.routes, self.calls = routes, []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        reply = self.routes.get((request.method, request.url.path))
        if reply is None:
            return httpx.Response(404, json={"errorMessages": [f"no route for {request.method} {request.url.path}"]})
        if callable(reply):
            reply = reply(request)
        return reply if isinstance(reply, httpx.Response) else httpx.Response(200, json=reply)

    def sent(self, path: str, method: str | None = None) -> list[httpx.Request]:
        return [c for c in self.calls if c.url.path == path and (method is None or c.method == method)]

    def paths(self) -> list[str]:
        return [c.url.path for c in self.calls]


def body(request: httpx.Request) -> dict:
    return json.loads(request.content)


@pytest.fixture
def atlassian(monkeypatch):
    monkeypatch.setattr(settings, "atlassian_site", SITE)
    monkeypatch.setattr(settings, "atlassian_email", "maya@tidewater.dev")
    monkeypatch.setattr(settings, "atlassian_token", "token-123")
    monkeypatch.setattr(settings, "jira_project", "PLAT")
    monkeypatch.setattr(settings, "confluence_space", "ENG")


@pytest.fixture
def slack_token(monkeypatch):
    monkeypatch.setattr(settings, "slack_bot_token", "xoxb-test")
    monkeypatch.setattr(settings, "slack_channel", "platform")


ISSUE = {"id": "10001", "key": "PLAT-7", "fields": {
    "summary": "Payroll export: CSV and API formats", "status": {"name": "In Progress"},
    "assignee": {"displayName": "Priya Raman", "accountId": "acc-priya"}, "reporter": {"displayName": "Maya Chen"},
    "updated": "2026-10-02T15:30:00.000+0000",
    "description": {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "CSV export is done in staging."}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "API format is not started."}]}]}}}


# ------------------------------------------------------------------------------------------------ Jira
def test_is_configured_follows_settings(atlassian, monkeypatch):
    assert LiveJira.is_configured() and LiveConfluence.is_configured() and LiveJira.mode == "live"
    monkeypatch.setattr(settings, "atlassian_token", "")
    assert not LiveJira.is_configured() and not LiveConfluence.is_configured()


async def test_jira_search_request_shape(atlassian):
    fake = Fake({("POST", "/rest/api/3/search/jql"): {"issues": [ISSUE], "isLast": True}})
    rows = await LiveJira(fake.transport).search("payroll export", limit=5)

    (req,) = fake.calls
    assert req.method == "POST" and req.url.path == "/rest/api/3/search/jql" and req.url.host == "tidewater.atlassian.net"
    assert req.headers["authorization"] == "Basic " + base64.b64encode(b"maya@tidewater.dev:token-123").decode()
    sent = body(req)
    assert sent["jql"] == 'project = "PLAT" AND (text ~ "payroll" OR text ~ "export") ORDER BY updated DESC'
    assert sent["maxResults"] == 5
    assert {"summary", "status", "assignee", "updated"} <= set(sent["fields"])  # the API returns only ids by default
    assert rows == [{"key": "PLAT-7", "summary": "Payroll export: CSV and API formats", "status": "In Progress",
                     "assignee": "Priya Raman", "url": f"{SITE}/browse/PLAT-7", "updated": rows[0]["updated"]}]
    datetime.fromisoformat(rows[0]["updated"])


async def test_jira_search_empty_text_is_bounded_and_recent(atlassian):
    fake = Fake({("POST", "/rest/api/3/search/jql"): {"issues": []}})
    assert await LiveJira(fake.transport).search("") == []
    assert body(fake.calls[0])["jql"] == 'project = "PLAT" ORDER BY updated DESC'  # a project clause bounds the query


async def test_jira_search_cannot_inject_jql(atlassian):
    fake = Fake({("POST", "/rest/api/3/search/jql"): {"issues": []}})
    await LiveJira(fake.transport).search('x" OR project = "SECRET')
    jql = body(fake.calls[0])["jql"]
    assert jql.count('"') % 2 == 0 and jql.startswith('project = "PLAT" AND (') and 'project = "SECRET"' not in jql


async def test_jira_search_by_issue_key_uses_direct_lookup(atlassian):
    fake = Fake({("GET", "/rest/api/3/issue/PLAT-7"): ISSUE})
    rows = await LiveJira(fake.transport).search("what is the status of plat-7?")
    assert [r["key"] for r in rows] == ["PLAT-7"] and fake.paths() == ["/rest/api/3/issue/PLAT-7"]


def _create_routes(issue_types, users):
    return {("GET", "/rest/api/3/issue/createmeta/PLAT/issuetypes"): {"issueTypes": issue_types},
            ("GET", "/rest/api/3/user/assignable/search"): users,
            ("POST", "/rest/api/3/issue"): httpx.Response(201, json={"id": "10042", "key": "PLAT-42", "self": "x"})}


TYPES = [{"id": "10003", "name": "Subtask", "subtask": True}, {"id": "10002", "name": "Epic", "subtask": False},
         {"id": "10001", "name": "Task", "subtask": False}]


async def test_jira_create_issue_adf_and_assignee_found(atlassian):
    users = [{"accountId": "acc-sam", "displayName": "Sam Ortiz", "active": True},
             {"accountId": "acc-samantha", "displayName": "Samantha Ortiz-Vale", "active": True}]
    fake = Fake(_create_routes(TYPES, users))
    out = await LiveJira(fake.transport).create_issue("Rotate staging keys", "Keys expire Friday.\nOwner needed.\n\nSee #platform.",
                                                     "sam ortiz")

    lookup = fake.sent("/rest/api/3/user/assignable/search")[0]
    assert lookup.url.params["project"] == "PLAT" and lookup.url.params["query"] == "sam ortiz"
    fields = body(fake.sent("/rest/api/3/issue", "POST")[0])["fields"]
    assert fields["project"] == {"key": "PLAT"} and fields["summary"] == "Rotate staging keys"
    assert fields["issuetype"] == {"id": "10001"} and fields["assignee"] == {"id": "acc-sam"}
    assert fields["description"] == {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Keys expire Friday."}, {"type": "hardBreak"},
                                          {"type": "text", "text": "Owner needed."}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "See #platform."}]}]}
    assert out == {"key": "PLAT-42", "url": f"{SITE}/browse/PLAT-42",
                   "text": "Created PLAT-42: Rotate staging keys (assigned to sam ortiz)"}


async def test_jira_create_issue_assignee_not_found_is_unassigned_and_says_so(atlassian):
    fake = Fake(_create_routes(TYPES, []))
    out = await LiveJira(fake.transport).create_issue("Rotate staging keys", "", "Elena Petrova")
    fields = body(fake.sent("/rest/api/3/issue", "POST")[0])["fields"]
    assert "assignee" not in fields and "description" not in fields
    assert out["key"] == "PLAT-42" and "Elena Petrova" in out["text"] and "unassigned" in out["text"]


async def test_jira_create_issue_ambiguous_assignee_is_not_guessed(atlassian):
    users = [{"accountId": "a1", "displayName": "Sam Ortiz-Vale"}, {"accountId": "a2", "displayName": "Sam Okoro"}]
    fake = Fake(_create_routes(TYPES, users))
    out = await LiveJira(fake.transport).create_issue("X", "", "Sam")
    assert "assignee" not in body(fake.sent("/rest/api/3/issue", "POST")[0])["fields"] and "unassigned" in out["text"]


async def test_jira_issue_type_falls_back_when_project_has_no_task(atlassian):
    fake = Fake(_create_routes([{"id": "7", "name": "Epic", "subtask": False}, {"id": "8", "name": "Story", "subtask": False},
                                {"id": "9", "name": "Sub-task", "subtask": True}], []))
    jira = LiveJira(fake.transport)
    await jira.create_issue("One")
    await jira.create_issue("Two")
    posts = fake.sent("/rest/api/3/issue", "POST")
    assert [body(p)["fields"]["issuetype"] for p in posts] == [{"id": "8"}, {"id": "8"}]
    assert len(fake.sent("/rest/api/3/issue/createmeta/PLAT/issuetypes")) == 1  # looked up once, then cached


async def test_jira_create_retries_unassigned_when_jira_rejects_the_assignee(atlassian):
    def create(request):
        if "assignee" in body(request)["fields"]:
            return httpx.Response(400, json={"errorMessages": [], "errors": {"assignee": "User cannot be assigned issues."}})
        return httpx.Response(201, json={"id": "1", "key": "PLAT-43"})

    routes = _create_routes(TYPES, [{"accountId": "acc-sam", "displayName": "Sam Ortiz"}])
    routes[("POST", "/rest/api/3/issue")] = create
    out = await LiveJira(Fake(routes).transport).create_issue("X", "", "Sam Ortiz")
    assert out["key"] == "PLAT-43" and "could not assign Sam Ortiz" in out["text"]


async def test_jira_write_failure_raises_with_upstream_message(atlassian):
    routes = _create_routes(TYPES, [])
    routes[("POST", "/rest/api/3/issue")] = httpx.Response(400, json={"errorMessages": ["Field 'priority' is required"], "errors": {}})
    with pytest.raises(RuntimeError, match="Jira 400.*Field 'priority' is required"):
        await LiveJira(Fake(routes).transport).create_issue("X")

    unauthorised = Fake({("POST", "/rest/api/3/search/jql"): httpx.Response(401, text="Client must be authenticated")})
    with pytest.raises(RuntimeError) as err:
        await LiveJira(unauthorised.transport).search("x")
    assert "401" in str(err.value) and "ATLASSIAN_API_TOKEN" in str(err.value) and "token-123" not in str(err.value)


async def test_jira_add_comment_sends_adf(atlassian):
    fake = Fake({("POST", "/rest/api/3/issue/PLAT-7/comment"): httpx.Response(201, json={"id": "555"})})
    out = await LiveJira(fake.transport).add_comment("PLAT-7", "Looks good.")
    assert body(fake.calls[0]) == {"body": to_adf("Looks good.")}
    assert out == {"key": "PLAT-7", "url": f"{SITE}/browse/PLAT-7?focusedCommentId=555", "text": "Commented on PLAT-7"}


async def test_jira_fetch_events_normalised(atlassian):
    fake = Fake({("POST", "/rest/api/3/search/jql"): {"issues": [ISSUE]}})
    (ev,) = await LiveJira(fake.transport).fetch_events(limit=20)
    assert "description" in body(fake.calls[0])["fields"]
    assert ev["id"] == "jira:PLAT-7" and ev["source"] == "jira"
    assert ev["title"] == "PLAT-7 Payroll export: CSV and API formats"
    assert ev["body"].startswith("CSV export is done in staging.\nAPI format is not started.")
    assert "Status: In Progress" in ev["body"]
    assert ev["meta"] == {"key": "PLAT-7", "status": "In Progress", "assignee": "Priya Raman"}
    assert ev["participants"] == ["Priya Raman", "Maya Chen"] and ev["url"] == f"{SITE}/browse/PLAT-7"
    assert ev["occurred_at"] == datetime.fromisoformat("2026-10-02T15:30:00+00:00").astimezone().replace(tzinfo=None).isoformat()


def test_adf_round_trip_and_site_normalisation(monkeypatch):
    assert adf_text(to_adf("One\ntwo\n\nThree")).strip() == "One\ntwo\nThree"
    assert to_adf("")["content"] == []
    monkeypatch.setattr(settings, "atlassian_site", "tidewater.atlassian.net/wiki")
    monkeypatch.setattr(settings, "atlassian_email", "a@b.co")
    monkeypatch.setattr(settings, "atlassian_token", "t")
    assert LiveJira(Fake({}).transport).site == SITE


# ------------------------------------------------------------------------------------------------ Confluence
async def test_confluence_create_page_resolves_space_id(atlassian):
    fake = Fake({("GET", "/wiki/api/v2/spaces"): {"results": [{"id": "98765", "key": "ENG"}]},
                 ("POST", "/wiki/api/v2/pages"): {"id": "4242", "title": "Runbook",
                                                  "_links": {"webui": "/spaces/ENG/pages/4242/Runbook", "base": f"{SITE}/wiki"}}})
    confluence = LiveConfluence(fake.transport)
    out = await confluence.create_page("Runbook", "Step 1: use <flag> & wait.\n\nStep 2: done.")
    await confluence.create_page("Runbook 2", "x")

    spaces = fake.sent("/wiki/api/v2/spaces")
    assert len(spaces) == 1 and spaces[0].url.params["keys"] == "ENG"  # looked up once, then cached
    sent = body(fake.sent("/wiki/api/v2/pages", "POST")[0])
    assert sent == {"spaceId": "98765", "status": "current", "title": "Runbook",
                    "body": {"representation": "storage",
                             "value": "<p>Step 1: use &lt;flag&gt; &amp; wait.</p><p>Step 2: done.</p>"}}
    assert out == {"id": "4242", "url": f"{SITE}/wiki/spaces/ENG/pages/4242/Runbook", "text": "Created page “Runbook”"}


async def test_confluence_unknown_space_is_a_clear_error(atlassian):
    fake = Fake({("GET", "/wiki/api/v2/spaces"): {"results": []}})
    with pytest.raises(RuntimeError, match="space with key “ENG” not found"):
        await LiveConfluence(fake.transport).create_page("T", "b")
    assert not fake.sent("/wiki/api/v2/pages")


async def test_confluence_search_uses_v1_cql_in_space(atlassian):
    fake = Fake({("GET", "/wiki/rest/api/search"): {
        "results": [{"content": {"id": "4242", "type": "page", "title": "API migration runbook"},
                     "title": "API @@@hl@@@migration@@@endhl@@@ runbook", "excerpt": "How to move an endpoint &amp; verify",
                     "url": "/spaces/ENG/pages/4242/API+migration+runbook", "lastModified": "2026-09-24T17:00:00.000Z"}],
        "_links": {"base": f"{SITE}/wiki"}}})
    rows = await LiveConfluence(fake.transport).search("migration runbook", limit=8)
    params = fake.calls[0].url.params
    assert params["cql"] == 'space = "ENG" AND type = page AND (text ~ "migration" OR text ~ "runbook")'
    assert params["limit"] == "8"
    assert rows[0]["id"] == "4242" and rows[0]["title"] == "API migration runbook"
    assert rows[0]["excerpt"] == "How to move an endpoint & verify"
    assert rows[0]["url"] == f"{SITE}/wiki/spaces/ENG/pages/4242/API+migration+runbook"

    await LiveConfluence(fake.transport).search("")
    assert fake.calls[-1].url.params["cql"] == 'space = "ENG" AND type = page ORDER BY lastmodified DESC'


async def test_confluence_fetch_events_normalised(atlassian):
    fake = Fake({("GET", "/wiki/api/v2/spaces"): {"results": [{"id": "98765"}]},
                 ("GET", "/wiki/api/v2/pages"): {
                     "results": [{"id": "4242", "title": "Runbook", "authorId": "acc-1",
                                  "version": {"createdAt": "2026-09-24T17:00:00.000Z", "authorId": "acc-priya"},
                                  "body": {"storage": {"value": "<h1>Steps</h1><p>Add the provider &amp; test.</p><p>Flip.</p>"}},
                                  "_links": {"webui": "/spaces/ENG/pages/4242/Runbook"}}],
                     "_links": {"base": f"{SITE}/wiki"}},
                 ("POST", "/wiki/api/v2/users-bulk"): {"results": [{"accountId": "acc-priya", "displayName": "Priya Raman"}]}})
    (ev,) = await LiveConfluence(fake.transport).fetch_events(limit=5)
    listing = fake.sent("/wiki/api/v2/pages", "GET")[0].url.params
    assert listing["space-id"] == "98765" and listing["sort"] == "-modified-date" and listing["body-format"] == "storage"
    assert body(fake.sent("/wiki/api/v2/users-bulk")[0]) == {"accountIds": ["acc-priya"]}
    assert ev["id"] == "confluence:4242" and ev["source"] == "confluence" and ev["title"] == "Runbook"
    assert ev["body"] == "Steps\nAdd the provider & test.\nFlip." and ev["participants"] == ["Priya Raman"]
    assert ev["url"] == f"{SITE}/wiki/spaces/ENG/pages/4242/Runbook"


def test_storage_format_escapes_text():
    assert to_storage("a < b\nline two") == "<p>a &lt; b<br/>line two</p>" and to_storage("") == "<p></p>"


# ------------------------------------------------------------------------------------------------ Slack
def _channels(member: bool):
    return {"ok": True, "channels": [{"id": "C0PLATFORM1", "name": "platform", "is_member": member},
                                     {"id": "C0ACCOUNTS1", "name": "accounts", "is_member": False}],
            "response_metadata": {"next_cursor": ""}}


def _slack_routes(member: bool = True, extra: dict | None = None):
    routes = {("GET", "/api/conversations.list"): _channels(member),
              ("POST", "/api/chat.postMessage"): {"ok": True, "channel": "C0PLATFORM1", "ts": "1759500000.000200"},
              ("GET", "/api/chat.getPermalink"): {"ok": True, "permalink": "https://tw.slack.com/archives/C0PLATFORM1/p1759500000000200"},
              ("POST", "/api/conversations.join"): {"ok": True, "channel": {"id": "C0PLATFORM1"}},
              ("POST", "/api/auth.test"): {"ok": True, "url": "https://tw.slack.com/"}}
    routes.update({(m, f"/api/{name}"): reply for (m, name), reply in (extra or {}).items()})
    return routes


async def test_slack_post_message_resolves_name_to_id(slack_token):
    fake = Fake(_slack_routes(member=True))
    out = await LiveSlack(fake.transport).post_message("#platform", "Keys rotate Friday.")

    assert fake.paths() == ["/api/conversations.list", "/api/chat.postMessage", "/api/chat.getPermalink"]
    post = fake.sent("/api/chat.postMessage")[0]
    assert post.headers["authorization"] == "Bearer xoxb-test"
    assert body(post) == {"channel": "C0PLATFORM1", "text": "Keys rotate Friday."}
    link = fake.sent("/api/chat.getPermalink")[0].url.params
    assert link["channel"] == "C0PLATFORM1" and link["message_ts"] == "1759500000.000200"
    assert out == {"id": "1759500000.000200", "url": "https://tw.slack.com/archives/C0PLATFORM1/p1759500000000200",
                   "text": "Posted in #platform"}


async def test_slack_post_message_joins_first_when_not_a_member(slack_token):
    fake = Fake(_slack_routes(member=False))
    out = await LiveSlack(fake.transport).post_message("platform", "hello")
    assert fake.paths()[:3] == ["/api/conversations.list", "/api/conversations.join", "/api/chat.postMessage"]
    assert body(fake.sent("/api/conversations.join")[0]) == {"channel": "C0PLATFORM1"} and out["text"] == "Posted in #platform"


async def test_slack_post_message_recovers_from_stale_membership(slack_token):
    replies = iter([{"ok": False, "error": "not_in_channel"}, {"ok": True, "channel": "C0PLATFORM1", "ts": "1.2"}])
    fake = Fake(_slack_routes(True, {("POST", "chat.postMessage"): lambda _: next(replies)}))
    out = await LiveSlack(fake.transport).post_message("platform", "hello")
    assert fake.paths()[1:4] == ["/api/chat.postMessage", "/api/conversations.join", "/api/chat.postMessage"] and out["id"] == "1.2"


async def test_slack_errors_are_surfaced(slack_token):
    with pytest.raises(SlackError, match="channel_not_found.*#nope"):
        await LiveSlack(Fake(_slack_routes()).transport).post_message("#nope", "hi")

    denied = Fake(_slack_routes(False, {("POST", "conversations.join"): {"ok": False, "error": "missing_scope",
                                                                                   "needed": "channels:join"}}))
    with pytest.raises(SlackError, match="conversations.join: missing_scope") as err:
        await LiveSlack(denied.transport).post_message("platform", "hi")
    assert not denied.sent("/api/chat.postMessage") and "xoxb" not in str(err.value)

    too_long = Fake(_slack_routes(True, {("POST", "chat.postMessage"): {"ok": False, "error": "msg_too_long"}}))
    with pytest.raises(RuntimeError, match="Slack chat.postMessage: msg_too_long"):
        await LiveSlack(too_long.transport).post_message("platform", "hi")

    bad_token = Fake({("GET", "/api/conversations.list"): {"ok": False, "error": "invalid_auth"}})
    with pytest.raises(SlackError, match="invalid_auth.*SLACK_BOT_TOKEN"):
        await LiveSlack(bad_token.transport).history()


async def test_slack_retries_once_after_429(slack_token):
    replies = iter([httpx.Response(429, headers={"Retry-After": "0"}, json={"ok": False, "error": "ratelimited"}),
                    httpx.Response(200, json=_channels(True))])
    fake = Fake(_slack_routes(True, {("GET", "conversations.list"): lambda _: next(replies)}))
    await LiveSlack(fake.transport).post_message("platform", "hi")
    assert len(fake.sent("/api/conversations.list")) == 2

    always = Fake({("GET", "/api/conversations.list"): httpx.Response(429, headers={"Retry-After": "0"}, json={"ok": False})})
    with pytest.raises(SlackError, match="ratelimited"):
        await LiveSlack(always.transport).post_message("platform", "hi")
    assert len(always.calls) == 2  # one retry, not a loop


HISTORY = {"ok": True, "messages": [
    {"type": "message", "user": "U0ELENA", "text": "Heads up <@U0SAM>: the staging provider keys expire Friday &amp; nobody owns it",
     "ts": "1759500300.000100"},
    {"type": "message", "subtype": "channel_join", "user": "U0BOT", "text": "<@U0BOT> has joined the channel", "ts": "1759500200.000100"},
    {"type": "message", "bot_id": "B0MOSS", "text": "*Priya Raman:* p95 latency is 4.1s", "ts": "1759500100.000100"},
    {"type": "message", "user": "U0SAM", "text": "ok", "ts": "1759500000.000100"}]}


def _users(request):
    names = {"U0ELENA": {"real_name": "Elena Petrova", "profile": {"display_name": "", "real_name": "Elena Petrova"}},
             "U0SAM": {"real_name": "Sam Ortiz", "profile": {"display_name": "Sam"}}}
    return {"ok": True, "user": {"id": request.url.params["user"], **names[request.url.params["user"]]}}


async def test_slack_fetch_events_normalised(slack_token):
    fake = Fake(_slack_routes(True, {("GET", "conversations.history"): HISTORY, ("GET", "users.info"): _users}))
    events = await LiveSlack(fake.transport).fetch_events(limit=30)

    assert fake.sent("/api/conversations.list")[0].url.params["types"] == "public_channel"
    history = fake.sent("/api/conversations.history")
    assert [h.url.params["channel"] for h in history] == ["C0PLATFORM1"]  # only channels the bot is in
    assert [e["id"] for e in events] == ["slack:C0PLATFORM1:1759500300.000100", "slack:C0PLATFORM1:1759500000.000100"]
    first = events[0]  # newest first; the join notice and the bot post are skipped
    assert first["source"] == "slack" and first["title"] == "#platform · Heads up @Sam: the staging provider"
    assert first["body"] == "Heads up @Sam: the staging provider keys expire Friday & nobody owns it"
    assert first["meta"] == {"channel": "#platform"} and first["participants"] == ["Elena Petrova"]
    assert first["url"] == "https://tw.slack.com/archives/C0PLATFORM1/p1759500300000100"
    assert first["occurred_at"] == datetime.fromtimestamp(1759500300.0001).isoformat(timespec="seconds")
    assert len(fake.sent("/api/users.info")) == 2  # each user resolved once


async def test_slack_history_by_name_keeps_seeded_posts_under_their_author(slack_token):
    fake = Fake(_slack_routes(True, {("GET", "conversations.history"): HISTORY, ("GET", "users.info"): _users}))
    rows = await LiveSlack(fake.transport).history("platform", limit=2)
    assert fake.sent("/api/conversations.history")[0].url.params["channel"] == "C0PLATFORM1"
    assert [(r["user"], r["text"]) for r in await LiveSlack(fake.transport).history("#platform")][1] == ("Priya Raman", "p95 latency is 4.1s")
    assert len(rows) == 2 and set(rows[0]) == {"channel", "user", "text", "ts", "url"} and rows[0]["channel"] == "#platform"


# ------------------------------------------------------------------------------------------------ voice
async def test_voice_returns_none_without_key(monkeypatch):
    fake = Fake({})
    monkeypatch.setattr(voice, "_http", httpx.AsyncClient(base_url=voice.API, transport=fake.transport))
    monkeypatch.setattr(settings, "elevenlabs_key", "")
    assert await voice.synthesize("Platform sync finished.") is None and fake.calls == []


async def test_voice_returns_audio_on_200(monkeypatch):
    path = f"/v1/text-to-speech/{voice.DEFAULT_VOICE_ID}"
    fake = Fake({("POST", path): httpx.Response(200, content=b"ID3-mp3-bytes", headers={"content-type": "audio/mpeg"})})
    monkeypatch.setattr(voice, "_http", httpx.AsyncClient(base_url=voice.API, transport=fake.transport))
    monkeypatch.setattr(settings, "elevenlabs_key", "el-key")
    monkeypatch.setattr(settings, "elevenlabs_voice", "")
    monkeypatch.setattr(settings, "elevenlabs_model", "eleven_flash_v2_5")

    assert await voice.synthesize("Platform sync finished.") == b"ID3-mp3-bytes"
    (req,) = fake.calls
    assert req.url.host == "api.elevenlabs.io" and req.url.path == path and req.url.params["output_format"] == "mp3_44100_128"
    assert req.headers["xi-api-key"] == "el-key" and "authorization" not in req.headers
    assert body(req) == {"text": "Platform sync finished.", "model_id": "eleven_flash_v2_5"}

    monkeypatch.setattr(settings, "elevenlabs_voice", "customVoice123")
    fake.routes[("POST", "/v1/text-to-speech/customVoice123")] = httpx.Response(200, content=b"x")
    assert await voice.synthesize("hi") == b"x"


async def test_voice_never_raises(monkeypatch):
    monkeypatch.setattr(settings, "elevenlabs_key", "el-key")
    monkeypatch.setattr(settings, "elevenlabs_voice", "")
    quota = Fake({("POST", f"/v1/text-to-speech/{voice.DEFAULT_VOICE_ID}"): httpx.Response(
        401, json={"detail": {"status": "quota_exceeded", "message": "No credits left"}})})
    monkeypatch.setattr(voice, "_http", httpx.AsyncClient(base_url=voice.API, transport=quota.transport))
    assert await voice.synthesize("hello") is None

    def boom(request):
        raise httpx.ConnectTimeout("timed out", request=request)

    monkeypatch.setattr(voice, "_http", httpx.AsyncClient(base_url=voice.API, transport=httpx.MockTransport(boom)))
    assert await voice.synthesize("hello") is None


# ------------------------------------------------------------------------------------------------ Google (pure helpers)
USERS = [{"name": "Maya Chen", "email": "maya@tidewater.example"}, {"name": "Sam Ortiz", "email": "sam@tidewater.example"},
         {"name": "Nandan Rao", "email": "nandan@realcompany.io"}]


def test_gmail_draft_is_base64url_mime():
    raw = g.build_raw_message("dana@harborline.io", "Payroll scope —\n update", "Hi Dana,\n\nScope attached. Größe: ok?\n")
    assert "+" not in raw and "/" not in raw
    msg = email.message_from_bytes(base64.urlsafe_b64decode(raw))
    assert msg["To"] == "dana@harborline.io" and "\n" not in str(email.header.make_header(email.header.decode_header(msg["Subject"])))
    assert str(email.header.make_header(email.header.decode_header(msg["Subject"]))) == "Payroll scope — update"
    assert msg.get_content_type() == "text/plain"
    assert msg.get_payload(decode=True).decode(msg.get_content_charset()) == "Hi Dana,\n\nScope attached. Größe: ok?\n"
    assert email.message_from_bytes(base64.urlsafe_b64decode(g.build_raw_message("", "s", "b")))["To"] is None


def test_attendees_never_include_fake_addresses():
    invite, mention = g.split_attendees(
        ["Maya Chen", "sam", "dana@harborline.io", "Luis <luis@pinecrest.org>", "priya@tidewater.example", "Nandan Rao",
         "Someone Unknown", "DANA@harborline.io", "", "x@example.com"], USERS)
    assert invite == ["dana@harborline.io", "luis@pinecrest.org", "nandan@realcompany.io"]
    assert mention == ["Maya Chen", "Sam Ortiz", "priya@tidewater.example", "Someone Unknown", "x@example.com"]
    assert g.split_attendees(None, USERS) == ([], [])
    assert g.is_fake_address("a@tidewater.example") and g.is_fake_address("a@mail.example.") and not g.is_fake_address("a@examples.io")


def test_calendar_event_body_keeps_fake_people_in_description_only():
    invite, mention = g.split_attendees(["Maya Chen", "dana@harborline.io"], USERS)
    out = g.build_event("Follow-up: payroll", "2026-10-08T10:00", 45, invite, mention, "From the sync.", "America/New_York")
    assert out["start"] == {"dateTime": "2026-10-08T10:00:00", "timeZone": "America/New_York"}
    assert out["end"] == {"dateTime": "2026-10-08T10:45:00", "timeZone": "America/New_York"}
    assert out["attendees"] == [{"email": "dana@harborline.io"}]
    assert out["description"].startswith("From the sync.\n\nAlso involved") and "Maya Chen" in out["description"]
    assert "tidewater.example" not in json.dumps(out)

    bare = g.build_event("T", "2026-10-08", 30, [], [], "", "Europe/Berlin")
    assert bare["start"]["dateTime"] == "2026-10-08T10:00:00" and "attendees" not in bare and "description" not in bare
    assert g.build_event("T", "2026-10-08T10:00", 30, [], [], "", None)["start"]["dateTime"][19] in "+-"  # offset when no zone
    with pytest.raises(ValueError, match="ISO start time"):
        g.build_event("T", "next tuesday", 30, [], [], "", "UTC")


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


MESSAGE = {"id": "19a1", "threadId": "19a0", "snippet": "Hi Marcus, we&#39;re waiting", "internalDate": "1759500000000",
           "payload": {"mimeType": "multipart/alternative",
                       "headers": [{"name": "From", "value": "Dana Okafor <dana@harborline.io>"},
                                   {"name": "To", "value": "marcus@tidewater.dev"},
                                   {"name": "Subject", "value": "Payroll integration before the January cycle"}],
                       "parts": [{"mimeType": "text/plain", "body": {"data": _b64("Hi Marcus,\n\nWe need payroll live.\n")}},
                                 {"mimeType": "text/html", "body": {"data": _b64("<p>Hi Marcus,</p>")}}]}}


def test_gmail_message_normalisation():
    ev = g.message_event(MESSAGE)
    assert ev["id"] == "gmail:19a1" and ev["source"] == "gmail" and ev["title"] == "Payroll integration before the January cycle"
    assert ev["body"] == "Hi Marcus,\n\nWe need payroll live." and ev["participants"] == ["Dana Okafor"]
    assert ev["url"] == "https://mail.google.com/mail/u/0/#all/19a0" and ev["meta"]["to"] == "marcus@tidewater.dev"
    assert ev["occurred_at"] == datetime.fromtimestamp(1759500000).isoformat(timespec="seconds")

    row = g.message_row(MESSAGE)
    assert row == {"id": "19a1", "sender": "Dana Okafor", "to": "marcus@tidewater.dev", "date": ev["occurred_at"],
                   "subject": "Payroll integration before the January cycle", "snippet": "Hi Marcus, we're waiting",
                   "url": ev["url"]}

    html_only = {"id": "1", "snippet": "fallback", "payload": {"mimeType": "text/html", "headers": [],
                                                              "body": {"data": _b64("<div>Hello<br>there &amp; you</div>")}}}
    assert g.message_event(html_only)["body"] == "Hello\nthere & you" and g.message_event(html_only)["title"] == "(no subject)"
    assert g.message_event({"id": "2", "snippet": "only a snippet", "payload": {}})["body"] == "only a snippet"


def test_calendar_event_normalisation():
    ev = g.calendar_event({"id": "evt1", "summary": "Platform sync", "htmlLink": "https://www.google.com/calendar/event?eid=abc",
                           "description": "<b>Agenda</b>: latency",
                           "start": {"dateTime": "2026-10-05T14:00:00-04:00", "timeZone": "America/New_York"},
                           "end": {"dateTime": "2026-10-05T14:45:00-04:00"},
                           "attendees": [{"email": "priya@x.io", "displayName": "Priya Raman"}, {"email": "sam@x.io"},
                                         {"email": "room@resource.calendar.google.com", "resource": True}]})
    assert ev == {"id": "calendar:evt1", "source": "calendar", "title": "Platform sync", "body": "Agenda : latency",
                  "occurred_at": "2026-10-05T14:00", "account": None, "participants": ["Priya Raman", "sam@x.io"],
                  "url": "https://www.google.com/calendar/event?eid=abc",
                  "meta": {"start": "2026-10-05T14:00", "end": "2026-10-05T14:45"}}
    all_day = g.calendar_event({"id": "evt2", "start": {"date": "2026-10-06"}, "end": {"date": "2026-10-07"}})
    assert all_day["occurred_at"] == "2026-10-06T00:00" and all_day["meta"] == {"start": "2026-10-06", "end": "2026-10-07"}
    assert all_day["title"] == "(no title)"


class _FakeCalendar:
    """Just enough of the googleapiclient surface: service.events().list(...).execute() / .insert(...).execute()."""

    def __init__(self):
        self.inserted = []

    def events(self):
        return self

    def list(self, **kwargs):
        self._reply = {"timeZone": "America/New_York", "items": []}
        return self

    def insert(self, **kwargs):
        self.inserted.append(kwargs)
        self._reply = {"id": "evt9", "htmlLink": "https://www.google.com/calendar/event?eid=evt9"}
        return self

    def execute(self):
        return self._reply


async def test_calendar_create_event_uses_calendar_zone_and_real_addresses_only(monkeypatch):
    from moss import db
    monkeypatch.setattr(db, "q", lambda sql, params=(): USERS)
    service = _FakeCalendar()
    out = await g.LiveCalendar(service=service).create_event("Follow-up", "2026-10-08T10:00", 30,
                                                            ["Maya Chen", "Sam Ortiz", "dana@harborline.io"], "Notes")
    (call,) = service.inserted
    assert call["calendarId"] == "primary" and call["sendUpdates"] == "all"
    assert call["body"]["start"] == {"dateTime": "2026-10-08T10:00:00", "timeZone": "America/New_York"}
    assert call["body"]["attendees"] == [{"email": "dana@harborline.io"}]
    assert out["id"] == "evt9" and out["url"].endswith("eid=evt9")
    assert out["text"].startswith("Scheduled “Follow-up” for 2026-10-08 10:00") and "Maya Chen" in out["text"]

    await g.LiveCalendar(service=service).create_event("Solo", "2026-10-08T10:00", 30, ["Maya Chen"])
    assert service.inserted[-1]["sendUpdates"] == "none" and "attendees" not in service.inserted[-1]["body"]


def test_google_is_live_only_with_a_token_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "google_token", str(tmp_path / "token.json"))
    assert not g.LiveGmail.is_configured() and not g.LiveCalendar.is_configured()
    (tmp_path / "token.json").write_text("{}")
    assert g.LiveGmail.is_configured() and g.LiveCalendar.is_configured() and g.LiveGmail.mode == "live"


def _google(api: str, version: str, replies: list):
    """A real googleapiclient service (bundled discovery document, so no network) over canned HTTP replies."""
    from googleapiclient.discovery import build
    from googleapiclient.http import HttpMockSequence
    http = HttpMockSequence([({"status": str(status)}, json.dumps(payload)) for status, payload in replies])
    return build(api, version, http=http, cache_discovery=False), http.request_sequence


async def test_gmail_requests_through_the_real_client_library():
    service, sent = _google("gmail", "v1", [(200, {"messages": [{"id": "19a1", "threadId": "19a0"}]}), (200, MESSAGE),
                                            (200, {"id": "r-1", "message": {"id": "19b2", "threadId": "19b2"}}),
                                            (200, {"messages": [{"id": "19a1"}]}), (200, MESSAGE)])
    gmail = g.LiveGmail(service=service)
    rows = await gmail.search("from:dana payroll", 5)
    draft = await gmail.create_draft("Dana Okafor <dana@harborline.io>", "Scope", "Body")
    events = await gmail.fetch_events(3)

    assert rows[0]["subject"] == "Payroll integration before the January cycle" and events[0]["id"] == "gmail:19a1"
    assert sent[0][1] == "GET" and "/gmail/v1/users/me/messages?" in sent[0][0] and "q=from%3Adana+payroll" in sent[0][0]
    assert "labelIds" not in sent[0][0] and "format=metadata" in sent[1][0]
    assert sent[2][1] == "POST" and sent[2][0].startswith("https://gmail.googleapis.com/gmail/v1/users/me/drafts")
    mime = email.message_from_bytes(base64.urlsafe_b64decode(json.loads(sent[2][2])["message"]["raw"]))
    assert mime["To"] == "dana@harborline.io" and mime["Subject"] == "Scope"
    assert draft["id"] == "r-1" and draft["text"] == "Drafted email to Dana Okafor <dana@harborline.io>: Scope"
    assert "labelIds=INBOX" in sent[3][0] and "format=full" in sent[4][0]  # no query -> latest inbox


async def test_calendar_requests_through_the_real_client_library(monkeypatch):
    from moss import db
    monkeypatch.setattr(db, "q", lambda sql, params=(): USERS)
    listing = {"timeZone": "Europe/Berlin", "items": [
        {"id": "e1", "summary": "Stand-up", "htmlLink": "https://www.google.com/calendar/event?eid=e1",
         "start": {"dateTime": "2026-10-05T10:00:00+02:00"}, "end": {"dateTime": "2026-10-05T10:15:00+02:00"}}]}
    service, sent = _google("calendar", "v3", [(200, listing), (200, {"id": "e2", "htmlLink": "https://www.google.com/calendar/event?eid=e2"}),
                                               (403, {"error": {"code": 403, "message": "Request had insufficient authentication scopes."}})])
    calendar = g.LiveCalendar(service=service)
    rows = await calendar.list_events(7)
    made = await calendar.create_event("Follow-up", "2026-10-08T10:00", 30, ["Sam Ortiz"], "")  # zone learned from the listing

    assert rows == [{"id": "e1", "title": "Stand-up", "start": "2026-10-05T10:00", "end": "2026-10-05T10:15", "attendees": [],
                     "url": "https://www.google.com/calendar/event?eid=e1"}]
    assert "/calendar/v3/calendars/primary/events?" in sent[0][0] and "singleEvents=true" in sent[0][0]
    assert "orderBy=startTime" in sent[0][0] and "timeMin=" in sent[0][0] and "timeMax=" in sent[0][0]
    assert sent[1][1] == "POST" and "sendUpdates=none" in sent[1][0]  # nobody real to invite
    inserted = json.loads(sent[1][2])
    assert inserted["start"] == {"dateTime": "2026-10-08T10:00:00", "timeZone": "Europe/Berlin"} and "attendees" not in inserted
    assert "Sam Ortiz" in inserted["description"] and made["id"] == "e2"
    with pytest.raises(RuntimeError, match="Google Calendar 403: Request had insufficient authentication scopes"):
        await calendar.fetch_events()


def test_google_token_refresh_is_written_back(monkeypatch, tmp_path):
    from google.auth.exceptions import RefreshError
    from google.oauth2.credentials import Credentials

    from moss.connectors import google_auth
    monkeypatch.setattr(settings, "google_token", str(tmp_path / "token.json"))
    with pytest.raises(RuntimeError, match="token file not found"):
        google_auth.load_credentials()
    (tmp_path / "token.json").write_text(json.dumps({
        "token": "old-access", "refresh_token": "refresh-1", "client_id": "cid", "client_secret": "cs",
        "token_uri": "https://oauth2.googleapis.com/token", "expiry": "2020-01-01T00:00:00Z"}))

    def refresh(self, request):
        self.token, self.expiry = "new-access", datetime(2099, 1, 1)

    monkeypatch.setattr(Credentials, "refresh", refresh)
    creds = google_auth.load_credentials()
    assert creds.token == "new-access" and creds.scopes == google_auth.SCOPES
    assert json.loads((tmp_path / "token.json").read_text())["token"] == "new-access"  # refreshed token persisted

    def revoked(self, request):
        raise RefreshError("invalid_grant: Token has been expired or revoked.")

    monkeypatch.setattr(Credentials, "refresh", revoked)
    creds.expiry = datetime(2020, 1, 1)
    with pytest.raises(RuntimeError, match="expired or was revoked.*moss.connectors.google_auth"):
        google_auth.ensure_fresh(creds)


# ------------------------------------------------------------------------------------------------ live seeding
def test_seed_live_reads_the_seed_file():
    assert seed_live.jira_summary("PLAT-138 Rate-limit handling for provider calls") == "Rate-limit handling for provider calls"
    assert seed_live.jira_summary("No key here") == "No key here"
    slack = seed_live.seed_events("slack")
    assert len(slack) == 3 and len(seed_live.seed_events("jira")) == 3 and len(seed_live.seed_events("confluence")) == 2
    assert slack[0]["days_ago"] >= slack[-1]["days_ago"]  # oldest first
    assert seed_live.slack_text(slack[-1]).startswith("*Elena Petrova:* Heads up")


async def test_seed_live_dry_run_writes_nothing(atlassian, slack_token, monkeypatch, capsys):
    fake = Fake({**_slack_routes(True, {("GET", "conversations.history"): {"ok": True, "messages": []}}),
                 ("POST", "/rest/api/3/search/jql"): {"issues": [
                     {"key": "PLAT-1", "fields": {"summary": "Provider timeout tests", "status": {"name": "To Do"}}}]},
                 ("GET", "/wiki/api/v2/spaces"): {"results": [{"id": "98765"}]},
                 ("GET", "/wiki/api/v2/pages"): {"results": []}})
    monkeypatch.setattr(seed_live, "LiveJira", lambda: LiveJira(fake.transport))
    monkeypatch.setattr(seed_live, "LiveSlack", lambda: LiveSlack(fake.transport))
    monkeypatch.setattr(seed_live, "LiveConfluence", lambda: LiveConfluence(fake.transport))

    assert await seed_live.run(["jira", "slack", "confluence"], dry=True) == 0
    out = capsys.readouterr().out
    assert "skip    Provider timeout tests (already exists)" in out
    assert "would create issue: Rate-limit handling for provider calls" in out
    assert "would post in #platform" in out and "would create page: API migration runbook" in out
    writes = [c for c in fake.calls if c.method == "POST" and c.url.path not in ("/rest/api/3/search/jql", "/api/auth.test")]
    assert writes == []


async def test_seed_live_creates_and_skips(atlassian, slack_token, monkeypatch, capsys):
    fake = Fake({("POST", "/rest/api/3/search/jql"): {"issues": []}, **_create_routes(TYPES, []),
                 ("GET", "/wiki/api/v2/spaces"): {"results": [{"id": "98765"}]},
                 ("GET", "/wiki/api/v2/pages"): lambda r: {"results": [{"id": "1"}] if "runbook" in r.url.params["title"] else []},
                 ("POST", "/wiki/api/v2/pages"): {"id": "77", "_links": {"webui": "/spaces/ENG/pages/77", "base": f"{SITE}/wiki"}}})
    monkeypatch.setattr(seed_live, "LiveJira", lambda: LiveJira(fake.transport))
    monkeypatch.setattr(seed_live, "LiveConfluence", lambda: LiveConfluence(fake.transport))
    monkeypatch.setattr(settings, "slack_bot_token", "")

    assert await seed_live.run(["jira", "slack", "confluence"], dry=False) == 0
    out = capsys.readouterr().out
    issues = [body(c)["fields"] for c in fake.sent("/rest/api/3/issue", "POST")]
    assert [i["summary"] for i in issues] == ["Payroll export: CSV and API formats", "Provider timeout tests",
                                              "Rate-limit handling for provider calls"]
    assert all(i["description"]["type"] == "doc" for i in issues)
    pages = [body(c)["title"] for c in fake.sent("/wiki/api/v2/pages", "POST")]
    assert pages == ["Harborline Freight — account page"] and "skip    API migration runbook" in out
    assert "slack: skipped, not configured" in out and "gmail, calendar: not seeded" in out
