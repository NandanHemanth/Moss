# Moss API contract

Base URL `http://localhost:8000`. Every request carries `X-Moss-User: <user id>` (`maya` = manager, `sam` = employee). The SSE stream takes `?user=<id>` because EventSource cannot set headers. Errors: 401 unknown user, 403 role not allowed, 404 not found.

## GET /api/users
```json
[
 {
  "id": "maya",
  "name": "Maya Chen",
  "role": "manager",
  "title": "Engineering Manager"
 },
 {
  "id": "elena",
  "name": "Elena Petrova",
  "role": "employee",
  "title": "Site Reliability Engineer"
 },
 {
  "id": "marcus",
  "name": "Marcus Lee",
  "role": "employee",
  "title": "Account Manager"
 }
]
```

## GET /api/me
```json
{
 "id": "maya",
 "name": "Maya Chen",
 "role": "manager",
 "title": "Engineering Manager",
 "email": "maya@tidewater.example"
}
```

## GET /api/agents
```json
[
 {
  "id": "stag",
  "name": "Stag",
  "epithet": "The White Stag",
  "tool": "Orchestrator",
  "manager_only": true,
  "description": "Guardian of the grove. Plans across every agent and proposes next steps.",
  "mode": "offline",
  "allowed": true
 },
 {
  "id": "raven",
  "name": "Raven",
  "epithet": "The Message Raven",
  "tool": "Gmail + Calendar",
  "manager_only": false,
  "description": "Carries email and keeps the calendar.",
  "mode": "mock/mock",
  "allowed": true
 },
 {
  "id": "firefly",
  "name": "Firefly",
  "epithet": "The Lantern Firefly",
  "tool": "Slack",
  "manager_only": false,
  "description": "Follows the flicker of channel chatter.",
  "mode": "mock",
  "allowed": true
 }
]
```

## GET /api/status
```json
{
 "llm": {
  "mode": "offline",
  "primary": null,
  "fast": null,
  "fallback": null,
  "last_route": null,
  "gemini_errors": 0,
  "fallback_errors": 0,
  "last_error": null
 },
 "graph": {
  "backend": "local",
  "facts": 77,
  "graphiti": {
   "enabled": false,
   "ok": 0,
   "failed": 0,
   "queued": 0,
   "last_error": null
  }
 },
 "cache": {
  "hits": 0,
  "misses": 0,
  "namespaces": {}
 },
 "connectors": {
  "jira": "mock",
  "confluence": "mock",
  "slack": "mock",
  "gmail": "mock",
  "calendar": "mock",
  "meeting": "seeded"
 },
 "voice": "browser",
 "counts": {
  "events": 15,
  "facts": 77,
  "commitments": 3,
  "proposals": 0,
  "notifications": 0
 }
}
```

## GET /api/accounts
```json
[
 {
  "id": "harborline",
  "name": "Harborline Freight",
  "kind": "customer",
  "summary": "Logistics customer since March. Main ask is payroll integration before the January cycle. Dana Okafor (Ops lead) decides.",
  "open_commitments": 2,
  "events": 3
 },
 {
  "id": "lumen",
  "name": "Lumen Retail",
  "kind": "customer",
  "summary": "Retail customer up for renewal in Q1. Aisha Karim is asking about SSO.",
  "open_commitments": 0,
  "events": 1
 },
 {
  "id": "pinecrest",
  "name": "Pinecrest Health",
  "kind": "customer",
  "summary": "Hospital group evaluating Tidewater. Luis Ferreira wants payroll integration for nursing staff.",
  "open_commitments": 1,
  "events": 3
 }
]
```

## POST /api/demo/meeting-ended  (manager) body `{}` or `{"id": "..."}` — simulates "a meeting just ended"
```json
{
 "event_id": "meeting:platform-sync",
 "insights": 7,
 "proposal_id": "prop_f37fc6fef2"
}
```

## GET /api/demo/queue  (manager) — seeded meetings not yet triggered
```json
[
 {
  "id": "meeting:harborline-discovery",
  "title": "Harborline payroll discovery call",
  "source": "meeting"
 }
]
```

