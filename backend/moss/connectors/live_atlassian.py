"""Live Jira Cloud and Confluence Cloud adapters.

Auth: HTTP basic auth with `ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN` (an unscoped API token from
id.atlassian.com) against `ATLASSIAN_SITE` (https://yoursite.atlassian.net). The token acts as the user,
so it needs no scopes; the user needs Browse/Create/Comment permission in the Jira project and
view/create permission in the Confluence space.

Endpoints used
  Jira        POST /rest/api/3/search/jql                      bounded JQL, explicit `fields`
              GET  /rest/api/3/issue/{key}                     direct lookup when the query names an issue key
              POST /rest/api/3/issue                           description in Atlassian Document Format (ADF)
              POST /rest/api/3/issue/{key}/comment             ADF body
              GET  /rest/api/3/issue/createmeta/{project}/issuetypes
              GET  /rest/api/3/user/assignable/search          display name -> accountId
  Confluence  GET  /wiki/rest/api/search                       v1, CQL
              GET  /wiki/api/v2/spaces?keys=                   space key -> spaceId
              GET  /wiki/api/v2/pages                          recently modified pages with storage body
              POST /wiki/api/v2/pages                          body in `storage` representation
              POST /wiki/api/v2/users-bulk                     accountId -> display name (best effort)
"""
import html
import logging
import re

import httpx

from ..config import settings
from .live_common import error_text, keywords, local_iso, strip_html

log = logging.getLogger("moss.connectors.atlassian")
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
JIRA_FIELDS = ["summary", "status", "assignee", "reporter", "updated", "description"]


def site_url() -> str:
    """`ATLASSIAN_SITE` as an https origin, tolerating a missing scheme or a trailing /wiki."""
    site = re.sub(r"/wiki/?$", "", settings.atlassian_site.rstrip("/"))
    return site if not site or site.startswith("http") else f"https://{site}"


def to_adf(text: str) -> dict:
    """Plain text -> Atlassian Document Format: blank lines split paragraphs, single newlines become hard breaks."""
    content = []
    for block in re.split(r"\n\s*\n", (text or "").strip()):
        nodes = []
        for line in block.splitlines():
            if line.strip():
                if nodes:
                    nodes.append({"type": "hardBreak"})
                nodes.append({"type": "text", "text": line.strip()})
        if nodes:
            content.append({"type": "paragraph", "content": nodes})
    return {"type": "doc", "version": 1, "content": content}


def adf_text(node) -> str:
    """Atlassian Document Format -> plain text."""
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    inner = "".join(adf_text(child) for child in node.get("content") or [])
    block = node.get("type") in ("paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow")
    return inner + ("\n" if block and not inner.endswith("\n") else "")


def to_storage(text: str) -> str:
    """Plain text -> Confluence storage format (XHTML): escaped text in simple <p> paragraphs."""
    paragraphs = []
    for block in re.split(r"\n\s*\n", (text or "").strip()):
        lines = [html.escape(line.strip(), quote=False) for line in block.splitlines() if line.strip()]
        if lines:
            paragraphs.append("<p>" + "<br/>".join(lines) + "</p>")
    return "".join(paragraphs) or "<p></p>"


class _Atlassian:
    """One shared-shape HTTP client per connector: basic auth, JSON, timeouts, upstream errors surfaced."""
    mode = "live"
    product = "Atlassian"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self.site = site_url()
        self._http = httpx.AsyncClient(base_url=self.site, auth=(settings.atlassian_email, settings.atlassian_token),
                                       headers={"Accept": "application/json"}, timeout=TIMEOUT, transport=transport)

    @staticmethod
    def is_configured() -> bool:
        return bool(settings.atlassian_site and settings.atlassian_email and settings.atlassian_token)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _call(self, method: str, path: str, **kwargs):
        try:
            r = await self._http.request(method, path, **kwargs)
        except httpx.HTTPError as e:
            raise RuntimeError(f"{self.product} request failed: {type(e).__name__}: {e}") from e
        if r.status_code >= 400:
            hint = " (check ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN)" if r.status_code in (401, 403) else ""
            raise RuntimeError(f"{self.product} {r.status_code} on {method} {path}: {error_text(r)}{hint}")
        return r.json() if r.content else {}


