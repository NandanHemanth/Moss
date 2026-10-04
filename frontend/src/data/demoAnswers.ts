import type { AgentId } from "../types";

export interface PlanStep {
  agent: AgentId | "cache" | "graph" | "database";
  text: string;
}

export interface DemoAnswer {
  plan: PlanStep[];
  answer: string;
  citations: string[];
}

// Canned answers for the demo questions until the orchestrator backend is connected.
const ANSWERS: { match: RegExp; answer: DemoAnswer }[] = [
  {
    match: /payroll/i,
    answer: {
      plan: [
        { agent: "cache", text: "Cache: no fresh answer, continuing" },
        { agent: "graph", text: "Knowledge graph: 4 accounts linked to “payroll integration”" },
        { agent: "mail", text: "Mail & Calendar agent searched 12 email threads" },
        { agent: "meetings", text: "Meetings agent searched 9 transcripts" },
        { agent: "jira", text: "Jira agent pulled 3 linked issues" },
      ],
      answer:
        "Four customers have shown interest in payroll integration in the last 60 days:\n\n1. Acme Payroll — pilot starts on the 14th. Open: SSO answer to Jordan (6 days overdue).\n2. Globex — asked about ADP sync on the intro call. Open: send API docs (owner Sam).\n3. Umbrella HR — mentioned in #sales-leads. Open: no discovery call booked yet.\n4. Initech — raised it once in June. No open commitments.",
      citations: ["Zoom · Acme discovery call", "Zoom · Globex intro call", "Slack #sales-leads", "Jira PLAT-204"],
    },
  },
  {
    match: /acme|last month|discuss/i,
    answer: {
      plan: [
        { agent: "cache", text: "Cache: hit for Acme summary (15 min old)" },
        { agent: "graph", text: "Knowledge graph: Acme → Jordan, SSO / Okta, EU residency, PLAT-204" },
        { agent: "meetings", text: "Meetings agent read the discovery call transcript" },
        { agent: "mail", text: "Mail & Calendar agent read 4 threads" },
      ],
      answer:
        "Last month with Acme Payroll we covered:\n\n• Scope: a 6-week pilot for two departments using payroll and time-off modules.\n• Security: Jordan (Acme IT) asked whether Okta SCIM is supported — still unanswered.\n• Compliance: EU data residency was flagged as a risk; the Confluence FAQ covers it.\n• Commercials: tiered pricing with a 15% pilot discount was sent.",
      citations: ["Zoom · Acme discovery call", "Gmail · SSO follow-up", "Gmail · Pricing proposal", "Confluence · EU residency FAQ"],
    },
  },
  {
    match: /commitment|next step|globex|open/i,
    answer: {
      plan: [
        { agent: "database", text: "Database: 6 open commitments across 4 accounts" },
        { agent: "graph", text: "Knowledge graph: linked owners and source meetings" },
        { agent: "jira", text: "Jira agent checked status of linked issues" },
      ],
      answer:
        "Open commitments and next steps:\n\n• Globex — Sam to send the API integration guide (due tomorrow).\n• Acme Payroll — Priya to answer the Okta SCIM question (overdue).\n• Umbrella HR — Dana to book a discovery call (due in 3 days).\n• Stark Logistics — Marcus to return legal redlines (due Friday).",
      citations: ["Zoom · Globex intro call", "Gmail · SSO follow-up", "Slack #sales-leads", "Zoom · Stark procurement sync"],
    },
  },
];

export const demoAnswer = (question: string): DemoAnswer =>
  ANSWERS.find((a) => a.match.test(question))?.answer ?? {
    plan: [
      { agent: "cache", text: "Cache: no fresh answer" },
      { agent: "graph", text: "Knowledge graph: no strong matches" },
    ],
    answer:
      "I couldn't find anything on that in the demo data yet. Once the integrations are connected I'll search email, meetings, Slack, Jira and Confluence.",
    citations: [],
  };