## GET /api/proposals?status=pending|done|all
Employees get only proposals from events they took part in, or that they requested in chat; they cannot decide.
```json
[
 {
  "id": "prop_f37fc6fef2",
  "event_id": "meeting:platform-sync",
  "created_at": "2026-10-03T22:43:26+00:00",
  "status": "pending",
  "actions": [
   {
    "id": "act_6d42575d38",
    "proposal_id": "prop_f37fc6fef2",
    "agent_id": "fox",
    "kind": "jira.create_issue",
    "title": "Create Jira ticket",
    "detail": "Add OpenAI endpoint for summarisation \u00b7 assign Priya Raman",
    "params": {
     "summary": "Add OpenAI endpoint for summarisation",
     "description": "Decision from the Platform sync: serve summarisation from OpenAI behind the provider abstraction and keep Claude as fallback for two weeks. Owner: Priya Raman. Target: 2026-10-16.",
     "assignee": "Priya Raman"
    },
    "status": "pending",
    "result": null,
    "requested_by": null,
    "decided_by": null,
    "decided_at": null,
    "position": 0
   },
   {
    "id": "act_c7aab7968c",
    "proposal_id": "prop_f37fc6fef2",
    "agent_id": "firefly",
    "kind": "slack.post_message",
    "title": "Post in #platform",
    "detail": "Tell the team what was decided and who owns what",
    "params": {
     "channel": "platform",
     "text": "Decision from today's Platform sync: summarisation moves from Claude to OpenAI, with Claude kept as fallback for two weeks.\n\u2022 Priya ships the OpenAI endpoint (target 2026-10-16)\n\u2022 Elena writes the rollback plan (by 2026-10-10) and rotates staging keys before Friday\n\u2022 Sam extends the provider timeout tests"
    },
    "status": "pending",
    "result": null,
    "requested_by": null,
    "decided_by": null,
    "decided_at": null,
    "position": 1
   },
   {
    "id": "act_919a157d86",
    "proposal_id": "prop_f37fc6fef2",
    "agent_id": "raven",
    "kind": "calendar.create_event",
    "title": "Schedule follow-up",
    "detail": "Endpoint migration review \u00b7 2026-10-07 10:00 \u00b7 Priya, Elena, Sam, Maya",
    "params": {
     "description": "Review progress on the OpenAI summarisation endpoint and the rollback plan.",
     "title": "Endpoint migration review",
     "start": "2026-10-07T10:00",
     "duration_minutes": 30,
     "attendees": [
      "Priya Raman",
      "Elena Petrova",
      "Sam Ortiz",
      "Maya Chen"
     ]
    },
    "status": "pending",
    "result": null,
    "requested_by": null,
    "decided_by": null,
    "decided_at": null,
    "position": 2
   }
  ],
  "event": {
   "id": "meeting:platform-sync",
   "source": "meeting",
   "agent_id": "owl",
   "title": "Platform sync",
   "summary": "The team decided to move the summarisation endpoint from Claude to OpenAI, keeping Claude as a two-week fallback. A rollback plan does not exist yet.",
   "occurred_at": "2026-10-03T14:00",
   "account": "Provider migration",
   "participants": [
    "Maya Chen",
    "Priya Raman",
    "Sam Ortiz",
    "Elena Petrova",
    "Marcus Lee"
   ],
   "url": null,
   "meta": {
    "duration_minutes": 42,
    "_extraction": {
     "summary": "The team decided to move the summarisation endpoint from Claude to OpenAI, keeping Claude as a two-week fallback. A rollback plan does not exist yet.",
     "intent": "Fix summarisation latency by switching provider",
     "importance": 5,
     "account": "Provider migration",
     "insights": [
      {
       "kind": "decision",
       "text": "Set up a new summarisation API endpoint on OpenAI instead of the existing Claude one",
       "owner": null,
       "due": null
      },
      {
       "kind": "decision",
       "text": "Keep Claude as the fallback provider for two weeks",
       "owner": null,
       "due": null
      },
      {
       "kind": "commitment",
       "text": "Ship the OpenAI summarisation endpoint",
       "owner": "Priya Raman",
       "due": "2026-10-16"
      },
      {
       "kind": "commitment",
       "text": "Write the rollback plan for the endpoint switch",
       "owner": "Elena Petrova",
       "due": "2026-10-10"
      },
      {
       "kind": "commitment",
       "text": "Extend the provider timeout tests to cover OpenAI",
       "owner": "Sam Ortiz",
       "due": null
      },
      {
       "kind": "risk",
       "text": "There is no rollback plan for the provider switch yet",
       "owner": null,
       "due": null
      },
      {
       "kind": "risk",
       "text": "Staging provider keys expire Friday",
       "owner": null,
       "due": null
      }
     ],
     "entities": [
      {
       "name": "Priya Raman",
       "type": "person"
      },
      {
       "name": "Elena Petrova",
       "type": "person"
      },
      {
       "name": "Sam Ortiz",
       "type": "person"
      },
      {
       "name": "summarisation endpoint",
       "type": "topic"
      },
      {
       "name": "Provider migration",
       "type": "project"
      },
      {
       "name": "Harborline Freight",
       "type": "customer"
      }
     ]
    },
    "_proposal": {
     "notification": "Platform sync finished. The team decided to move summarisation from Claude to OpenAI; three actions are waiting for your approval.",
     "actions": [
      {
       "kind": "jira.create_issue",
       "title": "Create Jira ticket",
       "detail": "Add OpenAI endpoint for summarisation \u00b7 assi
```

