# Moss — setup guide (Windows 11, PowerShell, no Docker)

Work through the steps in order. Moss runs after step 0 and every later step swaps one mock for the real
thing, so you can stop at any point and still demo.

**How to read this guide**

- Commands are for PowerShell. Paths assume the project is at `C:\Users\Nandan\Desktop\Garage\Moss`; adjust to yours.
- "(check: UI may differ)" marks a click path I could not confirm against current official docs.
- **Nothing in steps 1–8 has been run against real accounts.** The code is covered by tests against fake
  HTTP servers only. Expect to hit at least one small surprise per service; the troubleshooting table at
  the end covers the likely ones.
- Settings live in `backend\.env` and are read once at start-up. **After every change to `.env`, stop
  uvicorn (Ctrl+C) and start it again** (`--reload` only watches `.py` files).
- `.env`, `credentials.json` and `token.json` are secrets. Do not commit or share them.

| Step | What you get | Needs |
|---|---|---|
| 0 | Full demo on seeded data, offline | nothing |
| 1 | Real LLM answers and proposals | Gemini API key |
| 2 | Graphiti knowledge graph on Neo4j | Neo4j Desktop + step 1 |
| 3 | Live Jira and Confluence | Atlassian free site + API token |
| 4 | Live Slack | Slack free workspace + bot token |
| 5 | Live Gmail and Calendar | Google Cloud project + OAuth |
| 6 | ElevenLabs voice | ElevenLabs API key |
| 7 | Fallback LLM (optional) | a running freellmapi |
| 8 | Demo story inside the live accounts | steps 3 and 4 |

---

## 0. Run in mock mode (zero keys)

1. Install Python 3.11 or newer (the project was built and tested on 3.13) from <https://www.python.org/downloads/windows/>.
   Check: `python --version`.
2. Create the virtual environment and install the backend:

   ```powershell
   cd C:\Users\Nandan\Desktop\Garage\Moss
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   cd backend
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```

   If PowerShell refuses to run `Activate.ps1`, run this once and try again:
   `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
3. Create your settings file (everything in it is optional):

   ```powershell
   Copy-Item .env.example .env
   ```

4. Load the demo company. **`--reset` wipes the local database** (`backend\data\moss.db`), including
   anything you approved earlier:

   ```powershell
   python -m moss.seed --reset
   ```

5. Start the API (keep this window open):

   ```powershell
   uvicorn moss.api:app --reload --port 8000
   ```

6. In a second PowerShell window, check what is live:

   ```powershell
   Invoke-RestMethod http://localhost:8000/api/status -Headers @{ "X-Moss-User" = "maya" } | ConvertTo-Json -Depth 5
   ```

   You should see `"mode": "offline"` under `llm`, every connector as `"mock"`, and `"voice": "browser"`.
   Run this check again after each step below; it is the quickest way to see whether a key was picked up.
7. Start the frontend in a third window (needs Node.js): `cd C:\Users\Nandan\Desktop\Garage\Moss\frontend; npm install; npm run dev`,
   then open <http://localhost:5173>.

Tests, any time: `cd C:\Users\Nandan\Desktop\Garage\Moss\backend; python -m pytest -q` (they use a temporary database and no network).

---

## 1. Gemini API key

1. Open <https://aistudio.google.com/apikey> and sign in with the Google account you want to use.
2. Click **Create API key**, pick or create a project, and copy the key.
3. In `backend\.env` set:

   ```
   GEMINI_API_KEY=your-key
   ```

4. Restart uvicorn. `/api/status` should now show `llm.mode: gemini`.

**Free-tier limits.** Google does not publish fixed numbers; your project's requests-per-minute and
requests-per-day limits are shown at <https://aistudio.google.com/rate-limit> (documentation:
<https://ai.google.dev/gemini-api/docs/rate-limits>). If a model name in `.env` (`GEMINI_MODEL`,
`GEMINI_FAST_MODEL`) is not offered to your project, pick one from that page.

**Privacy.** On the free tier Google may use prompts to improve its products and human reviewers may read
them. Use only the made-up demo company, never real company data.

---

## 2. Neo4j Desktop (knowledge graph)

Optional. Without it Moss uses its built-in SQLite graph, which is enough for the demo.

1. Download and install Neo4j Desktop from <https://neo4j.com/download/>.
2. Open it and click **Create instance**. Enter an instance name (`moss`), keep the default Neo4j
   version, and set a password for the database user (`neo4j`). Click **Create**.
3. Start the instance with the play button on its card and wait until it shows as running.
4. In `backend\.env` set:

   ```
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=the-password-you-chose
   GRAPH_BACKEND=auto
   ```

   `bolt://localhost:7687` is the usual local address (check: the instance's connection details in
   Neo4j Desktop show the real one).
