# Deploying Moss

Moss runs as **one process on one port**: FastAPI serves the API and the built frontend together.

## 1. Production run on any machine (tested)

```powershell
cd frontend
npm install
npm run build                      # writes frontend\dist

cd ..\backend
python -m pip install -r requirements.txt
python -m moss.doctor              # every line OK or an expected SKIP
python -m moss.seed --reset        # only for a fresh demo
uvicorn moss.api:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. No second server and no CORS setup: the frontend calls the API on the same origin.
For development keep using `npm run dev` on port 5173.

## 2. Before you put it on the internet

| Setting | Why |
|---|---|
| `MOSS_ACCESS_CODE=<something long>` | **Required.** The Maya/Sam switch is a demo role switcher, not a login. With a code set, every API call needs it and the app asks for it once. Without it, anyone with the URL can approve actions in your Jira, Slack and Gmail. |
| `GRAPH_BACKEND=local` | Unless the host can reach a Neo4j database. The SQLite fact graph is always on. |
| `MOSS_DB=/data/moss.db` | Point SQLite at a persistent disk, otherwise approvals and history vanish on every restart. |
| `GOOGLE_TOKEN_JSON=<contents of token.json>` | Gmail and Calendar on a host where the browser sign-in cannot run. Create `token.json` locally first with `python -m moss.connectors.google_auth`. In Google's "Testing" mode this token expires after 7 days. |
| `MOSS_POLL_SECONDS=60` | The watcher's interval. Free model quotas are small; do not go lower than 30. |
| `HR_EMAIL`, `FINANCE_EMAIL`, `DEVOPS_EMAIL` | Real addresses for "Draft email to …". Drafts only; Moss never sends mail by itself. |

Other limits to know:

- **One instance only.** The cache, the event stream and the watcher live in the process. Do not scale out.
- **Gemini free tier:** prompts may be used to improve Google's products and read by reviewers. Use the demo company or a paid key for real data.
- **ElevenLabs free plan** has no commercial licence.

## 3. Container hosts (Render, Fly.io, Railway, Cloud Run)

A `Dockerfile` at the repository root builds the frontend and runs the backend on `$PORT`.
It follows the tested steps above but **has not been built yet** (no Docker daemon was available where Moss was developed),
so expect to fix small things on the first build.

```bash
docker build -t moss .
docker run -p 8000:8000 --env-file backend/.env -e MOSS_ACCESS_CODE=change-me -e GRAPH_BACKEND=local moss
```

On a host: create a web service from the repository, choose Docker, add the variables from `backend/.env` plus the table
above as environment variables, and attach a small persistent disk mounted at `/data`.

## 4. Health check

`GET /api/health` returns `{"ok": true, "locked": true|false}` and never needs the access code.
