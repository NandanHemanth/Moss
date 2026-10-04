"""Service connectors. Demo mode reads and writes the seeded SQLite store; live mode is not wired yet."""

import re
from dataclasses import dataclass
from typing import Any

from . import db
from .config import CONNECTOR_MODE


def _terms(query: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]


def _score(doc: dict[str, Any], terms: list[str]) -> int:
    haystack = f"{doc['title']} {doc['body']} {doc['meta']}".lower()
    return sum(haystack.count(t) for t in terms)


@dataclass(frozen=True)
class Connector:
    service: str
    label: str

    @property
    def mode(self) -> str:
        return CONNECTOR_MODE.get(self.service, "demo")

    def _require_demo(self) -> None:
        if self.mode != "demo":
            raise NotImplementedError(f"Live {self.label} is not configured yet; set MOSS_{self.service.upper()}_MODE=demo")

    def search(self, query: str, account_id: int | None = None, limit: int = 5) -> list[dict[str, Any]]:
        self._require_demo()
        terms = _terms(query)
        docs = db.documents(source=self.service, account_id=account_id)
        if not terms:
            return docs[:limit]
        ranked = sorted(((d, _score(d, terms)) for d in docs), key=lambda x: x[1], reverse=True)
        return [d for d, s in ranked if s > 0][:limit]

    def recent(self, limit: int = 5) -> list[dict[str, Any]]:
        self._require_demo()
        return db.documents(source=self.service)[:limit]

    def execute(self, kind: str, target: str, summary: str) -> dict[str, Any]:
        """Carries out an approved write action. Demo mode records it instead of calling the service."""
        self._require_demo()
        result = {"service": self.service, "kind": kind, "target": target, "summary": summary, "mode": "demo"}
        db.audit(actor=f"{self.service}-connector", action=f"execute:{kind}", detail=result)
        return result


CONNECTORS = {
    "gmail": Connector("gmail", "Gmail"),
    "calendar": Connector("calendar", "Google Calendar"),
    "slack": Connector("slack", "Slack"),
    "jira": Connector("jira", "Jira"),
    "zoom": Connector("zoom", "Zoom"),
    "confluence": Connector("confluence", "Confluence"),
}

KIND_TO_SERVICE = {
    "email": "gmail",
    "calendar_event": "calendar",
    "slack_message": "slack",
    "jira_issue": "jira",
    "confluence_page": "confluence",
}
