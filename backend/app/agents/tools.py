"""Function tools for the agents. Each tool reads through a connector or a memory layer and records its use."""

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import db
from ..connectors import CONNECTORS
from ..memory import graph
from ..memory.graph import SOURCE_LABEL
from .trace import current

AGENT_LABEL = {
    "orchestrator": "Orchestrator",
    "mail": "Mail & Calendar agent",
    "slack": "Slack agent",
    "jira": "Jira agent",
    "meetings": "Meetings agent",
    "confluence": "Confluence agent",
}


def _account(name: str) -> dict[str, Any] | None:
    if not name.strip():
        return None
    needle = name.lower().strip()
    for a in db.all_rows("accounts"):
        if needle in a["name"].lower() or a["name"].lower() in needle:
            return a
    return None


def _account_name(account_id: int | None) -> str | None:
    row = db.get("accounts", account_id) if account_id else None
    return row["name"] if row else None


def _doc_view(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": SOURCE_LABEL.get(d["source"], d["source"]),
        "title": d["title"],
        "date": d["occurredAt"][:10],
        "account": _account_name(d["accountId"]),
        "details": {k: v for k, v in d["meta"].items() if k not in ("recording_files", "uuid")},
        "content": d["body"],
    }


def _search(agent: str, service: str, noun: str) -> Callable[..., dict[str, Any]]:
    def search(query: str, account: str = "") -> dict[str, Any]:
        acc = _account(account)
        docs = CONNECTORS[service].search(query, account_id=acc["id"] if acc else None)
        trace = current()
        scope = f" for {acc['name']}" if acc else ""
        trace.step(agent, f"{AGENT_LABEL[agent]} searched {noun}{scope} for “{query}” ({len(docs)} found)")
        for d in docs:
            trace.cite(f"{SOURCE_LABEL[service]} · {d['title']}")
        return {"results": [_doc_view(d) for d in docs]}

    search.__name__ = f"search_{noun.replace(' ', '_')}"
    search.__doc__ = (
        f"Searches {noun} by keywords.\n\n"
        "Args:\n"
        "    query: Keywords to look for, e.g. a topic, person or product.\n"
        "    account: Optional customer account name to restrict results to; empty for all.\n\n"
        "Returns:\n"
        "    Matching items with their full content, date and linked account."
    )
    return search


search_email = _search("mail", "gmail", "email")
search_slack = _search("slack", "slack", "slack messages")
search_jira = _search("jira", "jira", "jira issues")
search_meetings = _search("meetings", "zoom", "meeting transcripts")
search_confluence = _search("confluence", "confluence", "confluence pages")


def get_calendar(days_ahead: int = 7) -> dict[str, Any]:
    """Lists meetings from today through the given number of days ahead.

    Args:
        days_ahead: How many days ahead to include.

    Returns:
        Meetings with time, attendees, status and any recorded decision.
    """
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now + timedelta(days=days_ahead)
    meetings = [m for m in db.all_rows("meetings") if start <= datetime.fromisoformat(m["startsAt"]) <= end]
    current().step("mail", f"Mail & Calendar agent read the calendar ({len(meetings)} meetings)")
    return {"meetings": [{**m, "account": _account_name(m.get("accountId"))} for m in meetings]}


def find_accounts_by_topic(topic: str) -> dict[str, Any]:
    """Finds customer accounts linked to a topic in the knowledge graph, e.g. "payroll integration".

    Args:
        topic: The topic or product interest to look up.

    Returns:
        Account names connected to the topic, with their stage, health and summary.
    """
    names = graph.accounts_for_topic(topic)
    current().step("graph", f"Knowledge graph: {len(names)} accounts linked to “{topic}”")
    rows = [a for a in db.all_rows("accounts") if a["name"] in names]
    return {"accounts": [{k: a[k] for k in ("name", "stage", "health", "owner", "topics", "summary")} for a in rows]}