## POST /api/actions/{id}/decide  (manager) body `{"decision":"approve"|"skip", "title"?, "detail"?, "params"?}`
Edits (title/detail/params) are merged before executing. Returns the action. Status becomes `executed`, `skipped` or `failed` (`result.error`).
```json
{
 "id": "act_6d42575d38",
 "proposal_id": "prop_f37fc6fef2",
 "agent_id": "fox",
 "kind": "jira.create_issue",
 "title": "Create Jira ticket",
 "detail": "Add OpenAI endpoint for summarisation \u00b7 assign Priya Raman",
 "params": {
  "summary": "Add OpenAI endpoint for summarisation",
  "description": "Decision from the Platform sync: serve summarisation from OpenAI behind the provider abstraction and keep Claude as fallback for two weeks. Owner: Priya Raman. Target: 2026-10-16.",
  "assignee": "Priya Raman"
 },
 "status": "executed",
 "result": {
  "key": "PLAT-139",
  "url": "mock://jira/PLAT-139",
  "text": "Created PLAT-139: Add OpenAI endpoint for summarisation (assigned to Priya Raman)"
 },
 "requested_by": null,
 "decided_by": "maya",
 "decided_at": "2026-10-03T22:43:26+00:00",
 "position": 0
}
```

## POST /api/proposals/{id}/approve-all  (manager) — returns the proposal

## GET /api/commitments?status=open|done|all&account=
Employees get only their own.
```json
[
 {
  "id": "com_665a6530d2",
  "event_id": "meeting:pinecrest-intro",
  "text": "Set up a payroll integration demo for Pinecrest",
  "owner": "Marcus Lee",
  "due": "2026-10-06",
  "status": "open",
  "agent_id": "owl",
  "account": "Pinecrest Health",
  "created_at": "2026-09-25T11:00",
  "event_title": "Pinecrest Health intro call"
 },
 {
  "id": "com_af458eeb81",
  "event_id": "meeting:harborline-qbr",
  "text": "Send the payroll integration scope to Harborline",
  "owner": "Marcus Lee",
  "due": "2026-10-08",
  "status": "open",
  "agent_id": "owl",
  "account": "Harborline Freight",
  "created_at": "2026-09-12T15:00",
  "event_title": "Harborline quarterly review"
 }
]
```

## PATCH /api/commitments/{id} body `{"status":"done"|"open"}`

## GET /api/notifications?limit=20  (manager)
```json
[
 {
  "id": "n_204e567e6f",
  "agent_id": "owl",
  "text": "Platform sync finished. The team decided to move summarisation from Claude to OpenAI; three actions are waiting for your approval.",
  "created_at": "2026-10-03T22:43:26+00:00",
  "event_id": "meeting:platform-sync",
  "agent_name": "Owl"
 },
 {
  "id": "n_99405cac0e",
  "agent_id": "fox",
  "text": "Fox finished: Created PLAT-139: Add OpenAI endpoint for summarisation (assigned to Priya Raman).",
  "created_at": "2026-10-03T22:43:26+00:00",
  "event_id": null,
  "agent_name": "Fox"
 }
]
```

## GET /api/notifications/{id}/audio  (manager)
Returns `audio/mpeg` when ElevenLabs is configured, otherwise **204** — then speak the text with the browser `speechSynthesis`.

## GET /api/stream?user=maya  (Server-Sent Events)
Events: `ready`, `notification` (managers only; data = notification row incl. `agent_name`), `proposal` ({id}), `action` ({id,status,proposal_id}), `timeline` ({id}). On `proposal`/`action`/`timeline` simply refetch the relevant list.

## POST /api/ask body `{"agent_id","message","session_id"}`
Employees get 403 for `stag`. `queued_actions` lists action ids the agent queued for manager approval.
```json
{
 "agent_id": "stag",
 "answer": "Here is what I know:\n\u2022 Risk raised in Payroll integration before the January cycle: Harborline has not received the payroll integration scope that was promised (2026-10-02)\n\u2022 Decision in Harborline quarterly review: Pilot payroll integration with Harborline's Gulf region first (2026-09-12)\n\u2022 Marcus Lee committed in Harborline quarterly review: Send the payroll integration scope to Harborline (due 2026-10-08) (2026-09-12)\n\u2022 Sam Ortiz committed in Harborline quarterly review: Confirm the payroll export format with Harborline's IT team (2026-09-12)\n\u2022 Risk raised in Harborline quarterly review: Harborline's January payroll cycle is a hard deadline (2026-09-12)\n\u2022 Payroll integration before the January cycle is about Harborline Freight: Dana at Harborline is still waiting for the payroll integration scope and asks for a call this week. (2026-10-02)\n\u2022 Dana Okafor took part in Payroll integration before the January cycle (2026-10-02)",
 "sources": [
  {
   "agent_id": "raven",
   "label": "Payroll integration before the January cycle \u00b7 2026-10-02",
   "url": null,
   "event_id": "gmail:dana-payroll"
  },
  {
   "agent_id": "owl",
   "label": "Harborline quarterly review \u00b7 2026-09-12",
   "url": null,
   "event_id": "meeting:harborline-qbr"
  },
  {
   "agent_id": "tortoise",
   "label": "Harborline Freight \u2014 account page \u00b7 2026-09-13",
   "url": null,
   "event_id": "confluence:harborline-account"
  }
 ],
 "trace": [
  "recall"
 ],
 "queued_actions": [],
 "route": "offline"
}
```

