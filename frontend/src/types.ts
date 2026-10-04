export type Role = "manager" | "employee";

export type AgentId = "orchestrator" | "mail" | "slack" | "jira" | "meetings" | "confluence";

export type Source = "gmail" | "calendar" | "slack" | "jira" | "zoom" | "confluence";

export interface Agent {
  id: AgentId;
  name: string;
  scope: string;
  status: "live" | "syncing" | "idle";
  activity: string;
  updatedAt: string;
  managerOnly?: boolean;
}

export interface Account {
  id: number;
  name: string;
  segment: string;
  stage: "Discovery" | "Pilot" | "Negotiation" | "Customer";
  owner: string;
  health: "healthy" | "watch" | "at_risk";
  arr: number;
  touchpoints30d: number;
  lastContact: string;
  topics: string[];
  summary: string;
}

export interface Interaction {
  id: number;
  accountId: number;
  source: Source;
  title: string;
  detail: string;
  occurredAt: string;
  flag?: string;
}

export interface Commitment {
  id: number;
  title: string;
  owner: string;
  accountId?: number;
  source: Source;
  sourceLabel: string;
  due: string;
  status: "open" | "done";
}

export interface Proposal {
  id: number;
  meetingId: number | null;
  agent: AgentId;
  kind: "jira_issue" | "slack_message" | "calendar_event" | "email";
  target: string;
  summary: string;
  status: "pending" | "approved" | "dismissed";
}

export interface Meeting {
  id: number;
  title: string;
  startsAt: string;
  durationMin: number;
  attendees: string[];
  status: "captured" | "upcoming";
  decision?: string;
  accountId?: number;
}

export interface Update {
  id: number;
  agent: AgentId;
  text: string;
  createdAt: string;
}

export interface Risk {
  id: number;
  accountId?: number;
  severity: "high" | "medium";
  title: string;
  evidence: string;
}