5. Restart uvicorn. `/api/status` shows `graph.backend: graphiti+local` once both `NEO4J_PASSWORD` and
   `GEMINI_API_KEY` are set. `graph.graphiti.enabled` turns true after the first item is ingested, and
   `graph.graphiti.last_error` shows why if it does not (wrong password, instance not started).

**Cost warning.** Graphiti makes several LLM calls for every item it ingests (entity extraction,
deduplication, embeddings). Loading the 15 seeded events can use a large share of a free-tier daily quota,
and ingestion runs in the background, one item at a time. If you hit rate limits, set
`GRAPH_BACKEND=local`: that turns Graphiti off and keeps the SQLite graph.

---

## 3. Atlassian: Jira + Confluence

1. Create a free site at <https://www.atlassian.com/software/jira/free> (pick a site name; your site URL
   becomes `https://<name>.atlassian.net`). Add Confluence to the same site from the app switcher
   (grid icon, top left) > **Confluence** (check: UI may differ).
2. **Jira project with key `PLAT`.** In Jira: side navigation > **Spaces** (older sites call this
   **Projects**) > **Create space** / **Create project** > pick a software template such as **Kanban** >
   **Use template**. Enter a name (for example `Platform`) and **change the key to `PLAT`** before you
   click create (check: UI may differ; the key field can be hidden under "more options"). If you end up
   with a different key, set `JIRA_PROJECT` to it instead.
3. **Confluence space.** In Confluence: **Spaces** > **Create a space** > any blank template > name it
   `Engineering` and set the space key to `ENG` (check: UI may differ). If Confluence generates another
   key, read it from the space URL (`…/wiki/spaces/<KEY>/…`) and set `CONFLUENCE_SPACE` to it.
4. **API token.** Open <https://id.atlassian.com/manage-profile/security/api-tokens> > **Create API token**
   (the plain one, **not** "Create API token with scopes") > give it a name and an expiry date (1 to 365
   days) > **Create** > **Copy to clipboard**. You cannot see it again later.
5. In `backend\.env` set:

   ```
   ATLASSIAN_SITE=https://<name>.atlassian.net
   ATLASSIAN_EMAIL=the-email-you-log-in-with
   ATLASSIAN_API_TOKEN=the-token
   JIRA_PROJECT=PLAT
   CONFLUENCE_SPACE=ENG
   ```

6. Restart uvicorn. `/api/status` should show `jira: live` and `confluence: live`.

Notes

- A connector shows "live" as soon as the three `ATLASSIAN_*` values are present; a wrong token only
  shows up as an error on the first real call.
- Assignees: Moss resolves a display name ("Sam Ortiz") to a Jira user. The demo people do not exist on
  your site, so issues are created unassigned and the result says so. To see assignment work, invite a
  real user and name them.
- New issues are created as type **Task** when the project has it, otherwise the first standard type.

---

## 4. Slack

1. Create a free workspace at <https://slack.com/get-started> (or use a test workspace you own).
2. In Slack, create two public channels: `#platform` and `#accounts`.
3. Open <https://api.slack.com/apps> > **Create New App** > **From a manifest** > pick your workspace >
   paste the contents of `docs\slack-app-manifest.yaml` > **Next** > review > **Create**.