class LiveJira(_Atlassian):
    product = "Jira"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(transport)
        self.project = settings.jira_project
        self._issue_type: dict | None = None

    def _browse(self, key: str) -> str:
        return f"{self.site}/browse/{key}"

    def _row(self, issue: dict) -> dict:
        f = issue.get("fields") or {}
        return {"key": issue["key"], "summary": f.get("summary") or "", "status": (f.get("status") or {}).get("name", ""),
                "assignee": (f.get("assignee") or {}).get("displayName"), "url": self._browse(issue["key"]),
                "updated": local_iso(f.get("updated"))}

    async def _jql(self, jql: str, limit: int) -> list[dict]:
        data = await self._call("POST", "/rest/api/3/search/jql",
                                json={"jql": jql, "maxResults": max(1, min(limit, 100)), "fields": JIRA_FIELDS})
        return data.get("issues") or []

    async def _issues(self, text: str, limit: int) -> list[dict]:
        """Issues in the project: named keys first, else any-word text match, else most recently updated."""
        keys = re.findall(rf"\b{re.escape(self.project)}-\d+\b", text or "", flags=re.I)
        found = []
        for key in dict.fromkeys(k.upper() for k in keys[:3]):
            try:  # a direct lookup: JQL rejects `key = X` outright when X does not exist
                found.append(await self._call("GET", f"/rest/api/3/issue/{key}", params={"fields": ",".join(JIRA_FIELDS)}))
            except RuntimeError as e:
                log.info("issue lookup failed: %s", e)
        if found:
            return found
        words = [w for w in keywords(text) if w.upper() != self.project.upper()]
        clause = " AND (" + " OR ".join(f'text ~ "{w}"' for w in words) + ")" if words else ""
        return await self._jql(f'project = "{self.project}"{clause} ORDER BY updated DESC', limit)

    async def search(self, text: str = "", limit: int = 10) -> list[dict]:
        return [self._row(i) for i in await self._issues(text, limit)][:limit]

    async def _task_type(self) -> dict:
        """The issue type to create: "Task" when the project has it, otherwise the first standard type."""
        if self._issue_type is None:
            try:
                data = await self._call("GET", f"/rest/api/3/issue/createmeta/{self.project}/issuetypes")
                types = [t for t in data.get("issueTypes") or [] if not t.get("subtask")]
            except RuntimeError as e:
                log.warning("could not list issue types, assuming Task: %s", e)
                types = []
            pick = (next((t for t in types if (t.get("name") or "").lower() == "task"), None)
                    or next((t for t in types if (t.get("name") or "").lower() not in ("epic", "subtask", "sub-task")), None)
                    or (types[0] if types else None))
            self._issue_type = {"id": pick["id"]} if pick else {"name": "Task"}
        return self._issue_type

    async def _account_id(self, name: str) -> str | None:
        """Display name -> accountId among users assignable in the project. None when there is no clear match."""
        try:
            users = await self._call("GET", "/rest/api/3/user/assignable/search",
                                     params={"project": self.project, "query": name, "maxResults": 10})
        except RuntimeError as e:
            log.warning("assignee lookup failed: %s", e)
            return None
        users = [u for u in users or [] if u.get("accountId") and u.get("active", True)]
        exact = [u for u in users if (u.get("displayName") or "").casefold() == name.casefold()]
        if exact:
            return exact[0]["accountId"]
        return users[0]["accountId"] if len(users) == 1 else None

    async def create_issue(self, summary: str, description: str = "", assignee: str | None = None) -> dict:
        summary = " ".join((summary or "").split())[:255]
        if not summary:
            raise ValueError("Jira issue needs a summary")
        fields: dict = {"project": {"key": self.project}, "summary": summary, "issuetype": await self._task_type()}
        if (description or "").strip():
            fields["description"] = to_adf(description)
        note, assignee = "", (assignee or "").strip()
        if assignee:
            account_id = await self._account_id(assignee)
            if account_id:
                fields["assignee"] = {"id": account_id}
                note = f" (assigned to {assignee})"
            else:
                note = f" (no Jira user matches “{assignee}”; left unassigned)"
        try:
            created = await self._call("POST", "/rest/api/3/issue", json={"fields": fields})
        except RuntimeError as e:
            if "assignee" not in fields or "assignee" not in str(e).lower():
                raise
            fields.pop("assignee")  # e.g. the field is not on the create screen: the issue matters more
            created = await self._call("POST", "/rest/api/3/issue", json={"fields": fields})
            note = f" (could not assign {assignee}; left unassigned)"
        key = created["key"]
        return {"key": key, "url": self._browse(key), "text": f"Created {key}: {summary}{note}"}

    async def add_comment(self, key: str, text: str) -> dict:
        if not (text or "").strip():
            raise ValueError("Jira comment needs text")
        made = await self._call("POST", f"/rest/api/3/issue/{key}/comment", json={"body": to_adf(text)})
        url = self._browse(key) + (f"?focusedCommentId={made['id']}" if made.get("id") else "")
        return {"key": key, "url": url, "text": f"Commented on {key}"}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        events = []
        for issue in await self._issues("", limit):
            f, row = issue.get("fields") or {}, self._row(issue)
            reporter = (f.get("reporter") or {}).get("displayName")
            description = adf_text(f.get("description")).strip()
            state = f"Status: {row['status'] or 'unknown'}. Assignee: {row['assignee'] or 'nobody'}."
            events.append({"id": f"jira:{row['key']}", "source": "jira", "title": f"{row['key']} {row['summary']}",
                           "body": f"{description}\n\n{state}".strip(), "occurred_at": row["updated"], "account": None,
                           "participants": list(dict.fromkeys(p for p in (row["assignee"], reporter) if p)),
                           "url": row["url"],
                           "meta": {"key": row["key"], "status": row["status"], "assignee": row["assignee"]}})
        return events


