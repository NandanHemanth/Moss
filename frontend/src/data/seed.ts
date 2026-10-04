import type {
  Account,
  Agent,
  Commitment,
  Interaction,
  Meeting,
  Proposal,
  Risk,
  Update,
} from "../types";

// Demo data until the backend is wired up. Dates are relative to today so the demo always looks current.
const at = (daysFromToday: number, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const accounts: Account[] = [
  {
    id: 1,
    name: "Acme Payroll",
    segment: "Mid-market",
    stage: "Pilot",
    owner: "Dana Kim",
    health: "at_risk",
    arr: 84000,
    touchpoints30d: 37,
    lastContact: at(-1, 15, 20),
    topics: ["payroll integration", "SSO / Okta", "EU data residency"],
    summary:
      "Evaluating the payroll integration for 1,200 employees. On the discovery call they asked about SSO via Okta and EU data residency. Pricing was sent; the SSO question has gone unanswered for 6 days.",
  },
  {
    id: 2,
    name: "Globex",
    segment: "Enterprise",
    stage: "Discovery",
    owner: "Sam Ortiz",
    health: "watch",
    arr: 210000,
    touchpoints30d: 18,
    lastContact: at(-3, 11),
    topics: ["payroll integration", "ADP sync", "API access"],
    summary:
      "Asked about ADP sync on the last call and requested API documentation. Sam owns sending the docs; no follow-up meeting booked yet.",
  },
  {
    id: 3,
    name: "Initech",
    segment: "SMB",
    stage: "Customer",
    owner: "Priya Shah",
    health: "healthy",
    arr: 36000,
    touchpoints30d: 9,
    lastContact: at(-5, 10),
    topics: ["renewal", "time-off module"],
    summary: "Renewal on track. Raised payroll integration once in June; no open commitments.",
  },
  {
    id: 4,
    name: "Umbrella HR",
    segment: "Mid-market",
    stage: "Discovery",
    owner: "Dana Kim",
    health: "watch",
    arr: 0,
    touchpoints30d: 4,
    lastContact: at(-2, 14),
    topics: ["payroll integration", "pricing"],
    summary: "Mentioned payroll integration in #sales-leads. No discovery call booked yet.",
  },
  {
    id: 5,
    name: "Stark Logistics",
    segment: "Enterprise",
    stage: "Negotiation",
    owner: "Marcus Lee",
    health: "healthy",
    arr: 320000,
    touchpoints30d: 26,
    lastContact: at(0, 10, 30),
    topics: ["security review", "multi-region"],
    summary: "Security review passed. Legal redlines expected this week; procurement call scheduled.",
  },
];

export const interactions: Interaction[] = [
  { id: 1, accountId: 1, source: "gmail", title: "SSO follow-up still unanswered", detail: "Jordan (Acme IT) asked whether Okta SCIM is supported.", occurredAt: at(-6, 9, 40), flag: "needs reply" },
  { id: 2, accountId: 1, source: "slack", title: "Pilot scope agreed in #acme-shared", detail: "Two departments, 6-week pilot, kickoff on the 14th.", occurredAt: at(-11, 16, 5) },
  { id: 3, accountId: 1, source: "gmail", title: "Pricing proposal sent", detail: "Tiered plan with a 15% pilot discount.", occurredAt: at(-15, 13) },
  { id: 4, accountId: 1, source: "zoom", title: "Discovery call", detail: "Decision: pilot with payroll + time-off modules. Risk: EU residency.", occurredAt: at(-21, 11), flag: "transcript" },
  { id: 5, accountId: 1, source: "jira", title: "PLAT-204 · Okta SCIM connector", detail: "In progress, linked to this account.", occurredAt: at(-20, 10) },
  { id: 6, accountId: 1, source: "confluence", title: "EU data residency FAQ", detail: "Cited by the orchestrator in two answers about Acme.", occurredAt: at(-30, 9) },
  { id: 7, accountId: 2, source: "zoom", title: "Intro call with Globex finance", detail: "Asked about ADP sync and API rate limits.", occurredAt: at(-3, 11), flag: "transcript" },
  { id: 8, accountId: 2, source: "gmail", title: "Request for API documentation", detail: "Sam to send the integration guide.", occurredAt: at(-3, 15) },
  { id: 9, accountId: 3, source: "gmail", title: "Renewal confirmation", detail: "Signed for another 12 months.", occurredAt: at(-5, 10) },
  { id: 10, accountId: 4, source: "slack", title: "Lead mentioned in #sales-leads", detail: "Interested in payroll integration for 400 staff.", occurredAt: at(-2, 14) },
  { id: 11, accountId: 5, source: "zoom", title: "Procurement sync", detail: "Security review passed; legal redlines due Friday.", occurredAt: at(0, 10, 30), flag: "transcript" },
];

export const commitments: Commitment[] = [
  { id: 1, title: "Answer Acme's Okta SCIM question", owner: "Priya Shah", accountId: 1, source: "gmail", sourceLabel: "Gmail thread", due: at(-1, 17), status: "open" },
  { id: 2, title: "Send Globex the API integration guide", owner: "Sam Ortiz", accountId: 2, source: "zoom", sourceLabel: "Intro call", due: at(1, 17), status: "open" },
  { id: 3, title: "Add OpenAI provider behind LLM_PROVIDER flag", owner: "Priya Shah", source: "zoom", sourceLabel: "Platform Sync", due: at(10, 17), status: "open" },
  { id: 4, title: "Share load-test baseline with Marcus", owner: "Priya Shah", source: "zoom", sourceLabel: "Platform Sync", due: at(2, 17), status: "open" },
  { id: 5, title: "Book discovery call with Umbrella HR", owner: "Dana Kim", accountId: 4, source: "slack", sourceLabel: "#sales-leads", due: at(3, 17), status: "open" },
  { id: 6, title: "Return legal redlines to Stark", owner: "Marcus Lee", accountId: 5, source: "zoom", sourceLabel: "Procurement sync", due: at(4, 17), status: "open" },
  { id: 7, title: "Review PLAT-198 PR", owner: "Priya Shah", source: "jira", sourceLabel: "Jira", due: at(-1, 17), status: "done" },
];

export const meetings: Meeting[] = [
  { id: 1, title: "Platform Sync", startsAt: at(0, 14), durationMin: 42, attendees: ["Dana Kim", "Priya Shah", "Marcus Lee"], status: "captured", decision: "Move the summarisation endpoint from Claude to OpenAI behind a provider flag. Priya owns the backend change; Marcus updates the load tests. Target: end of next sprint." },
  { id: 2, title: "Stark procurement sync", startsAt: at(0, 10, 30), durationMin: 30, attendees: ["Marcus Lee", "Stark procurement"], status: "captured", decision: "Security review passed. Legal redlines due Friday.", accountId: 5 },
  { id: 3, title: "1:1 with Priya", startsAt: at(0, 16, 30), durationMin: 30, attendees: ["Dana Kim", "Priya Shah"], status: "upcoming" },
  { id: 4, title: "Acme pilot readiness", startsAt: at(1, 11), durationMin: 45, attendees: ["Dana Kim", "Jordan (Acme IT)"], status: "upcoming", accountId: 1 },
];

export const proposals: Proposal[] = [
  { id: 1, meetingId: 1, agent: "jira", kind: "jira_issue", target: "PLAT board", summary: "Add OpenAI provider to /v1/summarise behind LLM_PROVIDER flag · assignee Priya · 5 points", status: "pending" },
  { id: 2, meetingId: 1, agent: "slack", kind: "slack_message", target: "#platform-eng", summary: "@Priya @Marcus: summary and ticket from today's sync are linked here. Kickoff Tuesday 10am.", status: "pending" },
  { id: 3, meetingId: 1, agent: "mail", kind: "calendar_event", target: "Tue 10:00–10:30", summary: "OpenAI migration kickoff · Priya, Marcus, Dana · no conflicts found", status: "pending" },
  { id: 4, meetingId: 2, agent: "mail", kind: "email", target: "procurement@stark.example", summary: "Confirm receipt of the security review and propose Friday for redlines.", status: "pending" },
  { id: 5, meetingId: 2, agent: "jira", kind: "jira_issue", target: "LEGAL board", summary: "Track Stark redlines · assignee Marcus · due Friday", status: "pending" },
];

export const updates: Update[] = [
  { id: 1, agent: "meetings", text: "Platform Sync is summarised. One decision and three follow-ups were found.", createdAt: at(0, 14, 44) },
  { id: 2, agent: "mail", text: "Acme Payroll replied about the pilot and asked for pricing.", createdAt: at(0, 14, 10) },
  { id: 3, agent: "jira", text: "PLAT-198 moved to Done. The release checklist is 80% complete.", createdAt: at(0, 13, 32) },
  { id: 4, agent: "slack", text: "Three people asked about the Q4 roadmap in #general. The Confluence agent found the doc.", createdAt: at(0, 12, 5) },
  { id: 5, agent: "orchestrator", text: "Morning brief: 3 meetings today, 1 overdue commitment, 1 at-risk account.", createdAt: at(0, 9) },
];

export const risks: Risk[] = [
  { id: 1, accountId: 1, severity: "high", title: "Acme Payroll asked twice about SSO and has had no reply for 6 days.", evidence: "Gmail · Slack #acme-shared" },
  { id: 2, severity: "medium", title: "PLAT-212 is blocked on a vendor API key and is due Friday.", evidence: "Jira · standup transcript" },
  { id: 3, accountId: 2, severity: "medium", title: "Globex requested API docs 3 days ago; nothing sent yet.", evidence: "Zoom transcript · Gmail" },
];

export const agents: Agent[] = [
  { id: "orchestrator", name: "Orchestrator", scope: "Plans, delegates and answers across all tools", status: "live", activity: "Answered 14 questions today", updatedAt: at(0, 14, 50), managerOnly: true },
  { id: "mail", name: "Mail & Calendar agent", scope: "Gmail and Google Calendar", status: "syncing", activity: "Syncing 41 new emails", updatedAt: at(0, 14, 52) },
  { id: "slack", name: "Slack agent", scope: "Channels and threads", status: "live", activity: "Watching 6 channels", updatedAt: at(0, 14, 51) },
  { id: "jira", name: "Jira agent", scope: "Issues, sprints and blockers", status: "live", activity: "Tracking 3 boards", updatedAt: at(0, 14, 30) },
  { id: "meetings", name: "Meetings agent", scope: "Zoom notes and transcripts", status: "live", activity: "Transcribed 3 meetings", updatedAt: at(0, 14, 44) },
  { id: "confluence", name: "Confluence agent", scope: "Specs, runbooks and how-tos", status: "idle", activity: "Indexed 2 pages", updatedAt: at(0, 13, 40) },
];
