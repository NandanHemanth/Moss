# Moss — decisions and 12-hour plan (2026-10-03)

## Decisions made by Nandan

| Topic | Decision |
|---|---|
| Agent foundation | Google ADK (Python) + AG-UI protocol; CopilotKit React hooks on the frontend |
| Knowledge graph | Graphiti + Neo4j Desktop (no Docker) |
| Meeting transcripts | Seeded transcript files (no live Zoom capture) |
| Demo data | Fresh demo accounts with a made-up company |
| Deadline | 12 hours |
| Main LLM | Gemini API (free tier) |
| Fallback LLM | freellmapi, local, behind an OpenAI-compatible URL |
| Voice | ElevenLabs free plan, with mute |
| Frontend | refine (React), light "notebook" and dark "enchanted grove" themes |
| Layout | A · Clearing |
| Agent names | Magical animals: Stag (orchestrator), Raven (Gmail + Calendar), Firefly (Slack), Fox (Jira), Owl (meetings), Tortoise (Confluence) |
| Runtime | Python 3.11+ and Node 20+ on Windows |

## Proposed, waiting for confirmation

- **refine UI kit:** built headless (refine core + plain CSS) to match the approved mockup exactly; no component kit.
- **Cache layer:** in-process TTL cache (no Redis, since Docker is out).
- **Scope cut for 12 hours** (below).

## Architecture

```
refine app (Vite, React)
   │  REST (data, approvals)  +  streaming (AG-UI, fallback plain SSE)
   ▼
FastAPI backend
   ├─ role guard: Employee → sub-agents only · Manager → Stag + sub-agents
   ├─ ADK agents
   │     Stag (orchestrator)
   │       ├─ Raven  Gmail + Calendar tools
   │       ├─ FireflySlack tools
   │       ├─ Fox    Jira tools
   │       ├─ Owl    transcript tools
   │       └─ TortoiseConfluence tools
   │     every tool has two adapters: live API and mock fixture
   ├─ pipeline: event → extract (decisions, commitments, risks, people)
   │            → graph + SQLite → Stag proposes actions → approval queue
   │            → approved actions run through the sub-agents → notification → voice
   ├─ memory
   │     L1 cache   in-process TTL: LLM answers, API reads, hot graph lookups
   │     L2 graph   Graphiti on Neo4j: typed, dated facts linked across tools
   │     L3 SQLite  users, roles, raw events, proposals, approvals, notifications, audit log
   └─ LLM router: Gemini → fallback OpenAI-compatible endpoint (freellmapi)
```

## 12-hour scope

**In (the demo spine, built first):**

1. A seeded meeting transcript is ingested; Owl extracts decisions, commitments and risks.
2. Facts land in the graph and SQLite.
3. Stag proposes actions: Jira ticket, Slack message, calendar event.
4. Manager approves in the UI; Fox, Firefly and Raven execute against the live demo accounts.
5. A 1–2 sentence notification appears and is spoken by ElevenLabs (mutable).
6. Ask box answers questions like "What did we discuss with Harborline last month?" from the graph, with sources.
7. Employee view: call single agents, see own commitments, no orchestrator, no approvals.
8. Light and dark themes.

**Cut or reduced:**

- Live Zoom integration (seeded transcripts instead).
- Real-time push from Gmail and Confluence (a "sync now" button and startup sync instead).
- Real login (a role switcher with two seeded users; roles still enforced on the backend).
- Slack Socket Mode events only if time remains.

## Timeline

| Hours | Work |
|---|---|
| 0–1 | Scaffold backend and frontend, seed dataset, mock connectors |
| 1–4 | Spine: ingest → extract → graph + SQLite → proposals → approval → mock execution; manager inbox UI |
| 4–6 | Live connectors: Jira, Slack, Calendar writes; Gmail and Confluence reads |
| 6–8 | Ask (graph Q&A), employee view, notifications feed, ElevenLabs voice |
| 8–10 | Themes, cache, LLM fallback |
| 10–12 | Seed live accounts, rehearse the demo, README, buffer |

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Graphiti makes several LLM calls per ingested item; Gemini free-tier limits for the project are unknown | Keep the seeded dataset small (30–40 items), ingest once before the demo; if still too slow, serve the typed facts from SQLite with an in-memory graph |
| CopilotKit hooks inside a refine app are undocumented as a pairing | One-hour timebox; otherwise stream over plain SSE |
| Code cannot be run on Nandan's PC from this session | Everything is tested against mock connectors in the cloud workspace; Nandan runs install and start commands locally |
| Account setup takes Nandan's time | Checklist below, done in parallel with the build; any service not set up stays on its mock adapter |

## Setup checklist (Nandan, in priority order)

1. **Gemini API key** from aistudio.google.com, and read the limits shown at aistudio.google.com/rate-limit for the Flash model.
2. **Neo4j Desktop**: install, create a local database, note the password.
3. **Atlassian**: create a free site with Jira and Confluence, one project (key `PLAT`) and one space; create an API token.
4. **Slack**: create a free workspace and an internal app; bot token plus app-level token. An app manifest will be provided.
5. **Google**: new demo Gmail account, Cloud project with Gmail and Calendar APIs enabled, OAuth consent screen in Testing with that account as test user, Desktop OAuth client, download `credentials.json`.
6. **ElevenLabs**: free account, API key.
7. Confirm Python 3.11+ and Node 20+ are installed.

Zoom needs no account, since transcripts are seeded.
