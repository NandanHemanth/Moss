# Moss frontend

Web UI for Moss, the multi-agent knowledge platform demo. Vite + React + TypeScript on
[refine](https://refine.dev) (headless `@refinedev/core` v5 with `@refinedev/react-router` and react-router v7),
plain CSS, and `d3-force` for the graph page.

Layout A ("Clearing") from `docs/mockups/moss-ui-mockups.html`, for both roles (manager / employee) and both
themes (Notebook = light, Enchanted grove = dark).

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The backend must be running (default `http://localhost:8000`). **Keep the dev server on port 5173**: the backend's
CORS allow-list only contains `http://localhost:5173` and `http://127.0.0.1:5173` (override on the backend with
`CORS_ORIGINS`). `vite.config.ts` pins the port with `strictPort`.

Other scripts:

```bash
npm run build      # type-check (tsc --noEmit) + production build into dist/
npm run preview    # serve dist/ on port 5173
npm run typecheck  # tsc --noEmit only
```

## Environment

| Variable       | Default                 | Meaning                                    |
| -------------- | ----------------------- | ------------------------------------------ |
| `VITE_API_URL` | `http://localhost:8000` | Base URL of the Moss API, no trailing slash |

Copy `.env.example` to `.env` to change it. Every request carries `X-Moss-User: <user id>`; the SSE stream uses
`?user=<id>` because `EventSource` cannot send headers.

Choices remembered in `localStorage`: `moss.user` (demo user, default `maya`), `moss.theme` (`light` | `dark`),
`moss.voice` (`on` | `off`, default off).

## What is where

```
src/
  main.tsx                     entry: applies the saved theme, mounts <App/>
  App.tsx                      <Refine> setup: providers, resources, routes; everything is keyed by the selected user
  config.ts                    API base URL, default and pinned demo users
  session.ts                   persisted stores: user, theme, voice preference
  types.ts                     API data shapes (from docs/02-api-contract.md)
  providers/
    http.ts                    fetch wrapper: X-Moss-User header, JSON, HttpError {message, statusCode}
    dataProvider.ts            refine DataProvider (getList / update / custom …) over the REST API
    authProvider.ts            identity = selected demo user (GET /api/me); getPermissions returns the role
    accessControlProvider.ts   manager vs employee rules (`canRole`) used by useCan / <CanAccess>
    liveProvider.ts            refine LiveProvider on top of GET /api/stream (SSE); maps events to resources
  hooks/
    useMoss.ts                 typed wrappers: useMossList (useList), useMossQuery (useCustom), useAgents, useAllowed, useRole
    voice.ts                   spoken notifications: audio endpoint -> speechSynthesis fallback, queue, mute
  lib/
    agents.ts                  THE agent avatar map (glyph + colour per agent id) and mode-tag helpers
    format.ts                  dates, relative time, greeting, small text helpers
  components/
    Shell.tsx                  layout: top-right controls (user, theme, voice), sidebar, status strip, live bridge
    AgentAvatar.tsx            round agent badge + agents context (names always come from GET /api/agents)
    ProposalCard.tsx           proposal: event, insight chips, action rows with Approve / Edit / Skip / Approve all
    CommitmentsTable.tsx       open commitments with "Done" (and undo)
    Whispers.tsx               notification feed (right rail)
    Scenery.tsx                forest SVG + fireflies for the dark theme
    States.tsx                 loading / empty / error blocks
  pages/
    Clearing.tsx               "/"  manager Clearing, employee "My work"
    Ask.tsx                    "/ask"  chat with one agent
    Timeline.tsx               "/timeline"  unified timeline, account + source filters
    Graph.tsx                  "/graph"  force-directed knowledge graph
  styles/
    theme.css                  design tokens for both themes + components ported from the mockup
    app.css                    forms, states, status strip, ask, timeline, graph, small-screen tweaks
```

## How the pieces talk to the API

- **Lists** (`proposals`, `commitments`, `notifications`, `timeline`, plus the lookups `agents`, `accounts`, `users`)
  go through refine `useList`. `eq` filters become query-string parameters (`?status=open&account=…`).
- **Everything else** (`/api/status`, `/api/graph`, `/api/demo/queue`, `/api/ask`, `/api/actions/{id}/decide`,
  `/api/proposals/{id}/approve-all`, `/api/demo/meeting-ended`, `/api/sync`) goes through `useCustom` /
  `useCustomMutation`; marking a commitment done uses `useUpdate` (`PATCH /api/commitments/{id}`).
- **Live updates**: `liveProvider.ts` keeps one `EventSource` per selected user. With refine `liveMode: "auto"`,
  lists refetch when their resource gets an event:

  | SSE event      | Lists that refetch                                  |
  | -------------- | --------------------------------------------------- |
  | `proposal`     | proposals                                           |
  | `action`       | proposals, timeline                                 |
  | `timeline`     | timeline, commitments, accounts, proposals          |
  | `notification` | notifications                                       |

  Every event is also published on the `moss` channel; `Shell.tsx` listens there (`useSubscription`) to refresh
  status / graph / demo queue and to feed the voice queue.
- **Roles**: the backend enforces them (403). The UI additionally hides or disables what a role cannot do via the
  `accessControlProvider` (`useCan`, `<CanAccess>`).
- **Switching user** (top right) goes through `authProvider.login` (`useLogin`); the whole refine tree is keyed by the
  user id, so the query cache, identity, permissions and the SSE connection are rebuilt for the new user.

## Voice (manager only)

Off by default, because browsers block audio until the user interacts with the page; the toggle click is that
interaction. When on, each new `notification` event is read aloud: `GET /api/notifications/{id}/audio` → play the
audio on `200`, or speak the text with `window.speechSynthesis` on `204`. Utterances are queued (never overlap) and
muting stops the current one immediately. If voice was left on in an earlier visit, the toggle says
"Voice on — click anywhere to start" until the first click or key press on the page.

## Resetting demo data

```bash
cd backend && . ../.venv/bin/activate && MOSS_FORCE_MOCK=1 python -m moss.seed --reset
```

The server keeps running; reload the page afterwards.
