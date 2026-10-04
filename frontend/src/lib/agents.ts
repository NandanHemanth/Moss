// The ONE place that knows how each agent id looks. Names, tools and descriptions always come
// from GET /api/agents; only the stable ids (stag, raven, firefly, fox, owl, tortoise) are used here.

export interface AgentLook {
  /** Emoji glyph shown in the round badge. */
  glyph: string;
  /** Badge background. */
  color: string;
}

export const AGENT_LOOKS: Record<string, AgentLook> = {
  // Backgrounds are chosen to contrast with the emoji itself (e.g. the yellow sparkle sits on night indigo).
  stag: { glyph: "🦌", color: "#5d8a41" },
  raven: { glyph: "🪶", color: "#a8b4e0" },
  firefly: { glyph: "✨", color: "#3b3f73" },
  fox: { glyph: "🦊", color: "#2f6468" },
  owl: { glyph: "🦉", color: "#8f7cc4" },
  tortoise: { glyph: "🐢", color: "#d8c48f" },
};

const FALLBACK_COLORS = ["#737d77", "#3c8aa3", "#8c6a3a", "#a05a7c"];

/** Look for an agent id; unknown ids get two-letter initials on a neutral colour. */
export function agentLook(id: string | null | undefined, name?: string): AgentLook {
  if (id && AGENT_LOOKS[id]) return AGENT_LOOKS[id];
  const label = (name || id || "?").trim();
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { glyph: label.slice(0, 2).replace(/^./, (c) => c.toUpperCase()), color: FALLBACK_COLORS[h % FALLBACK_COLORS.length] };
}

/** "mock/mock" -> "mock"; "live/mock" stays as is. */
export function compactMode(mode: string | null | undefined): string {
  if (!mode) return "unknown";
  const parts = Array.from(new Set(mode.split("/").map((p) => p.trim()).filter(Boolean)));
  return parts.join("/") || "unknown";
}

/** CSS modifier for a mode tag: live | mock | seeded | offline | mixed. */
export function modeTone(mode: string | null | undefined): string {
  const m = compactMode(mode);
  if (m.includes("/")) return "mixed";
  if (m === "live" || m === "mock" || m === "seeded" || m === "offline") return m;
  return m.startsWith("off") ? "offline" : "live";
}