## GET /api/timeline?account=&source=&limit=60
Employees get only events they took part in.
```json
[
 {
  "id": "meeting:platform-sync",
  "source": "meeting",
  "agent_id": "owl",
  "title": "Platform sync",
  "summary": "The team decided to move the summarisation endpoint from Claude to OpenAI, keeping Claude as a two-week fallback. A rollback plan does not exist yet.",
  "occurred_at": "2026-10-03T14:00",
  "account": "Provider migration",
  "participants": [
   "Maya Chen",
   "Priya Raman",
   "Sam Ortiz",
   "Elena Petrova",
   "Marcus Lee"
  ],
  "url": null,
  "importance": 5
 },
 {
  "id": "calendar:platform-sync",
  "source": "calendar",
  "agent_id": "raven",
  "title": "Platform sync",
  "summary": "Weekly platform sync on summarisation latency and the provider migration.",
  "occurred_at": "2026-10-03T14:00",
  "account": "Provider migration",
  "participants": [
   "Maya Chen",
   "Priya Raman",
   "Sam Ortiz",
   "Elena Petrova",
   "Marcus Lee"
  ],
  "url": null,
  "i
```

## GET /api/graph
```json
{
 "nodes": [
  {
   "id": "Platform sync",
   "label": "Platform sync",
   "type": "event"
  },
  {
   "id": "Created PLAT-139: Add OpenAI endpoint for summarisation (assigned to Priya Raman)",
   "label": "Created PLAT-139: Add OpenAI endpoint for summarisation (\u2026",
   "type": "action"
  },
  {
   "id": "Provider migration",
   "label": "Provider migration",
   "type": "account"
  }
 ],
 "edges": [
  {
   "source": "Platform sync",
   "target": "Created PLAT-139: Add OpenAI endpoint for summarisation (assigned to Priya Raman)",
   "label": "led to",
   "event_id": "meeting:platform-sync",
   "valid_at": "2026-10-03T22:43:26+00:00"
  },
  {
   "source": "Platform sync",
   "target": "Provider migration",
   "label": "about",
   "event_id": "calendar:platform-sync",
   "valid_at": "2026-10-03T14:00"
  }
 ],
 "_note": "53 nodes, 94 edges; node types: ['account', 'action', 'calendar', 'commitment', 'confluence', 'customer', 'decision', 'event', 'gmail', 'jira', 'meeting', 'person', 'project', 'risk', 'slack', 'ticket', 'topic']"
}
```

## POST /api/sync  (manager) — pull from live connectors
```json
{
 "new": 0,
 "processed": [],
 "deferred": 0,
 "errors": {}
}
```

## GET /api/memory — live numbers for the three memory layers (employees: recent_audit is empty, counts are scoped)
```json
{
    "cache": {
        "hits": 0,
        "misses": 0,
        "saved_ms": 0,
        "namespaces": {}
    },
    "graph": {
        "backend": "local",
        "facts": 93,
        "graphiti": {
            "enabled": false,
            "ok": 0,
            "failed": 0,
            "queued": 0,
            "last_error": null
        },
        "by_type": {
            "account": 15,
            "meeting": 12,
            "customer": 9,
            "project": 8,
            "topic": 4,
            "decision": 3,
            "commitment": 6,
            "risk": 9,
            "gmail": 6,
            "slack": 3,
            "jira": 3,
            "ticket": 3,
            "confluence": 2,
            "document": 1,
            "calendar": 9
        },
        "by_tool": {
            "meeting": 36,
            "gmail": 17,
            "slack": 11,
            "jira": 11,
            "confluence": 8,
            "calendar": 10
        },
        "cross_tool": [
            {
                "account": "Provider migration",
                "tools": [
                    "calendar",
                    "confluence",
                    "jira",
                    "meeting",
                    "slack"
                ],
                "facts": 40
            },
            {
                "account": "Harborline Freight",
                "tools": [
                    "confluence",
                    "gmail",
                    "meeting"
                ],
                "facts": 22
            },
            {
                "account": "Pinecrest Health",
                "tools": [
                    "gmail",
                    "meeting",
                    "slack"
                ],
                "facts": 16
            },
            {
                "account": "Lumen Retail",
                "tools": [
                    "gmail"
                ],
                "facts": 6
            },
            {
                "account": "Payroll integration",
                "tools": [
                    "jira"
                ],
                "facts": 5
            }
        ]
    },
    "store": {
        "tables": {
            "events": 16,
            "insights": 18,
            "commitments": 6,
            "proposals": 1,
            "actions": 3,
            "notifications": 1,
            "audit": 1
        },
        "decisions": {
            "pending": 3
        },
        "recent_audit": [
            {
                "ts": "2026-10-04T05:14:49+00:00",
                "user_id": "maya",
                "action": "demo.meeting",
                "detail": "meeting:platform-sync"
            }
        ]
    },
    "llm": {
        "mode": "offline",
        "primary": null,
        "fast": null,
        "fallback": null,
        "gemini_chain": [],
        "last_route": null,
        "gemini_errors": 0,
        "fallback_errors": 0,
        "last_error": null
    }
}
```

