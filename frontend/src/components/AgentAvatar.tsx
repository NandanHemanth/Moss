import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { agentLook } from "../lib/agents";
import type { Agent } from "../types";

/** Agents from GET /api/agents, shared with every avatar so names never have to be hard-coded. */
export interface AgentDirectory {
  agents: Agent[];
  byId: Map<string, Agent>;
  isLoading: boolean;
  /** Display name for an agent id, falling back to the id itself. */
  nameOf: (id: string | null | undefined) => string;
}

const AgentsContext = createContext<AgentDirectory>({ agents: [], byId: new Map(), isLoading: true, nameOf: (id) => id || "Agent" });

export function AgentsProvider({ value, children }: { value: Omit<AgentDirectory, "nameOf">; children: ReactNode }) {
  const nameOf = (id: string | null | undefined) => (id && value.byId.get(id)?.name) || capitalise(id) || "Agent";
  return <AgentsContext.Provider value={{ ...value, nameOf }}>{children}</AgentsContext.Provider>;
}

export const useAgentDirectory = () => useContext(AgentsContext);

const capitalise = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/** Round badge for an agent: emoji glyph on the agent's colour (two-letter initials for unknown ids). */
export function AgentAvatar({ id, size, className = "" }: { id: string | null | undefined; size?: "lg"; className?: string }) {
  const { byId } = useAgentDirectory();
  const agent = id ? byId.get(id) : undefined;
  const name = agent?.name || capitalise(id) || "Agent";
  const look = agentLook(id, name);
  const isGlyph = !/^[A-Za-z?]{1,2}$/.test(look.glyph);
  const title = agent ? `${agent.name} · ${agent.tool}` : name;
  return (
    <span
      className={`av ${isGlyph ? "glyph" : ""} ${size ?? ""} ${className}`.replace(/\s+/g, " ").trim()}
      style={{ "--c": look.color } as CSSProperties}
      title={title}
      role="img"
      aria-label={title}
    >
      {look.glyph}
    </span>
  );
}

/** Neutral badge for things that did not come from an agent (e.g. a request typed in chat). */
export function PlainAvatar({ glyph, label, size }: { glyph: string; label: string; size?: "lg" }) {
  return (
    <span className={`av glyph ${size ?? ""}`.trim()} style={{ "--c": "#737d77" } as CSSProperties} title={label} role="img" aria-label={label}>
      {glyph}
    </span>
  );
}
