"""Demo data. Dates are relative to today so the demo always looks current."""

from datetime import datetime, timedelta

from . import db


def at(days: int, hour: int = 9, minute: int = 0) -> str:
    d = datetime.now().astimezone().replace(hour=hour, minute=minute, second=0, microsecond=0)
    return (d + timedelta(days=days)).isoformat()


def accounts() -> list[dict]:
    return [
        {"id": 1, "name": "Acme Payroll", "segment": "Mid-market", "stage": "Pilot", "owner": "Dana Kim", "health": "at_risk", "arr": 84000, "touchpoints30d": 37, "lastContact": at(-1, 15, 20), "topics": ["payroll integration", "SSO / Okta", "EU data residency"], "summary": "Evaluating the payroll integration for 1,200 employees. On the discovery call they asked about SSO via Okta and EU data residency. Pricing was sent; the SSO question has gone unanswered for 6 days."},
        {"id": 2, "name": "Globex", "segment": "Enterprise", "stage": "Discovery", "owner": "Sam Ortiz", "health": "watch", "arr": 210000, "touchpoints30d": 18, "lastContact": at(-3, 11), "topics": ["payroll integration", "ADP sync", "API access"], "summary": "Asked about ADP sync on the last call and requested API documentation. Sam owns sending the docs; no follow-up meeting booked yet."},
        {"id": 3, "name": "Initech", "segment": "SMB", "stage": "Customer", "owner": "Priya Shah", "health": "healthy", "arr": 36000, "touchpoints30d": 9, "lastContact": at(-5, 10), "topics": ["renewal", "time-off module"], "summary": "Renewal on track. Raised payroll integration once in June; no open commitments."},
        {"id": 4, "name": "Umbrella HR", "segment": "Mid-market", "stage": "Discovery", "owner": "Dana Kim", "health": "watch", "arr": 0, "touchpoints30d": 4, "lastContact": at(-2, 14), "topics": ["payroll integration", "pricing"], "summary": "Mentioned payroll integration in #sales-leads. No discovery call booked yet."},
        {"id": 5, "name": "Stark Logistics", "segment": "Enterprise", "stage": "Negotiation", "owner": "Marcus Lee", "health": "healthy", "arr": 320000, "touchpoints30d": 26, "lastContact": at(0, 10, 30), "topics": ["security review", "multi-region"], "summary": "Security review passed. Legal redlines expected this week; procurement call scheduled."},
    ]


def interactions() -> list[dict]:
    return [
        {"id": 1, "accountId": 1, "source": "gmail", "title": "SSO follow-up still unanswered", "detail": "Jordan (Acme IT) asked whether Okta SCIM is supported.", "occurredAt": at(-6, 9, 40), "flag": "needs reply"},
        {"id": 2, "accountId": 1, "source": "slack", "title": "Pilot scope agreed in #acme-shared", "detail": "Two departments, 6-week pilot, kickoff on the 14th.", "occurredAt": at(-11, 16, 5)},
        {"id": 3, "accountId": 1, "source": "gmail", "title": "Pricing proposal sent", "detail": "Tiered plan with a 15% pilot discount.", "occurredAt": at(-15, 13)},
        {"id": 4, "accountId": 1, "source": "zoom", "title": "Discovery call", "detail": "Decision: pilot with payroll + time-off modules. Risk: EU residency.", "occurredAt": at(-21, 11), "flag": "transcript"},
        {"id": 5, "accountId": 1, "source": "jira", "title": "PLAT-204 · Okta SCIM connector", "detail": "In progress, linked to this account.", "occurredAt": at(-20, 10)},
        {"id": 6, "accountId": 1, "source": "confluence", "title": "EU data residency FAQ", "detail": "Cited by the orchestrator in two answers about Acme.", "occurredAt": at(-30, 9)},
        {"id": 7, "accountId": 2, "source": "zoom", "title": "Intro call with Globex finance", "detail": "Asked about ADP sync and API rate limits.", "occurredAt": at(-3, 11), "flag": "transcript"},
        {"id": 8, "accountId": 2, "source": "gmail", "title": "Request for API documentation", "detail": "Sam to send the integration guide.", "occurredAt": at(-3, 15)},
        {"id": 9, "accountId": 3, "source": "gmail", "title": "Renewal confirmation", "detail": "Signed for another 12 months.", "occurredAt": at(-5, 10)},
        {"id": 10, "accountId": 4, "source": "slack", "title": "Lead mentioned in #sales-leads", "detail": "Interested in payroll integration for 400 staff.", "occurredAt": at(-2, 14)},
        {"id": 11, "accountId": 5, "source": "zoom", "title": "Procurement sync", "detail": "Security review passed; legal redlines due Friday.", "occurredAt": at(0, 10, 30), "flag": "transcript"},
    ]


