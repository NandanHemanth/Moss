# Moss

An enterprise knowledge platform built on a multi-agent harness. Moss reads what happens across
Gmail, Calendar, Slack, Jira, Confluence and meeting transcripts, remembers decisions and commitments
in a knowledge graph, and proposes the next actions for a manager to approve.

> Demo data is a fictional company (Tidewater Labs). Everything runs with no keys at all in mock mode;
> each real service switches on when its credentials are added.

## The grove

| Agent | Tool | What it does |
|---|---|---|
| **Stag** (orchestrator) | all agents | Plans across tools, proposes next actions. Managers only. |
| **Raven** | Gmail + Calendar | Reads mail and calendar, drafts email, schedules events |
| **Firefly** | Slack | Reads channels, posts messages |
| **Fox** | Jira | Searches and creates issues |
| **Owl** | Meetings | Reads transcripts, extracts decisions, commitments, risks |
| **Tortoise** | Confluence | Searches and creates pages |

Names live in one place: `backend/moss/config.py` (`AGENTS`).

## How it works

```
event (meeting, email, Slack, Jira, Confluence)
  └─▶ understand   source agent extracts intent, decisions, commitments, risks   (Gemini, structured output)
  └─▶ connect      facts written to the knowledge graph and SQLite
  └─▶ recommend    Stag reads related graph context + past approvals, proposes actions
  └─▶ approve      manager approves / edits / skips in the UI   (nothing executes before this)
  └─▶ act          the owning agent calls the real API (Jira, Slack, Calendar, Gmail, Confluence)
  └─▶ tell         1–2 sentence notification, spoken by ElevenLabs (mutable)
  └─▶ learn        outcome is written back to the graph and fed into later proposals
```

**Memory, three layers**

1. **Cache** (`moss/cache.py`): in-process TTL cache for LLM answers, graph lookups and voice audio.
2. **Knowledge graph** (`moss/graph.py`): Graphiti on Neo4j (temporal facts) plus a typed fact store in
   SQLite that is always on and gives every answer a source link. Graphiti is used when
   `NEO4J_PASSWORD` and `GEMINI_API_KEY` are set.
3. **SQLite** (`moss/db.py`): system of record — users, raw events, insights, commitments, proposals,
   approvals, notifications, audit log.

**Access levels** are enforced in the API (`moss/api.py`), not just hidden in the UI:

| | Employee | Manager |
|---|---|---|
| Talk to a single tool agent | yes | yes |
| Talk to Stag (orchestrator) | no | yes |
| See proposals | only from own meetings, read-only | all |
| Approve / edit / skip actions | no | yes |
| Notifications + voice | no | yes |
| Commitments, timeline, graph | own only | all |

**LLM routing** (`moss/llm.py`): Gemini → any OpenAI-compatible endpoint (e.g. freellmapi) → offline.
Offline mode uses the extraction stored with the seeded data and a rule-based proposer, so the demo
still runs if a quota is exhausted.

## Stack

- Backend: Python, FastAPI, Google ADK (agents), AG-UI endpoint for Stag (`/agui/stag`), Graphiti, SQLite
- Frontend: React + Vite + [refine](https://github.com/refinedev/refine) (headless), plain CSS, two themes
- Everything is open source; every third-party service is used on its free tier

## Quick start (Windows PowerShell, mock mode, no keys)

```powershell
# 1. backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
copy .env.example .env
python -m moss.seed --reset
uvicorn moss.api:app --port 8000

# 2. frontend (second window)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Then in the UI: click **A meeting just ended**, approve the proposed actions, switch user to Sam to see
the employee view, and toggle the theme.

To connect real services, follow [`docs/03-setup.md`](docs/03-setup.md).

## Tests

```powershell
cd backend
python -m pytest -q      # 49 tests, all offline
```

## Docs

- [`docs/00-research-findings.md`](docs/00-research-findings.md) — what each API offers on its free tier, with sources
- [`docs/01-decisions-and-plan.md`](docs/01-decisions-and-plan.md) — decisions, architecture, scope
- [`docs/02-api-contract.md`](docs/02-api-contract.md) — every endpoint with sample responses
- [`docs/03-setup.md`](docs/03-setup.md) — connecting Gemini, Neo4j, Atlassian, Slack, Google, ElevenLabs

## Honest status

Tested here: the full pipeline, roles, approvals and UI in mock/offline mode, and the ADK agent loop
with a stand-in model. **Not yet run against real accounts:** Gemini, Graphiti/Neo4j, the live
connectors and ElevenLabs. Their request shapes are unit-tested against the official API specs, but the
first live run may surface fixes.
