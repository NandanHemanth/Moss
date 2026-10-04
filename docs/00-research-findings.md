# Moss — research findings (2026-10-03)

Status: research only. Nothing here is a decision until Nandan confirms it.
Method: official docs and OpenAPI specs were fetched, and the GitHub repos were cloned and read. Nothing was run live. Items marked **UNVERIFIED** could not be confirmed from a primary source.

## 1. Headline findings

1. **None of the three agent repos is a usable foundation as-is.** OpenDots and openmuse both refuse to run without a CopilotKit Intelligence key (a hosted service outside their MIT licence). OpenHarness is a terminal coding agent with no web server and no commits since June 2026.
2. **Graphify is not a runtime knowledge-graph library.** It is an AI-coding-assistant skill that maps a folder of files into a graph. It can be used in batch mode for Moss, but its schema is code/document-centric.
3. **Zoom's free plan gives no transcripts, recordings or summaries through the API.** A free route exists (local recording plus local Whisper), but it is not "Zoom API gives me the transcript".
4. **Gemini's free tier may use prompts for training and human review.** Google's terms say not to submit confidential data to the unpaid tier, so the demo should run on synthetic company data.
5. **freellmapi's own README says not to build on it** and not to share the endpoint with other people. Fine as a local fallback for a solo demo.
6. Gmail, Calendar, Slack, Jira and Confluence are all usable for free with full read and write.

## 2. Third-party APIs

### Summary

| Service | Free for a demo? | Read | Write | Real-time without a public URL | Main demo gotcha |
|---|---|---|---|---|---|
| Gmail | Yes | messages, threads, labels, attachments, drafts, history | send, draft, label, trash | Poll `history.list` (push needs Pub/Sub + billing account) | Refresh token expires every 7 days while the OAuth app is in "Testing" |
| Google Calendar | Yes | events, attendees + RSVP, free/busy, calendars | create/update/delete events, invite attendees, Meet link | Poll with `syncToken` (push needs public HTTPS) | Same 7-day token expiry |
| Slack | Yes (free workspace) | channels, messages, threads, users, files, reactions | post, DM, schedule, react, create channel, upload | Yes, Socket Mode | Only the last 90 days are visible, to the API too |
| Jira Cloud | Yes (Free plan, 10 users) | issues via JQL, comments, changelog, projects, boards, sprints, users | create/edit/assign/transition issues, comment, link, sprints | No, webhooks need public HTTPS; otherwise poll JQL | Old `/rest/api/3/search` is removed; use `/search/jql` |
| Confluence Cloud | Yes (Free plan, 10 users) | pages, spaces, blog posts, comments, attachments, labels, CQL search | create/update pages, blog posts, comments, labels, attachments | No simple webhook; poll CQL `lastmodified` | Must mix v2 (CRUD) and v1 (CQL search, attachment upload, labels) |
| Zoom | Partly | meetings list/details, `meeting.ended` webhook | create/update/delete meetings | Webhooks need public HTTPS | **No recordings, transcripts or summaries via API on Basic** |

### Gmail and Google Calendar

- **Cost:** "All standard use of the API is available at no additional cost." Google plans to charge above a daily threshold later in 2026 (80M quota units/day for Gmail, 1M requests/day for Calendar), far above demo volume.
- **Per-user limits:** Gmail 6,000 quota units/min (a `messages.get` is 20, a send is 100); Calendar 600 requests/min.
- **Scopes:** every Gmail scope that reads mail is *restricted* (`gmail.readonly`, `gmail.modify`, `gmail.compose`); `gmail.send` is *sensitive*. Apps with under 100 users, or in development, are exempt from verification.
- **Testing-mode limits (personal Gmail account):** 100 test users, an "unverified app" warning, and consent plus refresh token **expire after 7 days**. "Internal" app type needs a Workspace organization.
- **Real-time:** Gmail push goes through Cloud Pub/Sub (free at this volume but appears to need a billing account). Calendar push needs a public HTTPS webhook. Both have a polling alternative that needs neither: `history.list` from a `historyId`, and `events.list` with a `syncToken`.
- **Meet links:** created with `conferenceData.createRequest` and `conferenceDataVersion=1`. Whether this works on consumer Gmail accounts is **UNVERIFIED**.
- **Official MCP server:** exists in Developer Preview (Gmail tools have no send; Calendar tools cover create/update/delete). It is gated behind the Workspace Developer Preview Program; whether a personal account can join is **UNVERIFIED**.