def commitments() -> list[dict]:
    return [
        {"id": 1, "title": "Answer Acme's Okta SCIM question", "owner": "Priya Shah", "accountId": 1, "source": "gmail", "sourceLabel": "Gmail thread", "due": at(-1, 17), "status": "open"},
        {"id": 2, "title": "Send Globex the API integration guide", "owner": "Sam Ortiz", "accountId": 2, "source": "zoom", "sourceLabel": "Intro call", "due": at(1, 17), "status": "open"},
        {"id": 3, "title": "Add OpenAI provider behind LLM_PROVIDER flag", "owner": "Priya Shah", "source": "zoom", "sourceLabel": "Platform Sync", "due": at(10, 17), "status": "open"},
        {"id": 4, "title": "Share load-test baseline with Marcus", "owner": "Priya Shah", "source": "zoom", "sourceLabel": "Platform Sync", "due": at(2, 17), "status": "open"},
        {"id": 5, "title": "Book discovery call with Umbrella HR", "owner": "Dana Kim", "accountId": 4, "source": "slack", "sourceLabel": "#sales-leads", "due": at(3, 17), "status": "open"},
        {"id": 6, "title": "Return legal redlines to Stark", "owner": "Marcus Lee", "accountId": 5, "source": "zoom", "sourceLabel": "Procurement sync", "due": at(4, 17), "status": "open"},
        {"id": 7, "title": "Review PLAT-198 PR", "owner": "Priya Shah", "source": "jira", "sourceLabel": "Jira", "due": at(-1, 17), "status": "done"},
    ]


def meetings() -> list[dict]:
    return [
        {"id": 1, "title": "Platform Sync", "startsAt": at(0, 14), "durationMin": 42, "attendees": ["Dana Kim", "Priya Shah", "Marcus Lee"], "status": "captured", "decision": "Move the summarisation endpoint from Claude to OpenAI behind a provider flag. Priya owns the backend change; Marcus updates the load tests. Target: end of next sprint."},
        {"id": 2, "title": "Stark procurement sync", "startsAt": at(0, 10, 30), "durationMin": 30, "attendees": ["Marcus Lee", "Stark procurement"], "status": "captured", "decision": "Security review passed. Legal redlines due Friday.", "accountId": 5},
        {"id": 3, "title": "1:1 with Priya", "startsAt": at(0, 16, 30), "durationMin": 30, "attendees": ["Dana Kim", "Priya Shah"], "status": "upcoming"},
        {"id": 4, "title": "Acme pilot readiness", "startsAt": at(1, 11), "durationMin": 45, "attendees": ["Dana Kim", "Jordan (Acme IT)"], "status": "upcoming", "accountId": 1},
    ]


def proposals() -> list[dict]:
    return [
        {"id": 1, "meetingId": 1, "agent": "jira", "kind": "jira_issue", "target": "PLAT board", "summary": "Add OpenAI provider to /v1/summarise behind LLM_PROVIDER flag · assignee Priya · 5 points", "status": "pending"},
        {"id": 2, "meetingId": 1, "agent": "slack", "kind": "slack_message", "target": "#platform-eng", "summary": "@Priya @Marcus: summary and ticket from today's sync are linked here. Kickoff Tuesday 10am.", "status": "pending"},
        {"id": 3, "meetingId": 1, "agent": "mail", "kind": "calendar_event", "target": "Tue 10:00–10:30", "summary": "OpenAI migration kickoff · Priya, Marcus, Dana · no conflicts found", "status": "pending"},
        {"id": 4, "meetingId": 2, "agent": "mail", "kind": "email", "target": "procurement@stark.example", "summary": "Confirm receipt of the security review and propose Friday for redlines.", "status": "pending"},
        {"id": 5, "meetingId": 2, "agent": "jira", "kind": "jira_issue", "target": "LEGAL board", "summary": "Track Stark redlines · assignee Marcus · due Friday", "status": "pending"},
    ]


