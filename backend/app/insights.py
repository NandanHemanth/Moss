"""Meeting insight extraction: transcript in, decisions/risks/commitments/proposed actions out, saved to memory."""

from datetime import datetime, timedelta, timezone
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from . import db
from .config import MODEL
from .memory import graph
from .memory.cache import cache


class ExtractedCommitment(BaseModel):
    title: str = Field(description="What was promised, phrased as a task")
    owner: str = Field(description="Full name of the person who committed to it")
    due_in_days: int = Field(description="Days from the meeting date until it is due; best estimate")


class ExtractedRisk(BaseModel):
    title: str
    severity: Literal["high", "medium"]


class ExtractedAction(BaseModel):
    kind: Literal["jira_issue", "slack_message", "calendar_event", "email"]
    target: str = Field(description="Jira board, Slack channel, time slot or email address")
    summary: str = Field(description="Full content of the issue, message, event or email")


class MeetingInsights(BaseModel):
    summary: str = Field(description="Two sentences on what the meeting covered")
    decisions: list[str]
    risks: list[ExtractedRisk]
    commitments: list[ExtractedCommitment]
    proposed_actions: list[ExtractedAction] = Field(description="Follow-ups an assistant should draft for approval")


PROMPT = (
    "You extract structured insights from a meeting transcript for an enterprise team. Only include items that are "
    "explicitly supported by the transcript; do not invent people, dates or numbers. Propose at most 3 follow-up "
    "actions that would genuinely help (e.g. a Jira issue for engineering work, a Slack recap, a calendar invite "
    "for an agreed meeting, an email confirming next steps to an external party).\n\n"
    "Meeting: {title}\nDate: {date}\nParticipants: {participants}\n\nTranscript:\n{body}"
)

ACTION_AGENT = {"jira_issue": "jira", "slack_message": "slack", "calendar_event": "mail", "email": "mail"}

_client: genai.Client | None = None


def _genai() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client()
    return _client


async def extract(document_id: int) -> dict:
    doc = db.document(document_id)
    if not doc or doc["source"] != "zoom":
        raise KeyError(document_id)
    response = await _genai().aio.models.generate_content(
        model=MODEL,
        contents=PROMPT.format(
            title=doc["title"],
            date=doc["occurredAt"][:10],
            participants=", ".join(doc["meta"].get("participants", [])),
            body=doc["body"],
        ),
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=MeetingInsights),
    )
    insights = response.parsed if isinstance(response.parsed, MeetingInsights) else MeetingInsights.model_validate_json(response.text)
    return _save(doc, insights)


def _save(doc: dict, insights: MeetingInsights) -> dict:
    meeting_date = datetime.fromisoformat(doc["occurredAt"])
    meeting = next((m for m in db.all_rows("meetings") if m["title"] == doc["title"]), None)
    values = {
        "title": doc["title"],
        "startsAt": doc["occurredAt"],
        "durationMin": doc["meta"].get("duration", 30),
        "attendees": doc["meta"].get("participants", []),
        "status": "captured",
        "decision": " ".join(insights.decisions) or insights.summary,
        "accountId": doc["accountId"],
    }
    meeting = db.update("meetings", meeting["id"], values) if meeting else db.create("meetings", values)
    assert meeting is not None

    existing_titles = {c["title"].lower() for c in db.all_rows("commitments")}
    commitments = [
        db.create("commitments", {
            "title": c.title,
            "owner": c.owner,
            "accountId": doc["accountId"],
            "source": "zoom",
            "sourceLabel": doc["title"],
            "due": (meeting_date + timedelta(days=max(c.due_in_days, 0))).replace(hour=17, minute=0).isoformat(),
            "status": "open",
        })
        for c in insights.commitments
        if c.title.lower() not in existing_titles
    ]
    risks = [
        db.create("risks", {"accountId": doc["accountId"], "severity": r.severity, "title": r.title, "evidence": f"Zoom · {doc['title']}"})
        for r in insights.risks
    ]
    proposals = [
        db.create("proposals", {"meetingId": meeting["id"], "agent": ACTION_AGENT[a.kind], "kind": a.kind, "target": a.target, "summary": a.summary, "status": "pending"})
        for a in insights.proposed_actions
    ]
    db.create("updates", {
        "agent": "meetings",
        "text": f"{doc['title']} is summarised: {len(insights.decisions)} decisions, {len(commitments)} new commitments, {len(proposals)} actions for review.",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })
    db.audit("meetings-agent", "extract", {"document": doc["id"], "meeting": meeting["id"]})
    graph.invalidate()
    cache.clear()
    return {"meeting": meeting, "summary": insights.summary, "decisions": insights.decisions, "commitments": commitments, "risks": risks, "proposals": proposals}
