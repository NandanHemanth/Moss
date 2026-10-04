// Data shapes of the Moss API. Source of truth: docs/02-api-contract.md

export type Role = "manager" | "employee";

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string;
  email?: string;
}

export interface Agent {
  id: string;
  name: string;
  epithet: string;
  tool: string;
  manager_only: boolean;
  description: string;
  /** live | mock | seeded | offline, or "a/b" when the agent wraps two tools */
  mode: string;
  allowed: boolean;
}

export interface Status {
  llm: {
    mode: string;
    primary: string | null;
    fast: string | null;
    fallback: string | null;
    last_route: string | null;
    gemini_errors: number;
    fallback_errors: number;
    last_error: string | null;
  };
  graph: { backend: string; facts: number; graphiti?: Record<string, unknown> };
  cache: { hits: number; misses: number; namespaces: Record<string, number> };
  connectors: Record<string, string>;
  voice: string;
  counts: Record<string, number>;
}

export interface Account {
  id: string;
  name: string;
  kind: string;
  summary: string;
  open_commitments: number;
  events: number;
}

export type InsightKind = "decision" | "commitment" | "risk" | string;

export interface Insight {
  kind: InsightKind;
  text: string;
  owner: string | null;
  due: string | null;
}

export type ActionStatus = "pending" | "approved" | "executed" | "skipped" | "failed" | string;

export interface ActionResult {
  text?: string;
  url?: string;
  key?: string;
  error?: string;
  [key: string]: unknown;
}

export interface ProposedAction {
  id: string;
  proposal_id: string;
  agent_id: string;
  kind: string;
  title: string;
  detail: string;
  params: Record<string, unknown> | null;
  status: ActionStatus;
  result: ActionResult | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  position: number;
}

export interface MossEvent {
  id: string;
  source: string;
  agent_id: string;
  title: string;
  summary: string | null;
  occurred_at: string;
  account: string | null;
  participants: string[] | null;
  url: string | null;
  importance?: number;
  meta?: {
    duration_minutes?: number;
    _extraction?: { insights?: Insight[]; [key: string]: unknown };
    [key: string]: unknown;
  } | null;
}

export interface Proposal {
  id: string;
  event_id: string | null;
  created_at: string;
  status: "pending" | "done" | string;
  actions: ProposedAction[];
  event: MossEvent | null;
  insights?: Insight[];
}

export interface Commitment {
  id: string;
  event_id: string | null;
  text: string;
  owner: string | null;
  due: string | null;
  status: "open" | "done" | string;
  agent_id: string;
  account: string | null;
  created_at: string;
  event_title?: string | null;
}

export interface Whisper {
  id: string;
  agent_id: string;
  text: string;
  created_at: string;
  event_id: string | null;
  agent_name?: string;
}

export interface AskSource {
  agent_id?: string;
  label: string;
  url: string | null;
  event_id?: string | null;
}

export interface AskResponse {
  agent_id: string;
  answer: string;
  sources: AskSource[];
  trace: string[];
  queued_actions: string[];
  route: string;
}

export interface DemoQueueItem {
  id: string;
  title: string;
  source: string;
}

export interface MeetingEndedResult {
  event_id: string;
  insights?: number;
  proposal_id?: string | null;
  [key: string]: unknown;
}

export interface SyncResult {
  new: number;
  processed: unknown[];
  deferred: number;
  errors: Record<string, string>;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  event_id?: string | null;
  valid_at?: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