4. Install it: in the app's left sidebar open **Install App** (or **OAuth & Permissions**) >
   **Install to Workspace** > **Allow** (check: UI may differ).
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) from **OAuth & Permissions**
   (check: UI may differ).
6. In `backend\.env` set:

   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_DEFAULT_CHANNEL=platform
   ```

7. Invite the bot to both channels: type `/invite @Moss` in `#platform` and again in `#accounts`.
8. Restart uvicorn. `/api/status` should show `slack: live`.

Bot scopes requested by the manifest (exactly what the code calls):

| Scope | Used for |
|---|---|
| `channels:read` | list public channels, map names to ids, see which ones the bot is in |
| `channels:history` | read messages in public channels the bot is in |
| `channels:join` | join a public channel before posting, if the bot was not invited |
| `chat:write` | post approved messages |
| `users:read` | turn user ids into display names |

Limits to know: only public channels are supported; the bot reads only channels it is a member of; a
free workspace exposes the last 90 days of messages. If you change scopes later, reinstall the app and
copy the new token.

---

## 5. Google: Gmail + Calendar

Use a personal Google account you are happy to demo with. Moss reads mail, creates **drafts** (it never
sends mail) and reads and creates calendar events.

1. **Project.** Open <https://console.cloud.google.com/>, click the project picker at the top >
   **New project** > name it `moss-demo` > **Create**, then select it.
2. **Enable the APIs.** Open each link with the project selected and click **Enable**:
   - <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
   - <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
3. **Consent screen.** Menu > **Google Auth platform** > **Branding** > **Get Started**.
   - **App Information**: app name `Moss`, your email as **User support email** > **Next**.
   - **Audience**: choose **External** > **Next**. ("Internal" exists only for Google Workspace organisations.)
   - **Contact Information**: your email > **Next**.
   - **Finish**: tick **I agree to the Google API Services: User Data Policy** > **Continue** > **Create**.
4. **Test user.** **Google Auth platform** > **Audience** > under **Test users** click **Add users** >
   enter your own Gmail address > **Save**. Leave the publishing status on **Testing**.
5. **Desktop client.** **Google Auth platform** > **Clients** > **Create Client** > **Application type**:
   **Desktop app** > name `Moss desktop` > **Create**. Download the JSON and save it as
   `C:\Users\Nandan\Desktop\Garage\Moss\backend\credentials.json`.
6. **Authorise.** With the virtual environment active:

   ```powershell
   cd C:\Users\Nandan\Desktop\Garage\Moss\backend
   python -m moss.connectors.google_auth
   ```

   A browser opens. Choose your account. On "Google hasn't verified this app" click **Advanced** >
   **Go to Moss (unsafe)** (check: UI may differ; this warning is normal for an app in Testing).
   **Tick every permission box** (Gmail read, Gmail drafts, Calendar events) and continue. The script
   writes `backend\token.json`.
7. Restart uvicorn. `/api/status` should show `gmail: live` and `calendar: live`.

Notes

- **The token expires after 7 days** while the app is in Testing. When Gmail or Calendar calls start
  failing with "authorisation expired or was revoked", run `python -m moss.connectors.google_auth` again.
- Scopes requested: `gmail.readonly`, `gmail.compose`, `calendar.events`. You do not need to add them
  under **Data Access**; the script asks for them at sign-in.
- Calendar invitations: the demo people have fake `@tidewater.example` addresses. Moss never invites
  those; it lists their names in the event description. A real address you type into an action **is**
  invited and, by default, emailed by Google. Set `CALENDAR_SEND_UPDATES=none` to add guests silently.
- Events are created in your primary calendar's time zone.

---

## 6. ElevenLabs voice

1. Sign up at <https://elevenlabs.io>. The free plan includes API access and 10,000 credits a month, with
   no commercial licence.