def explore_graph(entity: str) -> dict[str, Any]:
    """Shows what an entity (account, person, topic or Jira issue) is connected to in the knowledge graph.

    Args:
        entity: Name of the account, person, topic or issue key.

    Returns:
        The matched entity and its related people, topics, sources, issues and commitments.
    """
    result = graph.neighbors(entity)
    if result["entity"]:
        related = sum(len(v) for v in result["related"].values())
        current().step("graph", f"Knowledge graph: {result['entity']} → {related} connected items")
    else:
        current().step("graph", f"Knowledge graph: no match for “{entity}”")
    return result


def get_account_overview(account: str) -> dict[str, Any]:
    """Returns the stored record, timeline and risks for one customer account.

    Args:
        account: The customer account name.

    Returns:
        Account details, chronological interactions across all tools, and open risks.
    """
    acc = _account(account)
    if not acc:
        current().step("database", f"Database: no account matching “{account}”")
        return {"error": f"No account matching {account!r}"}
    timeline = sorted((i for i in db.all_rows("interactions") if i["accountId"] == acc["id"]), key=lambda i: i["occurredAt"], reverse=True)
    risks = [r for r in db.all_rows("risks") if r.get("accountId") == acc["id"]]
    current().step("database", f"Database: {acc['name']} record, {len(timeline)} interactions, {len(risks)} risks")
    for i in timeline[:4]:
        current().cite(f"{SOURCE_LABEL.get(i['source'], i['source'])} · {i['title']}")
    return {"account": acc, "timeline": timeline, "risks": risks}


def get_open_commitments(account: str = "", owner: str = "") -> dict[str, Any]:
    """Lists open commitments (promised follow-ups), optionally filtered by account and/or owner.

    Args:
        account: Optional customer account name; empty for all accounts.
        owner: Optional person who owns the commitment; empty for everyone.

    Returns:
        Open commitments with owner, due date, source and whether they are overdue.
    """
    acc = _account(account)
    now = datetime.now(timezone.utc)
    rows = [
        {**c, "account": _account_name(c.get("accountId")), "overdue": datetime.fromisoformat(c["due"]) < now}
        for c in db.all_rows("commitments")
        if c["status"] == "open"
        and (not acc or c.get("accountId") == acc["id"])
        and (not owner or owner.lower() in c["owner"].lower())
    ]
    accounts = {r["account"] for r in rows if r["account"]}
    current().step("database", f"Database: {len(rows)} open commitments across {len(accounts)} accounts")
    return {"commitments": rows}


def make_propose_action(agent: str, kinds: tuple[str, ...]) -> Callable[..., dict[str, Any]]:
    def propose_action(kind: str, target: str, summary: str) -> dict[str, Any]:
        if kind not in kinds:
            return {"error": f"{AGENT_LABEL[agent]} can only propose: {', '.join(kinds)}"}
        proposal = db.create(
            "proposals",
            {"meetingId": None, "agent": agent if agent != "orchestrator" else _owner_agent(kind), "kind": kind, "target": target, "summary": summary, "status": "pending", "origin": "chat"},
        )
        trace = current()
        trace.proposals.append(proposal)
        trace.step(agent, f"{AGENT_LABEL[agent]} drafted a {kind.replace('_', ' ')} for approval")
        return {"status": "pending_approval", "proposalId": proposal["id"], "note": "Nothing was sent. A manager must approve it."}

    propose_action.__doc__ = (
        "Drafts a write action for human approval. Nothing is sent until a person approves it.\n\n"
        "Args:\n"
        f"    kind: One of: {', '.join(kinds)}.\n"
        "    target: Who or where it goes, e.g. an email address, Slack channel, Jira board or time slot.\n"
        "    summary: The full content of the email, message, issue or event.\n\n"
        "Returns:\n"
        "    The pending proposal id."
    )
    return propose_action


def _owner_agent(kind: str) -> str:
    return {"email": "mail", "calendar_event": "mail", "slack_message": "slack", "jira_issue": "jira", "confluence_page": "confluence"}[kind]