## POST /api/memory/compare body `{"question": str, "with_llm": bool}` — one question answered three ways
`llm_answer` is null when offline or with_llm=false; otherwise `{text, first_ms, repeat_ms, route}` or `{error}`.
```json
{
    "question": "What did we discuss with Harborline last month?",
    "raw": {
        "documents": 6,
        "chars": 2641,
        "ms": 0.18,
        "sample": [
            "Harborline quarterly review",
            "Payroll integration before the January cycle",
            "#platform \u00b7 summarisation latency",
            "PLAT-131 Payroll export: CSV and API formats",
            "Harborline Freight \u2014 account page"
        ],
        "tools": [
            "confluence",
            "gmail",
            "jira",
            "meeting",
            "slack"
        ],
        "tokens": 660
    },
    "graph": {
        "facts": 12,
        "chars": 1290,
        "ms": 0.87,
        "tools": [
            "confluence",
            "gmail",
            "meeting"
        ],
        "sample": [
            {
                "fact": "Risk raised in Payroll integration before the January cycle: Harborline has not received the payroll integration scope that was promised",
                "date": "2026-10-03",
                "source": "Payroll integration before the January cycle"
            },
            {
                "fact": "Decision in Harborline quarterly review: Pilot payroll integration with Harborline's Gulf region first",
                "date": "2026-09-13",
                "source": "Harborline quarterly review"
            },
            {
                "fact": "Marcus Lee committed in Harborline quarterly review: Send the payroll integration scope to Harborline (due 2026-10-09)",
                "date": "2026-09-13",
                "source": "Harborline quarterly review"
            },
            {
                "fact": "Sam Ortiz committed in Harborline quarterly review: Confirm the payroll export format with Harborline's IT team",
                "date": "2026-09-13",
                "source": "Harborline quarterly review"
            },
            {
                "fact": "Risk raised in Harborline quarterly review: Harborline's January payroll cycle is a hard deadline",
                "date": "2026-09-13",
                "source": "Harborline quarterly review"
            },
            {
                "fact": "Payroll integration before the January cycle is about Harborline Freight: Dana at Harborline is still waiting for the payroll integration scope and asks for a call this week.",
                "date": "2026-10-03",
                "source": "Payroll integration before the January cycle"
            }
        ],
        "tokens": 322
    },
    "cache": {
        "cold_ms": 0.87,
        "warm_ms": 0.029,
        "speedup": 30.1
    },
    "store": {
        "open_commitments": [
            {
                "text": "Send the payroll integration scope to Harborline",
                "owner": "Marcus Lee",
                "due": "2026-10-09",
                "account": "Harborline Freight",
                "status": "open"
            },
            {
                "text": "Confirm the payroll export format with Harborline's IT team",
                "owner": "Sam Ortiz",
                "due": null,
                "account": "Harborline Freight",
                "status": "open"
            }
        ],
        "approved_actions": 0,
        "audit_entries": 1
    },
    "llm_answer": null,
    "context_saving_percent": 51
}
```

## POST /api/ask now also returns `memory`
```json
{
 "ms": 1,
 "cache_hits": 0,
 "cache_misses": 1,
 "graph_facts": 12,
 "tools": [
  "firefly",
  "owl",
  "raven"
 ],
 "store_reads": 0
}
```

## GET /api/status now also returns `backlog` (number) and `watch`
```json
{
 "backlog": 0,
 "watch": {
  "enabled": false,
  "every_seconds": 30,
  "runs": 0,
  "last_run": null,
  "last_new": 0,
  "triggered": 0,
  "errors": {},
  "watching": []
 },
 "llm": {
  "mode": "offline",
  "primary": null,
  "fast": null,
  "fallback": null,
  "gemini_chain": [],
  "last_route": null,
  "gemini_errors": 0,
  "fallback_errors": 0,
  "last_error": null
 }
}
```

Insights may now have kind `request` in addition to decision / commitment / risk.

---
# Additions (v0.2): dashboard tiles, help requests, canvas workflows, access code