2. Create an API key: profile menu > **API Keys** > **Create API Key** (check: UI may differ; try
   <https://elevenlabs.io/app/settings/api-keys>). If you restrict the key, give it Text to Speech access.
3. In `backend\.env` set:

   ```
   ELEVENLABS_API_KEY=your-key
   ```

4. Restart uvicorn. `/api/status` should show `"voice": "elevenlabs"`.

- `ELEVENLABS_VOICE_ID` is optional. When empty, Moss uses `JBFqnCBsd6RMkjVDRZzb`, the voice id in the
  example request of ElevenLabs' own API reference
  (<https://elevenlabs.io/docs/api-reference/text-to-speech/convert>). I have not confirmed that this
  voice is available to every free account; if speech stays on the browser voice, copy a voice id from
  **Voices** in the ElevenLabs app and set it here.
- Model: `ELEVENLABS_MODEL=eleven_flash_v2_5` (low latency, lowest credit cost). Output is MP3.
- A notification of about 150 characters costs roughly 75 to 150 credits, so the free plan covers on the
  order of 70 to 130 spoken notifications a month. Moss caches each notification's audio for an hour and
  sends at most the first 1,000 characters of a notification.
- If ElevenLabs fails for any reason (no credits, bad key, timeout) Moss silently falls back to the
  browser's speech; the reason is in the uvicorn log.

---

## 7. Optional: fallback LLM through freellmapi

Used only when Gemini fails or has no key.

1. Install and start freellmapi following its README (<https://github.com/tashfeenahmed/freellmapi>). Its
   documented default port is 3001. I have not verified how it installs without Docker.
2. Find the model name. **It depends on your freellmapi install and the provider keys you gave it; there
   is no universal value.** Read it from the endpoint:

   ```powershell
   (Invoke-RestMethod http://localhost:3001/v1/models).data | Select-Object id
   ```

3. In `backend\.env` set:

   ```
   FALLBACK_BASE_URL=http://localhost:3001/v1
   FALLBACK_MODEL=an-id-from-the-list-above
   FALLBACK_API_KEY=none
   ```

   Set `FALLBACK_API_KEY` to a real value only if your freellmapi requires one.
4. Restart uvicorn; `/api/status` lists the fallback under `llm`.

freellmapi's own README says it is for personal experimentation, not production, and not to share the
endpoint with other people.

---

## 8. Put the demo story into the live accounts

Run this after steps 3 and 4 so Jira, Confluence and Slack contain the same story Moss knows.

```powershell
cd C:\Users\Nandan\Desktop\Garage\Moss\backend
python -m moss.seed_live --dry-run     # shows what would be created, writes nothing
python -m moss.seed_live               # everything that is configured
python -m moss.seed_live --slack       # or one tool: --jira, --slack, --confluence
```

What it does

- **Jira**: creates the three seeded issues in `JIRA_PROJECT`. Jira assigns its own keys (`PLAT-1`,
  `PLAT-2`, …), so they will not match the seeded `PLAT-131/136/138`.
- **Slack**: posts the three seeded messages to `#platform` and `#accounts`. The bot posts them, so each
  starts with the author's name in bold.
- **Confluence**: creates the two seeded pages in `CONFLUENCE_SPACE`.
- Re-running is safe: issues and pages whose title already exists, and messages already in the channel,
  are skipped. Jira's search index lags a few seconds, so do not re-run immediately after a first run.

**Gmail and Calendar are not seeded**: received mail cannot be fabricated. To have matching mail, send
yourself two or three emails from another account (or from the same one), using the subject (`title`)
and text (`body`) of the three `"source": "gmail"` entries in `backend\data\seed\events.json`
("Payroll integration before the January cycle", "Payroll integration demo for our nursing teams",
"Renewal questions and SSO"). For Calendar, create one or two events by hand, for example "Platform sync".

**Pulling live items into Moss (Sync).** `POST /api/sync` (manager only) pulls recent items from every
live connector as new events and runs up to five of them through the pipeline:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/api/sync -Headers @{ "X-Moss-User" = "maya" } | ConvertTo-Json -Depth 5
```

The live copies made by `seed_live` have different ids from the seeded story (for example `jira:PLAT-1`
next to the seeded `jira:PLAT-138`), so the Jira issues and Confluence pages will appear a second time in
the timeline after a Sync. Messages posted by the bot are skipped. For a clean demo, either Sync before
seeding the live accounts or accept the duplicates. To show a fresh live event, post a message yourself in
`#platform` and Sync.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A connector still shows `mock` in `/api/status` | Missing setting, or uvicorn not restarted | Jira/Confluence need `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` (all three). Slack needs `SLACK_BOT_TOKEN`. Gmail/Calendar need `backend\token.json` (run the auth module). Then restart uvicorn. |
| Everything shows `mock` although `.env` is filled in | `MOSS_FORCE_MOCK=1` | Set it to `0` and restart. |
| `.env` seems ignored | Wrong folder or name | The file must be `backend\.env` (not `.env.txt`, not the project root). |
| Jira/Confluence action fails with `401` or `403` | Wrong email or token, expired token, or a scoped token | Create a plain **API token**, use the exact login email, check `ATLASSIAN_SITE` is `https://<name>.atlassian.net`. |
| Jira `400 … project` or no search results | Project key mismatch | Set `JIRA_PROJECT` to the real key (shown before the dash in any issue key). |
| Confluence "space with key … not found" | Space key mismatch | Read the key from the space URL and set `CONFLUENCE_SPACE`. |
| Slack `not_in_channel` | The bot is not a member of that channel | `/invite @Moss` in the channel. Posting to a public channel joins automatically; reading does not. |
| Slack `channel_not_found` | Channel does not exist, is private, or is misspelt | Create it as a public channel, or fix the name. |
| Slack `missing_scope` | App installed before a scope was added | Reinstall the app from **Install App** and copy the new token. |
| Slack `invalid_auth` | Wrong or revoked token | Copy the **Bot User OAuth Token** (`xoxb-…`) again. |
| Gmail/Calendar "authorisation expired or was revoked" | 7-day expiry in Testing mode | `python -m moss.connectors.google_auth`, then restart uvicorn. |
| Google sign-in says "access blocked" / `access_denied` | Your address is not a test user | **Google Auth platform** > **Audience** > **Test users** > **Add users**. |
| Google `403 … insufficient authentication scopes` | A permission box was left unticked at sign-in | Delete `backend\token.json`, run the auth module again and tick every box. |
| Google `403 … API has not been used in project` | Gmail or Calendar API not enabled | Enable both APIs (step 5.2). |
| No ElevenLabs voice, browser voice instead | Key missing, no credits, or voice not available to your plan | Check the uvicorn log line starting "ElevenLabs returned"; set `ELEVENLABS_VOICE_ID` to a voice from your account. |
| `/api/status` shows `llm.mode: offline` | No `GEMINI_API_KEY` and no fallback | Step 1 or step 7. |
| Gemini errors with `429` | Free-tier rate limit | Wait, check <https://aistudio.google.com/rate-limit>, set `GRAPH_BACKEND=local` to cut background calls. |
| An approved action shows "failed" | The upstream service rejected it | The action's result holds the service's own error message; match it against this table. |


## Checking your connections

After any change to `backend\.env`, run this in the backend folder (venv active):

```powershell
python -m moss.doctor
```

It tests Gemini (both model names), the fallback LLM, Neo4j, Jira, Confluence (and lists the space keys it can see), Slack (token, scopes, channels), Gmail, Calendar and ElevenLabs. Every `FAIL` line is followed by the fix. Then restart uvicorn.

The **Sync** button understands 5 new items per click to stay inside free LLM quotas; click it again while it reports items still waiting.