def updates() -> list[dict]:
    return [
        {"id": 1, "agent": "meetings", "text": "Platform Sync is summarised. One decision and three follow-ups were found.", "createdAt": at(0, 14, 44)},
        {"id": 2, "agent": "mail", "text": "Acme Payroll replied about the pilot and asked for pricing.", "createdAt": at(0, 14, 10)},
        {"id": 3, "agent": "jira", "text": "PLAT-198 moved to Done. The release checklist is 80% complete.", "createdAt": at(0, 13, 32)},
        {"id": 4, "agent": "slack", "text": "Three people asked about the Q4 roadmap in #general. The Confluence agent found the doc.", "createdAt": at(0, 12, 5)},
        {"id": 5, "agent": "orchestrator", "text": "Morning brief: 3 meetings today, 1 overdue commitment, 1 at-risk account.", "createdAt": at(0, 9)},
    ]


def risks() -> list[dict]:
    return [
        {"id": 1, "accountId": 1, "severity": "high", "title": "Acme Payroll asked twice about SSO and has had no reply for 6 days.", "evidence": "Gmail · Slack #acme-shared"},
        {"id": 2, "severity": "medium", "title": "PLAT-212 is blocked on a vendor API key and is due Friday.", "evidence": "Jira · standup transcript"},
        {"id": 3, "accountId": 2, "severity": "medium", "title": "Globex requested API docs 3 days ago; nothing sent yet.", "evidence": "Zoom transcript · Gmail"},
    ]


def agents() -> list[dict]:
    return [
        {"id": "orchestrator", "name": "Orchestrator", "scope": "Plans, delegates and answers across all tools", "status": "live", "activity": "Answered 14 questions today", "updatedAt": at(0, 14, 50), "managerOnly": True},
        {"id": "mail", "name": "Mail & Calendar agent", "scope": "Gmail and Google Calendar", "status": "syncing", "activity": "Syncing 41 new emails", "updatedAt": at(0, 14, 52)},
        {"id": "slack", "name": "Slack agent", "scope": "Channels and threads", "status": "live", "activity": "Watching 6 channels", "updatedAt": at(0, 14, 51)},
        {"id": "jira", "name": "Jira agent", "scope": "Issues, sprints and blockers", "status": "live", "activity": "Tracking 3 boards", "updatedAt": at(0, 14, 30)},
        {"id": "meetings", "name": "Meetings agent", "scope": "Zoom notes and transcripts", "status": "live", "activity": "Transcribed 3 meetings", "updatedAt": at(0, 14, 44)},
        {"id": "confluence", "name": "Confluence agent", "scope": "Specs, runbooks and how-tos", "status": "idle", "activity": "Indexed 2 pages", "updatedAt": at(0, 13, 40)},
    ]


def _zoom_meta(meeting_uuid: str, topic: str, start: str, minutes: int, participants: list[str]) -> dict:
    # Mirrors the fields Moss reads from Zoom's GET /meetings/{id}/recordings response.
    return {
        "uuid": meeting_uuid,
        "topic": topic,
        "start_time": start,
        "duration": minutes,
        "participants": participants,
        "recording_files": [{"file_type": "TRANSCRIPT", "file_extension": "VTT", "status": "completed"}],
    }


