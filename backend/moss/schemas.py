"""Typed shapes the LLM must return. Kept flat so Gemini structured output accepts them."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Insight(BaseModel):
    kind: Literal["decision", "commitment", "risk"]
    text: str = Field(description="One plain sentence.")
    owner: Optional[str] = Field(default=None, description="Person responsible, if stated.")
    due: Optional[str] = Field(default=None, description="ISO date YYYY-MM-DD, if stated.")


class Entity(BaseModel):
    name: str
    type: Literal["person", "customer", "project", "topic", "ticket", "document"]


class Extraction(BaseModel):
    summary: str = Field(description="Two sentences at most.")
    intent: str = Field(description="What the author or meeting was trying to achieve, in a few words.")
    importance: int = Field(description="1 (noise) to 5 (needs the manager now).")
    account: Optional[str] = Field(default=None, description="Customer or project this belongs to, if any.")
    insights: list[Insight] = []
    entities: list[Entity] = []


ActionKind = Literal["jira.create_issue", "slack.post_message", "calendar.create_event",
                     "gmail.create_draft", "confluence.create_page"]
KIND_AGENT = {"jira.create_issue": "fox", "slack.post_message": "firefly", "calendar.create_event": "raven",
              "gmail.create_draft": "raven", "confluence.create_page": "tortoise"}


class ActionParams(BaseModel):
    """Union of every action's parameters; unused fields stay null."""
    summary: Optional[str] = None           # jira
    description: Optional[str] = None       # jira, calendar
    assignee: Optional[str] = None          # jira
    channel: Optional[str] = None           # slack
    text: Optional[str] = None              # slack
    title: Optional[str] = None             # calendar, confluence
    start: Optional[str] = None             # calendar, ISO datetime
    duration_minutes: Optional[int] = None  # calendar
    attendees: Optional[list[str]] = None   # calendar
    to: Optional[str] = None                # gmail
    subject: Optional[str] = None           # gmail
    body: Optional[str] = None              # gmail, confluence


class ProposedAction(BaseModel):
    kind: ActionKind
    title: str = Field(description="Short imperative label, e.g. 'Create Jira ticket'.")
    detail: str = Field(description="One line the manager reads before approving.")
    params: ActionParams


class Proposal(BaseModel):
    notification: str = Field(description="One or two sentences telling the manager what happened and what is waiting.")
    actions: list[ProposedAction] = []