### Slack

- **Free workspace limits:** 10 apps, messages and files from the last 90 days only (the API returns `is_limited` beyond that), 5 GB of files.
- **Rate limits:** the May 2025 cut to `conversations.history` (1 request/min, 15 messages) applies only to commercially distributed non-Marketplace apps. An internal app in your own workspace keeps Tier 3 (50+/min, up to 1,000 messages per call).
- **Tokens:** a bot token reads only channels the bot has been added to. Legacy search (`search.messages`) needs a user token.
- **Real-time:** Socket Mode delivers events over a WebSocket with no public URL. Events include `message.channels`, `message.im`, `app_mention`, `reaction_added`, `file_shared`.
- **Canvases on free:** one canvas per channel, no standalone canvases.
- **Official MCP server:** generally available at `https://mcp.slack.com/mcp`, usable by internal apps. Free-plan availability is **UNVERIFIED**.

### Jira Cloud

- **Free plan:** 10 users, 2 GB. No API restriction is documented, though no page says so explicitly.
- **Simplest auth for a demo:** API token with basic auth (`email:token`). Tokens expire within 1 year at most. This traffic is exempt from the points-based rate limits enforced since March 2026.
- **Search:** `POST /rest/api/3/search/jql`. JQL must be bounded, pagination uses `nextPageToken`, and `fields` defaults to `id` only.
- **Webhooks:** `jira:issue_created/updated/deleted`, registered in the admin UI or by REST; the receiver must be public HTTPS with a valid certificate.

### Confluence Cloud

- **Free plan:** 10 users, 2 GB; every user can edit everything.
- **API split:** v2 for page, blog post, space and comment CRUD; v1 for CQL search, attachment upload, label writes.
- **Body formats:** `storage` (XHTML) or `atlas_doc_format`.
- **Webhooks:** only through a Connect app descriptor, so a demo should poll.

### Atlassian Rovo MCP server

- Generally available, covers Jira and Confluence read, search and write.
- Free plan: 500 calls/hour. Supports API-token auth if the org admin enables it.
- Whether the credit-consuming Rovo search tools work on Free is **UNVERIFIED**.

### Zoom

