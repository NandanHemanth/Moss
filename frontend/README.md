# Moss frontend

Web UI for Moss, the multi-agent knowledge platform demo. Vite + React + TypeScript on
[refine](https://refine.dev) (headless `@refinedev/core` v5 with `@refinedev/react-router` and react-router v7),
plain CSS, `d3-force` for the graph page, and `three` for the 3D backdrop of the dark theme.

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

| Variable       | Default                                                          | Meaning                                     |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `VITE_API_URL` | dev server: `http://localhost:8000` · production build: same origin | Base URL of the Moss API, no trailing slash |

Copy `.env.example` to `.env` to change it. Every request carries `X-Moss-User: <user id>`; the SSE stream uses
`?user=<id>` because `EventSource` cannot send headers.

Choices remembered in `localStorage`: `moss.user` (demo user, default `maya`), `moss.theme` (`light` | `dark`),
`moss.voice` (`on` | `off`, default off), `moss.motion` (`on` | `off`, default on), `moss.groveMusic` and
`moss.groveSounds` (`on` | `off`, both default on), `moss.code` (access code, only when the API is locked).

## Deploying

`npm run build` produces `dist/`. With `VITE_API_URL` unset, the production build calls the API on its own origin
(relative `/api/...`, including the SSE stream), so serve `dist/` and the backend behind one host; set
`VITE_API_URL` at build time only when the API lives elsewhere. Every URL goes through `api()` in `src/config.ts`.

**Access code.** On start the app calls `GET /api/health`. If it answers `locked: true` and no code is stored (or any
call returns 401 "access code required"), a single centred screen asks for the code (`components/AccessGate.tsx`).
An accepted code is stored as `moss.code` and sent as `X-Moss-Code` on every request and as `&code=` on the SSE URL.
When the API is not locked nothing changes.

**Motion preference.** Animation is an in-app choice, not the OS one: it defaults to **on** for everyone and
deliberately ignores `prefers-reduced-motion` (Windows with "Animation effects" turned off used to get a frozen
grove and no panel fade). The Motion switch in the settings popover (gear icon, top bar) flips it; the value is
mirrored as `data-motion="on|off"` on `<html>`. With motion off the grove shows one still frame (no render loop)
and every CSS transition/animation that is keyed on `[data-motion="off"]` is disabled. No stylesheet uses
`@media (prefers-reduced-motion)` any more.

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
    voice.ts                   spoken notifications: audio endpoint -> speechSynthesis fallback, queue, mute;
                               the on-request "Listen" (POST /api/speak) and the guard that holds the queue for it
  lib/
    agents.ts                  THE agent avatar map (glyph + colour per agent id) and mode-tag helpers
    sfx.ts                     grove creature sounds: GET /api/sfx/{name}, decoded cache, synthesised fallback tone
    format.ts                  dates, relative time, greeting, small text helpers
  components/
    Shell.tsx                  layout: top bar (identity, user switch, theme switch, grove button, settings gear),
                               sidebar (nav, compact agents, one status line with a details popover), live bridge
    Dashboard.tsx              the five tiles under the Ask bar (GET /api/dashboard + /api/dashboard/brief) and their details
    Charts.tsx                 tiny inline SVG charts for the tiles (sparkline, bars, burn-down, budget bar)
    Popover.tsx                the one popover (portal, kept inside the viewport, closes on Escape / outside click)
    AccessGate.tsx             access-code screen for a locked API
    AgentAvatar.tsx            round agent badge + agents context (names always come from GET /api/agents)
    ProposalCard.tsx           proposal: event, insight chips, action rows with Approve / Edit / Skip / Approve all,
                               "via workflow" tag, and the manager's "ask for help" row (email drafts, never sent)
    CommitmentsTable.tsx       open commitments with "Done" (and undo); first 5, then "Show all (n)"
    Whispers.tsx               notification feed (right rail)
    GroveBackdrop.tsx          dark theme backdrop: lazy-loads the 3D grove, falls back to Scenery; creature clicks
    GroveMusic.tsx             "View the grove" music: the audio file from GET /api/music (showcase mode only)
    Scenery.tsx                flat forest SVG + fireflies; only the fallback when WebGL is unavailable
    States.tsx                 loading / empty / error blocks
  pages/
    Clearing.tsx               "/"  manager Clearing, employee "My work"
    Ask.tsx                    "/ask"  chat with one agent
    Timeline.tsx               "/timeline"  unified timeline, account + source filters
    Graph.tsx                  "/graph"  force-directed knowledge graph
    Canvas.tsx                 "/canvas"  workflow canvas, managers only, lazy-loaded (employees are sent to "/")
                               test-run drawer: "Dry run — nothing was sent." -> "Send to approvals" -> the queued
                               actions with "Approve and run" (POST /api/proposals/{id}/approve-all) and their results
    Memory.tsx                 "/memory"  the three memory layers (cache, knowledge graph, SQLite) with live numbers
                               from GET /api/memory, and "Prove it": POST /api/memory/compare for one question
  grove/                       the 3D "Enchanted grove" scene (its own lazy chunk, see below)
  styles/
    theme.css                  design tokens for both themes + components ported from the mockup
    app.css                    forms, states, status strip, ask, timeline, graph, small-screen tweaks
    grove.css                  dark theme only: canvas layer, glass panels, open band, showcase mode
    ui.css                     loaded last: the spacing scale (--s1…--s5), top bar, compact sidebar, popovers,
                               dashboard tiles and charts, section headers, help row, access-code screen
    canvas.css                 the canvas page
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

**Listen (stakeholder summary).** The Stakeholder summary tile and its detail popover have a small "Listen"
button. Only a click starts it: the summary sentences are sent as one text to `POST /api/speak`; a `200` is played,
a `204` is spoken with `window.speechSynthesis`. The button reads "Stop" while it plays. It does not depend on the
voice switch above, and it holds the whisper queue while it reads (`holdVoice()` and `listen` in `hooks/voice.ts`);
a whisper it interrupts is read again afterwards.

## Enchanted grove (dark theme)

The dark theme sits on a live 3D scene: a moonlit clearing with fog-layered trees, light shafts, glowing
mushrooms, a pond, fireflies, and the six agents as animals — the white **stag** walks the clearing and stops
to look at you, the **fox** trots across the front and sometimes sits, the **owl** glides in and perches on the
snag, the **raven** crosses overhead, the **tortoise** creeps round its stones and a **firefly** swarm drifts
about. Everything is generated in code with [`three`](https://threejs.org) (MIT, `^0.186.1`); nothing is
downloaded at run time. The Notebook theme never loads any of it.

```
src/components/GroveBackdrop.tsx   mounts only when the theme is dark; dynamic import("../grove"); fallback logic
src/grove/index.ts                 createGrove(): renderer, camera, bloom, render loop, quality governor, dispose; TUNING
src/grove/layout.ts                where things are: camera, framing, moon, pond, snag, every animal's path
src/grove/environment.ts           sky, trees, ground, stones, ferns, grass, mushrooms, pond, shafts, particles
src/grove/creatures.ts             the animals: shapes, gaits, and their small state machines
src/grove/util.ts                  seeded random, noise, terrain height, the "loft" shape builder, glow shader patch
src/styles/grove.css               glass panels, the open band under the UI, "View the grove"
```

**How it is laid out.** The canvas is `position: fixed`, full viewport, `pointer-events: none`, behind the app.
Panels are glass (`--glass-pane`, `--glass-paper`, `--glass-blur` in `grove.css`). On screens wider than 1100px
and taller than 620px the frame becomes a fixed sheet whose columns scroll on their own, so a band of open
scene (`--band`) stays visible at the bottom, where the animals walk. On smaller screens the page scrolls as
before over the fixed scene. **View the grove** (top bar, dark theme only) fades the panels to near-invisible
and brightens the scene; click it again or press Escape to come back.

**Music in "View the grove".** Entering showcase mode plays one audio file, looped at low volume with a short
fade in and out (`components/GroveMusic.tsx`). The backend serves it at `GET /api/music`: the path in
`GROVE_MUSIC`, else the first `.mp3` in `backend/data/music`, else the first `.mp3` in the `backend` folder.
Nothing is shown on the page. "Music on / Music off" sits next to "Back to Moss" and is remembered; leaving
showcase mode stops the music and rewinds it. With no file on the server the toggle reads "Music unavailable".
Use a track you have the rights to before deploying publicly or committing the file.

**Creature sounds.** In showcase mode the canvas takes pointer events: clicking an animal (generous invisible
hit spheres, `pick()` in `grove/index.ts`) plays `GET /api/sfx/{stag|fox|owl|raven|tortoise|firefly}` at volume
0.5 and gives it a short glow pulse (the pulse is skipped with motion off, the sound is not). Every 18–40 s one
random creature is heard quietly (0.12); never two sounds at once, none while the tab is hidden. Sounds are
fetched on first use and kept decoded in memory; a `204` or a decode failure falls back to a soft synthesised
tone (`lib/sfx.ts`). "Sounds on / Sounds off" is remembered.

**Tuning.**

| What | Where |
| --- | --- |
| Pixel-ratio caps, bloom, exposure, parallax and sway, governor thresholds, the reduced-motion still time | `TUNING` in `grove/index.ts` |
| Particle and plant counts (fireflies 240, spores 300, swarm 46, grass tufts 3400, leaf cards ~4200, 84 trees) | `buildEnvironment`, `buildGrass`, `buildTrees` (`cardsPer`), `scatterTrees` in `grove/environment.ts` |
| What the lower quality levels drop | `setQuality` in `grove/environment.ts`, `setLevel` in `grove/index.ts` |
| Camera, horizon height, paths, where animals pause or sit | `grove/layout.ts`, and the `stops` / `sitMarks` / `Track(…, start)` values in `grove/creatures.ts` |
| Glass opacity, blur, band height, gutters | the tokens at the top of `styles/grove.css` |

Text contrast on the glass depends on `--glass-pane` and on `TUNING.exposure`; if you make the glass clearer or
the scene brighter, re-check the muted text over the moon.

**Quality levels.** 0 = bloom, device pixel ratio up to 1.5; 1 = no bloom, ratio up to 1.25; 2 = no bloom,
ratio 1, half the fireflies, leaf cards and light shafts, fewer spores and grass, and the panels stop blurring
(`data-grove-quality="2"` on `<html>`). The scene starts at a level guessed from the GPU's name (software
renderers at 2, older Intel graphics at 1, everything else at 0) and a governor steps down one level whenever the
average frame takes longer than 24 ms for two 2.5-second windows in a row. It never steps back up. Rough budget
at level 0: about 215k triangles, about 100 draw calls plus the bloom passes, about 850 particles; no shadow maps.

**Fallback and robustness.**

- No WebGL 2, context creation fails or the chunk fails to load: the flat SVG `Scenery` is shown instead
  (never both), without console errors. A context that is lost later is given 4 s to be restored (the loop then
  resumes); only if it stays lost does the SVG scenery take over.
- Motion off (the in-app toggle, not the OS setting): one still frame, no camera sway or parallax, animals
  stationary; it is redrawn only on resize or when the showcase is toggled.
- The loop pauses while the tab is hidden and resumes on `visibilitychange`, `pageshow` or window focus; a 2 s
  watchdog restarts it if it is ever found stopped while motion is on and the page is visible. The quality
  governor only lowers the level, it never stops the loop. Leaving the dark theme disposes every geometry,
  material and texture and releases the WebGL context.

**Debug switches** (query string, harmless): `?grove=high|medium|low` pins the quality, `?grove=govern` starts at
full quality with only the governor, `?grove=off` forces the SVG fallback, `?groveT=20` starts the scene 20
seconds in, `?groveFocus=stag|fox|owl|raven|tortoise|fireflies` points the camera at one animal.
`?groveAmbient=3` plays the ambient creature sound every 3 seconds.
`window.__mossGrove.info()` reports quality, draw calls, triangles and where each animal is;
`window.__mossGrove.creatureScreenPositions()` gives each animal's viewport pixel position (for click tests) and
`window.__mossGrove.pick(x, y)` says which animal is under a point.

## Resetting demo data

```bash
cd backend && . ../.venv/bin/activate && MOSS_FORCE_MOCK=1 python -m moss.seed --reset
```

The server keeps running; reload the page afterwards.
