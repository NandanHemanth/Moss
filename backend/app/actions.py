"""Side effects of user decisions: approving proposals and completing commitments."""

from datetime import datetime, timezone
from typing import Any

from . import db
from .connectors import CONNECTORS, KIND_TO_SERVICE
from .memory.cache import cache


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def on_update(resource: str, before: dict[str, Any], after: dict[str, Any]) -> None:
    if resource == "proposals" and before.get("status") != after.get("status"):
        _on_proposal_decision(after)
    elif resource == "commitments" and before.get("status") != after.get("status"):
        db.audit("user", f"commitment:{after['status']}", {"id": after["id"], "title": after["title"]})
        cache.clear()


def _on_proposal_decision(proposal: dict[str, Any]) -> None:
    status = proposal["status"]
    db.audit("user", f"proposal:{status}", {"id": proposal["id"], "kind": proposal["kind"], "target": proposal["target"]})
    if status != "approved":
        return
    connector = CONNECTORS[KIND_TO_SERVICE[proposal["kind"]]]
    connector.execute(proposal["kind"], proposal["target"], proposal["summary"])
    verb = {
        "jira_issue": "Created a Jira issue on",
        "slack_message": "Posted to",
        "calendar_event": "Booked",
        "email": "Sent an email to",
        "confluence_page": "Created a Confluence page in",
    }.get(proposal["kind"], "Completed an action for")
    db.create("updates", {"agent": proposal["agent"], "text": f"{verb} {proposal['target']}: {proposal['summary']}", "createdAt": _now()})
    cache.clear()