## GET /api/dashboard — instant tiles, role-specific. `source` is `live` or `sample` (sample = seeded figures, show a small "sample" tag).
Manager:
```json
{
    "role": "manager",
    "sample_note": "Sample figures for the fictional Tidewater Labs. Sprint points and cloud spend have no live source connected yet.",
    "tokens": {
        "total": 0,
        "today": 0,
        "series": [
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ],
        "calls": 0,
        "source": "live",
        "by_person": []
    },
    "burndown": {
        "sprint": "Sprint 14",
        "committed": 34,
        "length_days": 10,
        "remaining": [
            34,
            34,
            31,
            29,
            26,
            22,
            19
        ],
        "ideal": [
            34.0,
            30.6,
            27.2,
            23.8,
            20.4,
            17.0,
            13.6,
            10.2,
            6.8,
            3.4,
            0.0
        ],
        "velocity": 28.7,
        "history": [
            26,
            29,
            31
        ],
        "unit": "points",
        "source": "sample"
    },
    "cloud": {
        "currency": "USD",
        "budget": 6000,
        "last_month": 5630,
        "month_to_date": 1240,
        "forecast": 6240,
        "by_service": [
            {
                "name": "LLM inference",
                "amount": 520
            },
            {
                "name": "Compute",
                "amount": 390
            },
            {
                "name": "Database",
                "amount": 210
            },
            {
                "name": "Storage and network",
                "amount": 120
            }
        ],
        "source": "sample"
    },
    "team": {
        "people": [
            {
                "name": "Marcus Lee",
                "open": 2,
                "overdue": 0,
                "done": 0
            },
            {
                "name": "Sam Ortiz",
                "open": 2,
                "overdue": 0,
                "done": 0
            },
            {
                "name": "Priya Raman",
                "open": 1,
                "overdue": 0,
                "done": 0
            },
            {
                "name": "Elena Petrova",
                "open": 1,
                "overdue": 0,
                "done": 0
            }
        ],
        "open": 6,
        "overdue": 0,
        "approved": 0,
        "skipped": 0,
        "pending": 3,
        "source": "live"
    },
    "risks": {
        "count": 5,
        "items": [
            {
                "text": "There is no rollback plan for the provider switch yet",
                "event_id": "meeting:platform-sync",
                "event_title": "Platform sync",
                "account": "Provider migration",
                "occurred_at": "2026-10-04T14:00"
            },
            {
                "text": "Staging provider keys expire Friday",
                "event_id": "meeting:platform-sync",
                "event_title": "Platform sync",
                "account": "Provider migration",
                "occurred_at": "2026-10-04T14:00"
            },
            {
                "text": "Staging provider keys expire Friday with no owner for rotation",
                "event_id": "slack:elena-keys",
                "event_title": "#platform \u00b7 staging keys",
                "account": "Provider migration",
                "occurred_at": "2026-10-03T16:20"
            },
            {
                "text": "Harborline has not received the payroll integration scope that was promised",
                "event_id": "gmail:dana-payroll",
                "event_title": "Payroll integration before the January cycle",
                "account": "Harborline Freight",
                "occurred_at": "2026-10-03T09:12"
            },
            {
                "text": "Only CSV export is ready; the API format is not built",
                "event_id": "meeting:pinecrest-intro",
                "event_title": "Pinecrest Health intro call",
                "account": "Pinecrest Health",
                "occurred_at": "2026-09-26T11:00"
            }
        ],
        "source": "live"
    }
}
```
Employee (`velocity` can be null when the person has no sprint data):
```json
{
    "role": "employee",
    "sample_note": "Sample figures for the fictional Tidewater Labs. Sprint points and cloud spend have no live source connected yet.",
    "tokens": {
        "total": 0,
        "today": 0,
        "series": [
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ],
        "calls": 0,
        "source": "live"
    },
    "velocity": {
        "average": 8.3,
        "history": [
            8,
            9,
            8
        ],
        "sprint": "Sprint 14",
        "done": 5,
        "committed": 10,
        "unit": "points",
        "source": "sample"
    },
    "risks": {
        "count": 3,
        "items": [
            {
                "text": "There is no rollback plan for the provider switch yet",
                "event_id": "meeting:platform-sync",
                "event_title": "Platform sync",
                "account": "Provider migration",
                "occurred_at": "2026-10-04T14:00"
            },
            {
                "text": "Staging provider keys expire Friday",
                "event_id": "meeting:platform-sync",
                "event_title": "Platform sync",
                "account": "Provider migration",
                "occurred_at": "2026-10-04T14:00"
            },
            {
                "text": "Harborline's January payroll cycle is a hard deadline",
                "event_id": "meeting:harborline-qbr",
                "event_title": "Harborline quarterly review",
                "account": "Harborline Freight",
                "occurred_at": "2026-09-13T15:00"
            }
        ],
        "source": "live"
    },
    "deadlines": {
        "count": 2,
        "overdue": 0,
        "items": [
            {
                "id": "com_15ed7ec955",
                "text": "Confirm the payroll export format with Harborline's IT team",
                "owner": "Sam Ortiz",
                "due": null,
                "status": "open",
                "account": "Harborline Freight",
                "event_title": "Harborline quarterly review",
                "overdue": false
            },
            {
                "id": "com_4988682463",
                "text": "Extend the provider timeout tests to cover OpenAI",
                "owner": "Sam Ortiz",
                "due": null,
                "status": "open",
                "account": "Provider migration",
                "event_title": "Platform sync",
                "overdue": false
            }
        ],
        "source": "live"
    }
}
```

