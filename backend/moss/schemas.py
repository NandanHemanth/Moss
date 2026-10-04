"""Typed shapes the LLM must return. Kept flat so Gemini structured output accepts them."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Insight(BaseModel):
    kind: Literal["decision", "commitment", "risk", "request"]
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


class HelpRequest(BaseModel):
    team: Literal["HR", "Finance", "DevOps"]
    reason: str = Field(description="One sentence: why this team is needed.")
    subject: str
    body: str = Field(description="Short, polite email asking for the specific help. Plain text.")


class Proposal(BaseModel):
    notification: str = Field(description="One or two sentences telling the manager what happened and what is waiting.")
    actions: list[ProposedAction] = []
    help: list[HelpRequest] = Field(default=[], description="Usually empty. Only when the team clearly needs outside help.")


# ---- canvas workflows
NodeType = Literal["input", "meeting", "gmail", "calendar", "slack", "jira", "confluence", "llm", "output"]


class NodeDraft(BaseModel):
    type: NodeType
    label: str = Field(description="Two to four words.")
    trigger: Optional[str] = Field(default=None, description="First node only: when this workflow should start, in plain words.")
    description: str = Field(description="What this node does, in one or two plain sentences.")
    input: Optional[str] = Field(default=None, description="What it receives.")
    output: Optional[str] = Field(default=None, description="What it produces.")


class WorkflowDraft(BaseModel):
    name: str
    description: str
    nodes: list[NodeDraft] = Field(description="In execution order, first node is the trigger, last is an output node.")


class StepResult(BaseModel):
    node_id: str
    output: str = Field(description="What this node produced: the text, the message, or a one-line description of the action.")
    params: Optional[ActionParams] = Field(default=None, description="Only for gmail, calendar, slack, jira and confluence action nodes.")


class WorkflowResult(BaseModel):
    steps: list[StepResult]
    summary: str = Field(description="One sentence for the manager.")


class Matches(BaseModel):
    workflow_ids: list[str] = Field(default=[], description="Ids of the workflows whose trigger condition this event satisfies.")


class BriefTask(BaseModel):
    task: str = Field(description="Imperative, under 12 words.")
    why: str = Field(description="Under 16 words, grounded in the facts given.")


class Brief(BaseModel):
    next_tasks: list[BriefTask] = Field(description="At most three.")
    summary: list[str] = Field(default=[], description="At most three short sentences for stakeholders. Empty if not asked.")