def documents() -> list[dict]:
    return [
        # Meetings (Zoom transcripts)
        {"id": 1, "source": "zoom", "accountId": 1, "title": "Acme Payroll discovery call", "occurredAt": at(-21, 11),
         "meta": _zoom_meta("acme-disc-01", "Acme Payroll discovery call", at(-21, 11), 51, ["Dana Kim", "Priya Shah", "Jordan Reyes (Acme IT)", "Lena Park (Acme HR)"]),
         "body": "Dana Kim: Thanks for joining. Lena, can you walk us through what you need?\n"
                 "Lena Park (Acme HR): We run payroll for about 1,200 employees across the US and Germany. We want the payroll integration and ideally the time-off module in one pilot.\n"
                 "Dana Kim: That works. We'd suggest a six-week pilot with two departments.\n"
                 "Jordan Reyes (Acme IT): Before we commit, we need SSO through Okta. Do you support SCIM provisioning?\n"
                 "Priya Shah: SAML SSO works today. SCIM is being built under PLAT-204; I'll confirm the timeline.\n"
                 "Jordan Reyes (Acme IT): Also our German staff data must stay in the EU. That's a hard requirement.\n"
                 "Dana Kim: Noted as a risk. We have an EU residency FAQ and an EU region on the roadmap.\n"
                 "Lena Park (Acme HR): Then let's agree: pilot with payroll plus time-off. We'll need pricing by mid-month.\n"
                 "Dana Kim: Decision recorded. I'll send pricing, and Priya will follow up on SCIM."},
        {"id": 2, "source": "zoom", "accountId": 2, "title": "Globex intro call (finance)", "occurredAt": at(-3, 11),
         "meta": _zoom_meta("globex-intro-01", "Globex intro call", at(-3, 11), 38, ["Sam Ortiz", "Helen Wu (Globex Finance)", "Raj Patel (Globex IT)"]),
         "body": "Sam Ortiz: Helen, what prompted the evaluation?\n"
                 "Helen Wu (Globex Finance): Our payroll runs on ADP. We need a payroll integration that syncs with ADP without manual exports.\n"
                 "Raj Patel (Globex IT): What are your API rate limits? We'd sync nightly for about 9,000 employees.\n"
                 "Sam Ortiz: Nightly batch sync at that size is fine. I'll send the API integration guide with the limits by tomorrow.\n"
                 "Helen Wu (Globex Finance): Great. If the docs look good we'll book a technical deep dive.\n"
                 "Sam Ortiz: Action on me: send the integration guide. Next step: schedule a deep dive."},
        {"id": 3, "source": "zoom", "accountId": None, "title": "Platform Sync", "occurredAt": at(0, 14),
         "meta": _zoom_meta("plat-sync-0412", "Platform Sync", at(0, 14), 42, ["Dana Kim", "Priya Shah", "Marcus Lee"]),
         "body": "Dana Kim: First item: the summarisation endpoint. Costs on Claude went up 30% this month.\n"
                 "Priya Shah: I can put OpenAI behind an LLM_PROVIDER flag so we can switch per tenant.\n"
                 "Marcus Lee: Then I'll need to update the load tests for the new provider.\n"
                 "Dana Kim: Agreed. Decision: move /v1/summarise from Claude to OpenAI behind a provider flag. Priya owns the backend change, Marcus updates the load tests. Target: end of next sprint.\n"
                 "Priya Shah: I'll also share the current load-test baseline with Marcus by Monday.\n"
                 "Marcus Lee: PLAT-212 is still blocked on the vendor API key, and it's due Friday. That's a risk.\n"
                 "Dana Kim: Let's kick off the migration Tuesday at 10."},
        {"id": 4, "source": "zoom", "accountId": 5, "title": "Stark procurement sync", "occurredAt": at(0, 10, 30),
         "meta": _zoom_meta("stark-proc-02", "Stark procurement sync", at(0, 10, 30), 30, ["Marcus Lee", "Olivia Grant (Stark Procurement)"]),
         "body": "Olivia Grant (Stark Procurement): Our security team signed off on the review.\n"
                 "Marcus Lee: Excellent. What's left on your side?\n"
                 "Olivia Grant (Stark Procurement): Legal will send redlines; we need them back by Friday to hit quarter end.\n"
                 "Marcus Lee: I'll return the redlines by Friday and confirm by email today."},
        # Gmail
        {"id": 10, "source": "gmail", "accountId": 1, "title": "Re: Okta SCIM support?", "occurredAt": at(-6, 9, 40),
         "meta": {"from": "jordan.reyes@acme.example", "to": ["dana@moss.example", "priya@moss.example"], "thread": "acme-sso"},
         "body": "Hi Dana, Priya — following up again on SCIM provisioning through Okta. We can't schedule the pilot kickoff until IT signs off on SSO. Any update? — Jordan"},
        {"id": 11, "source": "gmail", "accountId": 1, "title": "Acme pilot pricing", "occurredAt": at(-15, 13),
         "meta": {"from": "dana@moss.example", "to": ["lena.park@acme.example"], "thread": "acme-pricing"},
         "body": "Hi Lena, attached is our tiered pricing for 1,200 employees with a 15% pilot discount for the six-week pilot (payroll + time-off). Happy to walk through it. — Dana"},
        {"id": 12, "source": "gmail", "accountId": 2, "title": "API documentation request", "occurredAt": at(-3, 15),
         "meta": {"from": "raj.patel@globex.example", "to": ["sam@moss.example"], "thread": "globex-api"},
         "body": "Sam, thanks for the call. Please send the API integration guide including rate limits and the ADP sync approach. — Raj"},
        {"id": 13, "source": "gmail", "accountId": 3, "title": "Initech renewal signed", "occurredAt": at(-5, 10),
         "meta": {"from": "ops@initech.example", "to": ["priya@moss.example"], "thread": "initech-renewal"},
         "body": "We've signed the renewal for another 12 months. Back in June we asked about a payroll integration — not a priority this year, but keep us posted."},
        # Slack
        {"id": 20, "source": "slack", "accountId": 1, "title": "#acme-shared · pilot scope", "occurredAt": at(-11, 16, 5),
         "meta": {"channel": "#acme-shared"},
         "body": "Lena Park: Confirming pilot scope: two departments, six weeks, kickoff on the 14th.\nDana Kim: Confirmed. We still owe Jordan an answer on Okta SCIM."},
        {"id": 21, "source": "slack", "accountId": 4, "title": "#sales-leads · Umbrella HR", "occurredAt": at(-2, 14),
         "meta": {"channel": "#sales-leads"},
         "body": "Nina (SDR): Umbrella HR reached out — interested in payroll integration for ~400 staff. Asked about pricing. Dana, can you book a discovery call?"},
        # Jira
        {"id": 30, "source": "jira", "accountId": 1, "title": "PLAT-204 · Okta SCIM connector", "occurredAt": at(-20, 10),
         "meta": {"key": "PLAT-204", "status": "In Progress", "assignee": "Priya Shah"},
         "body": "Build SCIM 2.0 provisioning for Okta. Requested by Acme Payroll (pilot blocker). Target: next sprint."},
        {"id": 31, "source": "jira", "accountId": None, "title": "PLAT-212 · Vendor API key for address validation", "occurredAt": at(-4, 10),
         "meta": {"key": "PLAT-212", "status": "Blocked", "assignee": "Marcus Lee"},
         "body": "Blocked waiting on vendor API key. Due Friday."},
        # Confluence
        {"id": 40, "source": "confluence", "accountId": None, "title": "EU data residency FAQ", "occurredAt": at(-30, 9),
         "meta": {"space": "SEC"},
         "body": "Customer data is hosted in us-east by default. An EU region (Frankfurt) is on the roadmap for next quarter. Until then, EU customers can enable field-level encryption for personal data."},
        {"id": 41, "source": "confluence", "accountId": None, "title": "Payroll integration guide", "occurredAt": at(-45, 9),
         "meta": {"space": "ENG"},
         "body": "Supported payroll providers: ADP, Gusto, Paychex. Batch sync up to 10,000 employees nightly. API rate limit: 100 requests/minute per tenant."},
    ]


def run(force: bool = False) -> None:
    db.init()
    if not force and not db.is_empty():
        return
    db.reset()
    for resource, rows in (
        ("accounts", accounts()),
        ("interactions", interactions()),
        ("commitments", commitments()),
        ("meetings", meetings()),
        ("proposals", proposals()),
        ("updates", updates()),
        ("risks", risks()),
        ("agents", agents()),
    ):
        db.insert_many(resource, rows)
    db.insert_documents(documents())
