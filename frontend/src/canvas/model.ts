// Canvas workflows: the API shapes (docs/02-api-contract.md, "Canvas workflows"), the calls, and the
// conversion between the stored graph and React Flow's nodes and edges.
import type { Edge, Node } from "@xyflow/react";
import { AGENT_LOOKS, agentLook } from "../lib/agents";
import { request } from "../providers/http";

export interface NodeType {
  type: string;
  label: string;
  agent_id: string | null;
  agent_name: string | null;
  can_trigger: boolean;
  can_act: boolean;
  hint: string;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  trigger: string;
  description: string;
  input: string;
  output: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: Graph;
  created_by?: string;
  updated_at?: string;
  last_run?: unknown;
}

export interface GeneratedWorkflow {
  name: string;
  description: string;
  graph: Graph;
  source: string;
}

export interface RunAction {
  kind: string;
  title: string;
  detail?: string;
  params?: Record<string, unknown> | null;
}

export interface RunStep {
  node_id: string;
  type: string;
  label: string;
  role: string;
  output: string;
  action?: RunAction | null;
}

export interface RunResult {
  workflow_id: string | null;
  status: string;
  steps: RunStep[];
  summary: string;
  proposal_id: string | null;
  route: string | null;
}

export interface WorkflowBody {
  name: string;
  description?: string;
  enabled?: boolean;
  graph: Graph;
}

// ---------- API ----------
export const generateWorkflow = (prompt: string) => request<GeneratedWorkflow>("/api/workflows/generate", { method: "POST", body: { prompt } });
export const createWorkflow = (body: WorkflowBody) => request<Workflow>("/api/workflows", { method: "POST", body });
export const updateWorkflow = (id: string, body: Partial<WorkflowBody>) =>
  request<Workflow>(`/api/workflows/${encodeURIComponent(id)}`, { method: "PUT", body });
export const deleteWorkflow = (id: string) => request<unknown>(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
/** `id` is a saved workflow id, or "draft" for a canvas that has not been saved. */
export const runWorkflow = (id: string, body: { input: string; queue: boolean; graph: Graph; name: string }) =>
  request<RunResult>(`/api/workflows/${encodeURIComponent(id)}/run`, { method: "POST", body });

// ---------- board model ----------
/** What a node carries on the board. `kind` is the API node type ("gmail", "llm", …). */
export type StepData = {
  kind: string;
  label: string;
  trigger: string;
  description: string;
  input: string;
  output: string;
};
export type StepNode = Node<StepData, "step">;

export const TEXT_FIELDS = ["trigger", "description", "input", "output"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** These only start a workflow: nothing can lead into them. */
export const TRIGGER_ONLY = new Set(["input", "meeting"]);
/** Nothing can follow the output. */
export const END_ONLY = new Set(["output"]);

export const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };
export const DEFAULT_NAME = "Untitled workflow";

export function toFlow(graph: Graph | null | undefined): { nodes: StepNode[]; edges: Edge[] } {
  const nodes: StepNode[] = (graph?.nodes ?? []).map((n) => ({
    id: n.id,
    type: "step",
    position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
    data: {
      kind: n.type,
      label: n.label ?? "",
      trigger: n.trigger ?? "",
      description: n.description ?? "",
      input: n.input ?? "",
      output: n.output ?? "",
    },
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = (graph?.edges ?? [])
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: e.id || `${e.source}-${e.target}`, source: e.source, target: e.target }));
  return { nodes, edges };
}

export function toGraph(nodes: StepNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      label: n.data.label,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      trigger: n.data.trigger,
      description: n.data.description,
      input: n.data.input,
      output: n.data.output,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** One string that changes whenever something worth saving changes. */
export const snapshot = (name: string, description: string, enabled: boolean, graph: Graph): string =>
  JSON.stringify({ name: name.trim(), description, enabled, graph });

export const BLANK_SNAPSHOT = snapshot(DEFAULT_NAME, "", false, EMPTY_GRAPH);

/** Nodes that would start the workflow: a trigger-capable type with nothing leading into it. */
export function triggerIds(nodes: StepNode[], edges: Edge[], types: Map<string, NodeType>): Set<string> {
  const hasIncoming = new Set(edges.map((e) => e.target));
  const out = new Set<string>();
  for (const n of nodes) {
    const t = types.get(n.data.kind);
    const canTrigger = t ? t.can_trigger : TRIGGER_ONLY.has(n.data.kind);
    if (canTrigger && !hasIncoming.has(n.id)) out.add(n.id);
  }
  return out;
}

export function nextNodeId(nodes: StepNode[]): string {
  const taken = new Set(nodes.map((n) => n.id));
  let i = nodes.reduce((max, n) => Math.max(max, Number(/^n(\d+)$/.exec(n.id)?.[1] ?? 0)), 0) + 1;
  while (taken.has(`n${i}`)) i += 1;
  return `n${i}`;
}

export interface StepLook {
  glyph: string;
  color: string;
  /** A plain text glyph (not an agent's emoji). */
  plain: boolean;
}

const PLAIN_LOOKS: Record<string, StepLook> = {
  input: { glyph: "→", color: "#737d77", plain: true },
  llm: { glyph: "✦", color: AGENT_LOOKS.stag.color, plain: true },
  output: { glyph: "✓", color: "#737d77", plain: true },
};

/** Icon for a node type: the owning agent's glyph for tools, a simple mark for Input, LLM and Output. */
export function stepLook(kind: string, agentId: string | null | undefined): StepLook {
  if (PLAIN_LOOKS[kind]) return PLAIN_LOOKS[kind];
  const look = agentLook(agentId, kind);
  return { ...look, plain: !agentId || !AGENT_LOOKS[agentId] };
}

/** Example chips: a short label, and the sentence handed to Stag. */
export const EXAMPLES: Array<{ label: string; prompt: string }> = [
  { label: "Bug email → Jira ticket + Slack", prompt: "When an email reports a bug, create a Jira ticket and tell the team in Slack" },
  { label: "Meeting → Confluence page + Slack", prompt: "After a meeting, write the decisions to a Confluence page and post a summary in Slack" },
  { label: "Call request → calendar invite + reply", prompt: "When a customer emails asking for a call, schedule it in the calendar and reply by email" },
];

export const SAMPLE_INPUT = `From: priya@harborline.example
Subject: Export button broken

Hi team, the export button on the invoices page has crashed since this morning's release. We need it fixed before Friday's month-end close.

Priya, Harborline Freight`;