class LiveConfluence(_Atlassian):
    product = "Confluence"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(transport)
        self.space = settings.confluence_space
        self._space_id: str | None = None

    def _link(self, links: dict | None, base: str | None, path: str | None = None) -> str | None:
        path = path or (links or {}).get("webui")
        return f"{(base or self.site + '/wiki').rstrip('/')}{path}" if path else None

    async def space_id(self) -> str:
        if self._space_id is None:
            data = await self._call("GET", "/wiki/api/v2/spaces", params={"keys": self.space, "limit": 1})
            if not data.get("results"):
                raise RuntimeError(f"Confluence space with key “{self.space}” not found (check CONFLUENCE_SPACE)")
            self._space_id = str(data["results"][0]["id"])
        return self._space_id

    async def search(self, text: str = "", limit: int = 10) -> list[dict]:
        words = keywords(text)
        cql = f'space = "{self.space}" AND type = page'
        cql += " AND (" + " OR ".join(f'text ~ "{w}"' for w in words) + ")" if words else " ORDER BY lastmodified DESC"
        data = await self._call("GET", "/wiki/rest/api/search",
                                params={"cql": cql, "limit": max(1, min(limit, 50)), "excerpt": "indexed"})
        base, out = (data.get("_links") or {}).get("base"), []
        for r in data.get("results") or []:
            content = r.get("content") or {}
            clean = lambda s: strip_html(re.sub(r"@@@(end)?hl@@@", "", s or ""))  # noqa: E731
            out.append({"id": str(content.get("id") or ""), "title": clean(content.get("title") or r.get("title")),
                        "excerpt": clean(r.get("excerpt"))[:240], "url": self._link(None, base, r.get("url")),
                        "updated": local_iso(r.get("lastModified"))})
        return out[:limit]

    async def find_page(self, title: str) -> dict | None:
        """The page with exactly this title in the space, if any (used to keep seeding idempotent)."""
        data = await self._call("GET", "/wiki/api/v2/pages",
                                params={"space-id": await self.space_id(), "title": title, "limit": 1})
        return (data.get("results") or [None])[0]

    async def create_page(self, title: str, body: str) -> dict:
        title = " ".join((title or "").split())[:255]
        if not title:
            raise ValueError("Confluence page needs a title")
        payload = {"spaceId": await self.space_id(), "status": "current", "title": title,
                   "body": {"representation": "storage", "value": to_storage(body)}}
        page = await self._call("POST", "/wiki/api/v2/pages", json=payload)
        links = page.get("_links") or {}
        return {"id": str(page["id"]), "url": self._link(links, links.get("base")) or f"{self.site}/wiki",
                "text": f"Created page “{title}”"}

    async def _names(self, account_ids: list[str]) -> dict[str, str]:
        if not account_ids:
            return {}
        try:
            data = await self._call("POST", "/wiki/api/v2/users-bulk", json={"accountIds": account_ids[:250]})
        except RuntimeError as e:  # names are a nicety; pages still ingest without them
            log.info("user lookup failed: %s", e)
            return {}
        return {u["accountId"]: u.get("displayName") or u.get("publicName") or "" for u in data.get("results") or []}

    async def fetch_events(self, limit: int = 20) -> list[dict]:
        data = await self._call("GET", "/wiki/api/v2/pages",
                                params={"space-id": await self.space_id(), "sort": "-modified-date", "status": "current",
                                        "body-format": "storage", "limit": max(1, min(limit, 100))})
        pages, base = data.get("results") or [], (data.get("_links") or {}).get("base")
        author = lambda p: (p.get("version") or {}).get("authorId") or p.get("authorId")  # noqa: E731
        names = await self._names(list(dict.fromkeys(a for a in map(author, pages) if a)))
        events = []
        for p in pages:
            who = names.get(author(p))
            body = strip_html(((p.get("body") or {}).get("storage") or {}).get("value") or "")
            events.append({"id": f"confluence:{p['id']}", "source": "confluence", "title": p.get("title") or "Untitled page",
                           "body": body or p.get("title") or "",
                           "occurred_at": local_iso((p.get("version") or {}).get("createdAt") or p.get("createdAt")),
                           "account": None, "participants": [who] if who else [],
                           "url": self._link(p.get("_links"), base), "meta": {"page_id": str(p["id"]), "space": self.space}})
        return events
