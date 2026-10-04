"""The agent team: one orchestrator for managers and five service agents, each with a fixed tool allow-list."""

from datetime import date

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
from google.adk.tools.agent_tool import AgentTool
from google.genai import types

from ..config import MODEL
from . import tools

GROUNDING = (
    "Only state facts that come from your tool results; if the tools return nothing relevant, say so plainly. "
    "Never claim to have sent, posted, created or booked anything: write actions are drafted with propose_action "
    "and need human approval. Keep answers short and scannable for a busy business user: a one-line summary, then "
    "bullets with names, dates and owners. Do not include raw ids. Today is {today}."
)

SERVICE_AGENTS = {
    "mail": {
        "name": "mail_calendar_agent",
        "description": "Searches Gmail threads and the calendar; drafts emails and calendar events for approval.",
        "tools": lambda: [tools.search_email, tools.get_calendar, tools.make_propose_action("mail", ("email", "calendar_event"))],
    },
    "slack": {
        "name": "slack_agent",
        "description": "Searches Slack channels and threads; drafts Slack messages for approval.",
        "tools": lambda: [tools.search_slack, tools.make_propose_action("slack", ("slack_message",))],
    },
    "jira": {
        "name": "jira_agent",
        "description": "Searches Jira issues, statuses, assignees and blockers; drafts Jira issues for approval.",
        "tools": lambda: [tools.search_jira, tools.make_propose_action("jira", ("jira_issue",))],
    },
    "meetings": {
        "name": "meetings_agent",
        "description": "Searches Zoom meeting transcripts for what was discussed, decisions, risks and commitments.",
        "tools": lambda: [tools.search_meetings],
    },
    "confluence": {
        "name": "confluence_agent",
        "description": "Searches Confluence specs, FAQs, runbooks and how-to pages.",
        "tools": lambda: [tools.search_confluence],
    },
}


def _model() -> Gemini:
    # Free-tier per-minute limits clear within seconds; daily limits never do, so keep the retry window short.
    return Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3, initial_delay=8, max_delay=30, http_status_codes=[429, 503]),
    )


def _instruction(role: str) -> str:
    return f"{role} {GROUNDING.format(today=date.today().isoformat())}"


def service_agent(key: str) -> LlmAgent:
    spec = SERVICE_AGENTS[key]
    return LlmAgent(
        name=spec["name"],
        model=_model(),
        description=spec["description"],
        instruction=_instruction(f"You are Moss's {tools.AGENT_LABEL[key]}. {spec['description']} Search before answering."),
        tools=spec["tools"](),
    )


def orchestrator() -> LlmAgent:
    return LlmAgent(
        name="orchestrator",
        model=_model(),
        description="Plans questions, delegates to service agents and memory, and answers with citations.",
        instruction=_instruction(
            "You are the Moss Orchestrator for managers. Plan how to answer, then gather context: use the knowledge "
            "graph (find_accounts_by_topic, explore_graph) to discover which accounts, people and topics are involved, "
            "the database (get_account_overview, get_open_commitments) for records and commitments, and delegate to "
            "the service agents for source content (meetings, email, Slack, Jira, Confluence). Call several sources "
            "when a question spans tools. When the user asks you to follow up or act, draft it with propose_action."
        ),
        tools=[
            tools.find_accounts_by_topic,
            tools.explore_graph,
            tools.get_account_overview,
            tools.get_open_commitments,
            tools.make_propose_action("orchestrator", ("email", "calendar_event", "slack_message", "jira_issue")),
            *(AgentTool(agent=service_agent(key)) for key in SERVICE_AGENTS),
        ],
    )
