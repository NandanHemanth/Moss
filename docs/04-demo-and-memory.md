# Moss — demo runbook and the case for three memory layers

## Before the demo (5 minutes)

```powershell
cd backend
python -m pip install -r requirements.txt     # once per machine
python -m moss.doctor                         # every line should be OK or an expected SKIP
python -m moss.seed --reset                   # fresh demo company
uvicorn moss.api:app --port 8000
```

Second window: `cd frontend; npm install; npm run dev`, then open http://localhost:5173.

The sidebar's status strip should show the LLM as `gemini`, and "Watching gmail, slack, jira …".
If an agent shows `mock`, the doctor says which setting is missing.

## Demo 1 — a meeting ends

1. As Maya (manager), click **A meeting just ended**.
2. Owl reads the transcript; decisions, commitments and risks appear as chips.
3. Stag proposes a Jira ticket, a Slack post and a follow-up meeting. A whisper is read aloud if voice is on.
4. Approve (or Edit, or Skip) each action. The ticket and the Slack message are created for real; the result line links to them.
5. Switch user to Sam: the same proposal is visible read-only, there is no Stag and no approval.

## Demo 2 — an email triggers the pipeline (live test)

Needs Gmail connected on the machine running the backend (`credentials.json` and `token.json` in `backend/`,
created with `python -m moss.connectors.google_auth`).

1. Keep the Clearing open as Maya. The watcher checks Gmail, Slack, Jira and Confluence every 30 seconds
   (`MOSS_POLL_SECONDS`).
2. From any other account, send an email to the connected Gmail address. Ask for something concrete, for example:

   > Subject: Overtime column missing in payroll export
   >
   > Hi, we ran the payroll CSV export for the Gulf pilot and the overtime hours column is missing, so our
   > payroll team cannot reconcile. Can someone fix this before Friday and let your platform team know?

3. Within about a minute a whisper arrives and a proposal appears under **Needs your decision**:
   a Jira ticket, a Slack message, and a reply draft.
4. Approve. Check Jira (project `PLAT`) and the Slack channel: both are real.
5. Nothing is ever sent or created before the manager approves. Items Moss creates are filed as known events,
   so its own ticket does not come back as "news" on the next poll.

Only items that arrive after the backend started are processed automatically. Older mail waits for the **Sync**
button, which understands five items per click to stay inside the free LLM quota.

This path was run end to end on 4 October 2026 with Gemini, live Jira and live Slack, using an email event
injected the way the watcher stores it. The Gmail fetch itself was not run on this laptop (no Google token here).

## Demo 3 — draw a workflow on the Canvas

1. As Maya open **Canvas**. Type into the Stag bar: *"When a customer emails about a bug or an outage, summarise it,
   create a Jira ticket, tell the team in Slack and draft a reply"* and press **Build**. Stag draws the nodes.
2. Click a node: each one is defined in plain language (Trigger, Description, Input, Output). Drag more nodes from the palette.
3. **Test run** → **Dry run** shows what each step would produce. **Send to approvals** queues the actions.
4. **Save** and switch **Live** on. From now on a matching email runs this workflow instead of Stag's default plan,
   and its actions still wait for approval in the Clearing, tagged "via workflow".

## One email that exercises everything

Send this to the connected Gmail address from any other account, with the backend running and the Clearing open as Maya:

> **Subject:** Urgent: payroll export failing for the Gulf pilot
>
> Hi Maya,
>
> Since this morning the payroll CSV export for our Gulf pilot fails with a timeout, and the overtime hours column was
> missing in yesterday's file. Our payroll run is on Friday, so we need a fix by Thursday. Your staging server also seems
> to be down, so we cannot test anything.
>
> Can your team fix the export, let the platform team know, and set up a 30-minute call with me tomorrow?
>
> Thanks,
> Dana Okafor
> Operations Lead, Harborline Freight

What should happen within about a minute:

1. A whisper is read aloud; a card appears under **Needs your decision**, linked to the Harborline account the graph already knows.
2. Proposed actions: a Jira ticket, a Slack message, a calendar invite for the call, and a reply draft.
3. A quiet row offers **Draft email to DevOps**, because the email says staging is down. HR and Finance are not offered.
4. Approve: the ticket appears in Jira project `PLAT`, the message in Slack, the event in Calendar, the drafts in Gmail.
5. The tiles update (tokens used, team, stakeholder summary), and **Ask → Stag → "What is open for Harborline Freight?"** now includes this email.

This exact email was run through the pipeline on 4 October 2026 with Gemini: it produced those four actions and the DevOps
help request. That run used an injected event and mock tools; the Gmail fetch on a second laptop is still the untested step.

## Why three layers of memory

Open the **Memory** page. Every number on it is measured live.

| Layer | Its job | What breaks without it |
|---|---|---|
| **Cache** (in-process, TTL) | Speed and quota | Every repeated question pays the full model and lookup cost again. On a free tier that allows a handful of requests a minute, that is the difference between a demo that answers and one that stalls. |
| **Knowledge graph** (typed, dated facts; Graphiti on Neo4j when enabled) | Connection and meaning | A decision in a meeting, the ticket it led to and the customer email about it stay three unrelated documents. "What did we discuss with this client last month?" becomes keyword search over raw text. |
| **SQLite** (system of record) | Truth and accountability | No exact state: what is open, who owns it, who approved which action and when. Nothing survives a restart, and there is no audit trail. |

They are not three copies of the same data. Each holds a different shape of it:

- SQLite holds **records**: the raw event, the proposal, the approval, the audit entry. Exact, but unconnected.
- The graph holds **facts**: "Marcus committed to send the scope to Harborline, due 9 October, said in the quarterly review". Connected across tools and time, but not the system of record.
- The cache holds **answers**: the last result of an expensive lookup or model call. Fast, and safe to lose.

### The 60-second proof for judges

1. On the Memory page, run **"What did we discuss with Harborline last month?"**.
2. Left column, without memory: the model would have to read every raw document that mentions a keyword.
3. Right column, with the graph: a dozen dated facts drawn from several tools, about half the tokens on the seeded data,
   each with its source. The saving grows with the amount of history, because documents grow and facts stay short.
4. The timing bars: the same lookup cold, then warm from the cache. Tick "Also ask the model" to see the first model call
   take seconds and the repeat come back in under a millisecond.
5. Bottom: SQLite supplies what neither of the others has, the open commitments for those accounts and the approval trail.
6. Then open **Ask**, put the same question to Stag, and point at the line under the answer:
   how many graph facts, from how many tools, and how many cache hits it used.

### The learning loop

When the manager approves or skips an action, SQLite records the decision, the graph gains an edge
("Platform sync led to PLAT-1"), and the proposer is told what has been approved and skipped so far.
The three layers are what make "the knowledge graph makes the agents better" a concrete mechanism.