## GET /api/dashboard/brief — suggested next tasks (+ stakeholder `summary` for managers). May take a few seconds when the LLM is used; cached. `source` is `llm` or `rules`.
```json
{
    "next_tasks": [
        {
            "task": "Marcus: Set up a payroll integration demo for Pinecrest",
            "why": "Due 2026-10-07"
        },
        {
            "task": "Marcus: Send the payroll integration scope to Harborline",
            "why": "Due 2026-10-09"
        },
        {
            "task": "Elena: Write the rollback plan for the endpoint switch",
            "why": "Due 2026-10-11"
        }
    ],
    "summary": [
        "Decided: Set up a new summarisation API endpoint on OpenAI instead of the existing Claude one",
        "Decided: Keep Claude as the fallback provider for two weeks",
        "Main risk: There is no rollback plan for the provider switch yet"
    ],
    "source": "rules",
    "route": "offline"
}
```

## Proposals now also carry `escalations` (help requests; usually empty) and `workflow` (name of the canvas workflow that produced it, or null)
```json
{
 "id": "prop_8ca3aa80bb",
 "workflow": null,
 "escalations": [
  {
   "id": "esc_4870ebf030",
   "team": "DevOps",
   "reason": "Staging provider keys expire Friday and nobody owns the rotation; there is no rollback plan yet.",
   "subject": "Help needed: staging key rotation and rollback for the provider switch",
   "body": "Hi DevOps team,\n\nIn today's Platform sync we decided to move summarisation from Claude to OpenAI. Two things need your help:\n\n1. The staging provider keys expire on Friday and nobody owns the rotation.\n2. We have no rollback plan if the new provider degrades.\n\nCould someone from DevOps pair with Elena Petrova this week on both? Happy to share details.\n\nThanks,\nMaya",
   "status": "suggested",
   "result": null
  }
 ]
}
```
## POST /api/escalations/{id}/draft (manager) — creates an email DRAFT to that team; returns the escalation with `status` `drafted` (or `failed` with `result.error`) and `result` `{id,url,text}`. Idempotent.