- **Basic (free) can:** create, update, delete and list meetings; receive `meeting.ended`; record locally in the desktop app (MP4 + M4A files on the host's disk); hold 40-minute meetings.
- **Basic cannot:** cloud recording, VTT transcripts, or `meeting_summary` via API (all documented as Pro or higher). The in-product AI summary is offered for 3 meetings a month on Basic, but API retrieval is documented as paid.
- **Live audio/transcript:** RTMS is paid (developer credits, about $0.01 per streaming minute without transcription). Zoom's Meeting SDK is now "reserved for human use cases" and does not support notetaker bots.
- **Zoom MCP server:** exists; its recordings tool carries the same Pro prerequisite.

### Free routes to a meeting transcript

| Option | Licence | What it gives | Effort | Catch |
|---|---|---|---|---|
| Zoom local recording + faster-whisper | Zoom Basic; MIT | Transcript from the M4A file | Low | No webhook; the file must be uploaded or picked up from a folder |
| + WhisperX / pyannote | BSD-2; MIT + CC-BY-4.0 model | Speaker labels | Medium | Hugging Face token; GPU recommended |
| Vexa self-hosted | Apache-2.0 | Bot joins Zoom/Meet/Teams, REST transcript API | Medium-high (Docker) | Zoom via web client only; reliability on Basic meetings **UNVERIFIED** |
| Jitsi self-hosted + Jigasi + Skynet | Apache-2.0 | Live transcripts | High | Replaces Zoom entirely; public meet.jit.si has no transcription |
| Meetily | MIT | Local capture, transcript, summary | Low | Desktop app, no documented API |
| Google Meet REST API | — | Transcripts | Low | Paid Workspace editions only |

## 3. Agent frameworks

| | OpenDots | openmuse | OpenHarness |
|---|---|---|---|
| What it is | App template for several "Dot" agents | Single-user personal-agent app template | Python port of Claude Code (CLI coding agent) |
| Language | TypeScript (Hono, React 19, SQLite) | TypeScript (Hono, Expo/React Native, Postgres) | Python |
| Activity | First commit 2026-09-29 (4 days old) | First commit 2026-09-15 | 429 commits, last 2026-06-04 |
| Hosted dependency | **CopilotKit Intelligence key required** | **CopilotKit Intelligence key required** | None |
| Multiple agents | Yes, independent | No (one agent) | Yes (subprocess workers) |
| Orchestrator / delegation | No ("further work") | No | Yes |
| Per-agent tool sets | Two boolean flags | n/a | Declared; enforcement not found in the spawn path |
| User roles | No (single owner) | No (single owner) | No |
| Gemini | Via OpenAI-compatible URL | Native adapter | Built-in profile |
| OpenAI-compatible base URL | Yes (chat completions) | Responses API only | Yes |
| Model fallback | No | No | No |
| MCP for your own tools | No | No | Yes |
| Human approval | In-chat card | Stored propose → approve/deny queue | Per-tool prompt |
| Drivable from web React | Yes (AG-UI + hooks) | Server yes; client is React Native | No server at all |

- CopilotKit Intelligence free tier: 3-day thread retention, 200 threads; self-hosting needs a paid plan.
- **Worth borrowing:** openmuse's `ActionService` (propose, hash, expire, approve/deny, record outcome) is the exact pattern Moss's manager approval inbox needs. OpenDots shows how to wire CopilotKit hooks and a server-side route guard.
- **What they sit on:** CopilotKit runtime + the AG-UI protocol. The CopilotKit runtime itself works without Intelligence, and AG-UI lists Google ADK, LangGraph, CrewAI, Pydantic AI and others as supported backends.

## 4. Knowledge graph layer

**Graphify** (Apache-2.0, Python, package `graphifyy`):

- README: "Type `/graphify` in your AI coding assistant and it maps your entire project ... into a knowledge graph".
- Input is files on disk. There is no "add this message" API. Semantic extraction truncates a file at 20,000 characters.
- Schema is file-centric: relations such as `calls`, `implements`, `references`, `cites`. No Person / Meeting / Ticket types, no time validity on facts.
- Supports Gemini for extraction; outputs `graph.json`, an HTML viewer, GraphML, Neo4j push; query by CLI or a read-only MCP server.
- The always-on version over meetings and docs is their commercial product.
- **Usable for Moss only as a batch job:** write each email, thread, ticket and transcript to a `.md` file, re-run `graphify extract`, then query.

**Alternatives built for agent memory:**

| Project | Licence | Note |
|---|---|---|
| Graphiti (getzep) | Apache-2.0 | Temporal graph for agents; Gemini supported; needs Neo4j or FalkorDB |
| LightRAG (HKUDS) | MIT | Graph + vector RAG; NetworkX file storage, no DB server; Gemini supported; REST API |
| Microsoft GraphRAG | MIT | Indexing is LLM-expensive |
| Cognee | Apache-2.0 | Runs on SQLite/Postgres; Gemini support **UNVERIFIED** |
| NetworkX | BSD-3 | Plain in-process graph library |
| Kuzu | MIT | **Archived October 2025** |
| Neo4j Community / FalkorDB | GPLv3 / SSPLv1 | FalkorDB's licence is not OSI-approved |

## 5. LLM layer

**Gemini API free tier**

- Free of charge: `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite` and other Flash models; `gemini-embedding-2`; `gemini-3.8-flash-tts`. Pro models are not free.
- Function calling, structured output, streaming and an OpenAI-compatible endpoint are available.
- **Rate limits are not published**; they are shown per project at aistudio.google.com/rate-limit. Exact numbers for your project are unknown until you check.
- Terms for the unpaid tier: content is used to improve products, human reviewers may read it, and "Do not submit sensitive, confidential, or personal information".

**freellmapi** (MIT, Node, Docker, port 3001)

- Pools your own free-tier keys from 34 providers behind one OpenAI-compatible endpoint with streaming, tool calling and automatic failover.
- Its own caveats: "for personal experimentation and learning, not production", "no sharing your endpoint with other humans", quality "degrades as the day progresses", tool-call behaviour varies by whichever model answers.
- Alternatives: LiteLLM (MIT, fallback routing in-process), OpenRouter free models (50 requests/day without credits), Groq free tier, Ollama (local).

## 6. Voice

**ElevenLabs free plan**

- 10,000 credits a month, API included, **no commercial licence**, attribution required.
- A 150-character notification costs 75–150 credits, so the allowance covers **66 to 133 spoken notifications a month**. Cached audio for repeated phrases stretches this.
- For short, complete strings the plain HTTP endpoint is recommended over WebSocket; `eleven_flash_v2_5` is the low-latency model (about 75 ms).
- Free fallbacks: browser Web Speech API (no key), Kokoro (Apache-2.0), Gemini Flash TTS (free tier).

## 7. Frontend: refine

- MIT, v5 (`@refinedev/core` 5.2), React 18/19, Vite + React Router or Next.js.
- UI kits: Ant Design, MUI, Mantine (pinned to v5), Chakra (pinned to v2), shadcn/ui (Tailwind v4, source copied into the project, ships a theme toggle), or headless.
- Roles: `authProvider.getPermissions` + `accessControlProvider.can()`. This only hides UI; the backend must enforce Manager vs Employee itself.
- Notifications: needs a small custom live provider (no built-in WebSocket/SSE one).
- Paid-only parts: Okta provider, multitenancy package, Devtools on non-default ports. None are needed.

## 8. Still unverified

- Gemini free-tier RPM/RPD numbers for the project.
- Whether Meet links can be created on a consumer Gmail account.
- Whether moving the Google OAuth app to "In production" (unverified) removes the 7-day token expiry.
- Slack MCP and Real-time Search on the free plan.
- Explicit confirmation that Jira/Confluence Free include API and webhooks (implied, not stated).
- Vexa bot joining Zoom Basic meetings.
- CopilotKit hooks inside a refine app (both are plain React; no documented pairing found).

## 9. Sources

- Gmail: https://developers.google.com/workspace/gmail/api/reference/quota · https://developers.google.com/workspace/gmail/api/auth/scopes · https://developers.google.com/workspace/gmail/api/guides/push · https://developers.google.com/workspace/gmail/api/guides/sync
- Calendar: https://developers.google.com/workspace/calendar/api/guides/quota · https://developers.google.com/workspace/calendar/api/v3/reference · https://developers.google.com/workspace/calendar/api/guides/sync
- Google OAuth testing mode: https://support.google.com/cloud/answer/15549945 · https://support.google.com/cloud/answer/13464323
- Slack: https://slack.com/help/articles/115002422943-Usage-limits-for-free-workspaces · https://docs.slack.dev/apis/web-api/rate-limits · https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps · https://docs.slack.dev/apis/events-api/using-socket-mode · https://docs.slack.dev/ai/slack-mcp-server/
- Jira: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/ · https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/ · https://developer.atlassian.com/cloud/jira/platform/webhooks/ · https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/
- Confluence: https://developer.atlassian.com/cloud/confluence/rate-limiting/ · https://developer.atlassian.com/cloud/confluence/modules/webhook/ · https://support.atlassian.com/confluence-cloud/docs/learn-about-confluence-cloud-plans/
- Atlassian MCP: https://developer.atlassian.com/cloud/rovo-mcp/ · https://www.atlassian.com/platform/rovo-mcp
- Zoom: https://developers.zoom.us/docs/api/rate-limits/ · https://zoom.us/pricing · https://developers.zoom.us/docs/rtms/meetings/ · https://developers.zoom.us/docs/meeting-sdk/ · https://developers.zoom.us/docs/mcp/
- Transcription: https://github.com/SYSTRAN/faster-whisper · https://github.com/m-bain/whisperX · https://github.com/Vexa-ai/vexa · https://github.com/jitsi/skynet · https://github.com/Zackriya-Solutions/meeting-minutes
- Agent repos: https://github.com/CopilotKit/OpenDots · https://github.com/CopilotKit/openmuse · https://github.com/HKUDS/OpenHarness · https://docs.ag-ui.com
- Knowledge graph: https://github.com/Graphify-Labs/graphify · https://github.com/getzep/graphiti · https://github.com/HKUDS/LightRAG
- LLM: https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/rate-limits · https://ai.google.dev/gemini-api/terms · https://github.com/tashfeenahmed/freellmapi · https://github.com/BerriAI/litellm
- Voice: https://elevenlabs.io/pricing · https://elevenlabs.io/docs/api-reference/introduction · https://elevenlabs.io/docs/models
- refine: https://github.com/refinedev/refine