## Canvas workflows (manager only; 403 for employees)
### GET /api/workflows/node-types
```json
[
 {
  "type": "input",
  "label": "Input",
  "agent_id": null,
  "can_trigger": true,
  "can_act": false,
  "hint": "Start by hand with any text.",
  "agent_name": null
 },
 {
  "type": "meeting",
  "label": "Meeting",
  "agent_id": "owl",
  "can_trigger": true,
  "can_act": false,
  "hint": "Starts when a meeting transcript arrives.",
  "agent_name": "Owl"
 },
 {
  "type": "gmail",
  "label": "Gmail",
  "agent_id": "raven",
  "can_trigger": true,
  "can_act": true,
  "hint": "Start on an email, or draft one.",
  "agent_name": "Raven"
 },
 {
  "type": "calendar",
  "label": "Calendar",
  "agent_id": "raven",
  "can_trigger": true,
  "can_act": true,
  "hint": "Start on an event, or schedule one.",
  "agent_name": "Raven"
 }
]
... 9 types: input, meeting, gmail, calendar, slack, jira, confluence, llm, output
```
### POST /api/workflows/generate body `{"prompt": str}` — Stag designs a flow from a sentence. Not saved. `source` = model route or `rules`.
```json
{
    "name": "When an email reports a bug",
    "description": "When an email reports a bug, create a Jira ticket and post it in Slack",
    "graph": {
        "nodes": [
            {
                "id": "n1",
                "type": "gmail",
                "label": "New email",
                "x": 60.0,
                "y": 140.0,
                "trigger": "When an email reports a bug, create a Jira ticket and post it in Slack",
                "description": "Starts the workflow.",
                "input": "",
                "output": "The item's text."
            },
            {
                "id": "n2",
                "type": "llm",
                "label": "Understand it",
                "x": 330.0,
                "y": 180.0,
                "trigger": "",
                "description": "Read the input and work out what is being asked.",
                "input": "The item's text.",
                "output": "A short summary and what to do."
            },
            {
                "id": "n3",
                "type": "jira",
                "label": "Create ticket",
                "x": 600.0,
                "y": 140.0,
                "trigger": "",
                "description": "Create ticket based on the summary.",
                "input": "The summary.",
                "output": "Queued for manager approval."
            },
            {
                "id": "n4",
                "type": "slack",
                "label": "Post to Slack",
                "x": 870.0,
                "y": 180.0,
                "trigger": "",
                "description": "Post to Slack based on the summary.",
                "input": "The summary.",
                "output": "Queued for manager approval."
            },
            {
                "id": "n5",
                "type": "output",
                "label": "Tell the manager",
                "x": 1140.0,
                "y": 140.0,
                "trigger": "",
                "description": "Report what was prepared.",
                "input": "Everything above.",
                "output": "One sentence."
            }
        ],
        "edges": [
            {
                "id": "n1-n2",
                "source": "n1",
                "target": "n2"
            },
            {
                "id": "n2-n3",
                "source": "n2",
                "target": "n3"
            },
            {
                "id": "n3-n4",
                "source": "n3",
                "target": "n4"
            },
            {
                "id": "n4-n5",
                "source": "n4",
                "target": "n5"
            }
        ]
    },
    "source": "rules"
}
```
### POST /api/workflows body `{name, description?, enabled?, graph}` → saved workflow · PUT /api/workflows/{id} (any subset) · DELETE /api/workflows/{id} · GET /api/workflows
Graph: `nodes[{id,type,label,x,y,trigger,description,input,output}]`, `edges[{id,source,target}]`. A tool node with no incoming edge is the trigger; later tool nodes are actions.
```json
{
 "id": "wf_a6ed4dffec",
 "name": "Bug mail to ticket",
 "description": "",
 "enabled": true,
 "graph": "(same shape as above)",
 "created_by": "maya",
 "updated_at": "2026-10-04T06:44:10+00:00",
 "last_run": null
}
```
### POST /api/workflows/{id}/run body `{"input": str, "queue": bool, "graph"?: {...}, "name"?: str}` — use id `draft` with `graph` to run an unsaved canvas. `queue:false` = dry run; `queue:true` sends the actions to the approval queue and returns `proposal_id`.
```json
{
    "workflow_id": null,
    "status": "ok",
    "steps": [
        {
            "node_id": "n1",
            "type": "gmail",
            "label": "New email",
            "role": "trigger",
            "output": "Subject: Export button broken\nThe export button crashes since this morning. Please fix before Friday."
        },
        {
            "node_id": "n2",
            "type": "llm",
            "label": "Understand it",
            "role": "llm",
            "output": "Read the input and work out what is being asked.: Subject: Export button broken"
        },
        {
            "node_id": "n3",
            "type": "jira",
            "label": "Create ticket",
            "role": "action",
            "output": "Create ticket: Read the input and work out what is being asked.: Subject: Export button broken",
            "action": {
                "kind": "jira.create_issue",
                "title": "Create ticket",
                "detail": "Create ticket: Read the input and work out what is being asked.: Subject: Export button broken",
                "params": {
                    "summary": "Read the input and work out what is being asked.: Subject: Export button broken",
                    "description": "Read the input and work out what is being asked.: Subject: Export button broken"
                }
            }
        },
        {
            "node_id": "n4",
            "type": "slack",
            "label": "Post to Slack",
            "role": "action",
            "output": "Post to Slack: Read the input and work out what is being asked.: Subject: Export button broken",
            "action": {
                "kind": "slack.post_message",
                "title": "Post to Slack",
                "detail": "Post to Slack: Read the input and work out what is being asked.: Subject: Export button broken",
                "params": {
                    "channel": "platform",
                    "text": "Read the input and work out what is being asked.: Subject: Export button broken\nRead the input and work out what is being asked.: Subject: Export button broken"
                }
            }
        },
        {
            "node_id": "n5",
            "type": "output",
            "label": "Tell the manager",
            "role": "output",
            "output": "Workflow finished for \u201cRead the input and work out what is being asked.: Subject: Export button broken\u201d."
        }
    ],
    "summary": "2 actions prepared by \u201cBug mail to ticket\u201d.",
    "proposal_id": null,
    "route": "offline"
}
```
## Access code (hosted demo)
`GET /api/health` → `{"ok":true,"locked":bool}` (never gated). When `locked`, every other `/api/*` call needs header `X-Moss-Code: <code>` (the SSE stream takes `&code=`); without it the API answers 401 `{"detail":"access code required"}`.

---
# Additions (v0.3): why a tool is on mock, speak on request, grove sound effects

- `GET /api/agents` items now carry `reason`: a plain sentence saying why the agent's tool is on mock (and the fix), or `null` when live.
- `GET /api/status` now carries `voice_detail`: `{"voice": "default" | "<voice id>" | null, "note": string | null}`; show `note` when present.
- `POST /api/speak` body `{"text": str}` → `audio/mpeg` (ElevenLabs), or **204** when no ElevenLabs audio is available (then use the browser's speech synthesis). Text is capped at 900 characters. Any role.
- `GET /api/sfx/{name}` with name in `stag | fox | owl | raven | tortoise | firefly` → `audio/mpeg` (about 2.5 s, generated once with ElevenLabs and cached on disk), **204** when no sound is available (synthesise a soft tone instead), 404 for unknown names. Any role. Sends `Cache-Control: private, max-age=86400`.
