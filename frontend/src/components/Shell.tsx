// App shell for Layout A ("Clearing"): top-right controls, left sidebar, page outlet, grove backdrop.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useLogin, useSubscription } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL, PINNED_USERS } from "../config";
import { useAgents, useAllowed, useIdentity, useMossList, useMossQuery, useRole, MOSS_QUERY_KEY } from "../hooks/useMoss";
import { useVoice, voice } from "../hooks/voice";
import { compactMode, modeTone } from "../lib/agents";
import { firstName } from "../lib/format";
import { MOSS_CHANNEL, type MossLiveProvider, type StreamState } from "../providers/liveProvider";
import { errorMessage } from "../providers/http";
import { applyTheme, themeStore, useTheme, useUserId } from "../session";
import type { Agent, Status, User, Whisper } from "../types";
import { AgentAvatar, AgentsProvider } from "./AgentAvatar";
import { GroveBackdrop } from "./GroveBackdrop";
import { Loading } from "./States";

export const LiveContext = createContext<MossLiveProvider | null>(null);

function useStreamState(): StreamState {
  const live = useContext(LiveContext);
  return useSyncExternalStore(
    (l) => (live ? live.onState(l) : () => {}),
    () => (live ? live.getState() : "closed"),
  );
}

/** Reacts to SSE events that are not tied to a refine resource: status/graph/queue refresh and voice. */
function LiveBridge() {
  const queryClient = useQueryClient();
  const canHear = useAllowed("voice", "use");
  const canHearRef = useRef(canHear);
  canHearRef.current = canHear;

  useSubscription({
    channel: MOSS_CHANNEL,
    types: ["*"],
    onLiveEvent: (event) => {
      void queryClient.invalidateQueries({ queryKey: [MOSS_QUERY_KEY] }, { cancelRefetch: false });
      if (event.type === "notification" && canHearRef.current) {
        const n = event.payload as unknown as Whisper;
        if (n?.id && n?.text) voice.enqueue({ id: n.id, text: n.text });
      }
    },
  });

  // Leaving the manager role (user switch) silences anything still being read out.
  useEffect(() => () => voice.stop(), []);
  return null;
}

export function VoiceToggle({ compact = false }: { compact?: boolean }) {
  const { enabled, needsGesture } = useVoice();
  const label = enabled
    ? needsGesture
      ? "Voice on — click anywhere to start"
      : "Voice on"
    : compact
      ? "Voice off"
      : "Voice off — click to hear updates";
  return (
    <button
      type="button"
      className="tog"
      aria-pressed={enabled}
      title={enabled ? "Mute spoken updates" : "Read new whispers aloud"}
      onClick={() => voice.setEnabled(!enabled)}
    >
      <span aria-hidden="true">{enabled ? "🔊 " : "🔇 "}</span>
      {label}
    </button>
  );
}

function UserSwitcher() {
  const current = useUserId();
  const { data: users, error } = useMossList<User>("users");
  const { mutate: login, isPending } = useLogin<{ userId: string }>();

  const pinned = PINNED_USERS.map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u);
  const others = users.filter((u) => !PINNED_USERS.includes(u.id));
  const pick = (userId: string) => {
    if (userId && userId !== current) login({ userId });
  };

  if (error && !users.length) return <span className="small">Users unavailable</span>;
  return (
    <span className="ctl-group">
      <b id="user-switch-label">User</b>
      <span className="seg" role="group" aria-labelledby="user-switch-label">
        {pinned.map((u) => (
          <button key={u.id} type="button" aria-pressed={u.id === current} disabled={isPending} onClick={() => pick(u.id)} data-user={u.id}>
            {firstName(u.name)}
            <span className="sub">{u.role === "manager" ? "Manager" : "Employee"}</span>
          </button>
        ))}
      </span>
      {others.length ? (
        <select
          className="field compact"
          aria-label="Switch to another person"
          value={others.some((u) => u.id === current) ? current : ""}
          onChange={(e) => pick(e.target.value)}
          style={{ marginLeft: 6 }}
        >
          <option value="">Others…</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.role}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  return (
    <span className="ctl-group">
      <b id="theme-switch-label">Theme</b>
      <span className="seg" role="group" aria-labelledby="theme-switch-label">
        <button type="button" aria-pressed={theme === "light"} onClick={() => themeStore.set("light")}>
          Notebook
        </button>
        <button type="button" aria-pressed={theme === "dark"} onClick={() => themeStore.set("dark")}>
          Enchanted grove
        </button>
      </span>
    </span>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const allowed = useAllowed("agents", "ask", { id: agent.id, manager_only: agent.manager_only }) && agent.allowed;
  const body = (tag: ReactNode) => (
    <>
      <AgentAvatar id={agent.id} />
      <span className="who">
        <span className="who-line">
          <span className="who-name">{agent.name}</span>
          {tag}
        </span>
        <span className="small">{agent.tool}</span>
      </span>
    </>
  );
  if (!allowed) {
    return (
      <div className="nav-item off" aria-disabled="true" title={`${agent.name} answers to managers only`} data-agent={agent.id} data-locked="true">
        {body(<span className="lock">Manager</span>)}
      </div>
    );
  }
  return (
    <Link to={`/ask?agent=${encodeURIComponent(agent.id)}`} title={`${agent.epithet}. ${agent.description}`} data-agent={agent.id}>
      {body(
        <span className={`tag ${modeTone(agent.mode)}`} title={`Connector mode: ${agent.mode}`}>
          {compactMode(agent.mode)}
        </span>,
      )}
    </Link>
  );
}

function StatusStrip() {
  const { data: status, error } = useMossQuery<Status>("status", "/api/status");
  const stream = useStreamState();
  const streamLabel = stream === "live" ? "Live updates on" : stream === "connecting" ? "Connecting…" : stream === "reconnecting" ? "Reconnecting…" : "Live updates off";
  return (
    <div className="status" aria-label="System status">
      <div className="row" style={{ gap: 6 }}>
        <i className={`dot ${stream === "live" ? "" : stream === "closed" ? "idle" : "warn"}`} aria-hidden="true" />
        <span>{streamLabel}</span>
      </div>
      {status ? (
        <dl>
          <dt>LLM</dt>
          <dd title={status.llm.last_error || status.llm.last_route || undefined}>{status.llm.mode}</dd>
          <dt>Graph</dt>
          <dd>
            {status.graph.backend} · {status.graph.facts} facts
          </dd>
          <dt>Cache</dt>
          <dd>
            {status.cache.hits} hits · {status.cache.misses} misses
          </dd>
          <dt>Voice</dt>
          <dd>{status.voice}</dd>
        </dl>
      ) : (
        <div>{error ? "Status unavailable" : "Loading status…"}</div>
      )}
    </div>
  );
}

function Sidebar({ agents, loading }: { agents: Agent[]; loading: boolean }) {
  const role = useRole();
  return (
    <aside className="side">
      <Link className="logo" to="/">
        <i aria-hidden="true" />
        Moss
      </Link>
      <nav className="nav main-nav" aria-label="Pages">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>
          {role === "employee" ? "My work" : "Clearing"}
        </NavLink>
        <NavLink to="/ask" className={({ isActive }) => (isActive ? "on" : "")}>
          Ask
        </NavLink>
        <NavLink to="/timeline" className={({ isActive }) => (isActive ? "on" : "")}>
          Timeline
        </NavLink>
        <NavLink to="/graph" className={({ isActive }) => (isActive ? "on" : "")}>
          Graph
        </NavLink>
      </nav>
      <div className="lbl">Agents</div>
      <nav className="nav agent-nav" aria-label="Agents">
        {loading && !agents.length ? <div className="small">Loading agents…</div> : null}
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} />
        ))}
      </nav>
      <StatusStrip />
    </aside>
  );
}

export function Shell() {
  const theme = useTheme();
  const identity = useIdentity();
  const role = useRole();
  const agentsQuery = useAgents();
  const canVoice = useAllowed("voice", "use");

  // "View the grove": fade the panels so the scene behind them can be admired (dark theme only).
  const [showcase, setShowcase] = useState(false);
  const showing = theme === "dark" && showcase;
  useEffect(() => {
    if (theme !== "dark") setShowcase(false);
  }, [theme]);
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowcase(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showing]);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    document.title = role === "employee" ? "Moss · My work" : "Moss";
  }, [role]);

  const me = identity.data;
  return (
    <AgentsProvider value={{ agents: agentsQuery.agents, byId: agentsQuery.byId, isLoading: agentsQuery.isLoading }}>
      <LiveBridge />
      <div className="app" data-showcase={showing ? "on" : undefined}>
        <header className="ctl">
          <span className="small who-am-i">
            {me ? (
              <>
                <b>{me.role}</b>
                {me.name} · {me.title}
              </>
            ) : null}
          </span>
          <span className="spacer" />
          <UserSwitcher />
          <ThemeToggle />
          {theme === "dark" ? (
            <button
              type="button"
              className="tog grove-toggle"
              aria-pressed={showing}
              title={showing ? "Bring the panels back (Esc)" : "Fade the panels and look at the grove"}
              onClick={() => setShowcase((on) => !on)}
              data-testid="grove-toggle"
            >
              <span aria-hidden="true">{showing ? "↩ " : "🌿 "}</span>
              {showing ? "Back to Moss" : "View the grove"}
            </button>
          ) : null}
          {canVoice ? <VoiceToggle /> : null}
        </header>

        <div className="frame A" inert={showing}>
          <Sidebar agents={agentsQuery.agents} loading={agentsQuery.isLoading} />
          {identity.isError ? (
            <section className="main">
              <h1>Moss cannot reach its backend</h1>
              <div className="state error" role="alert" style={{ marginTop: 14 }}>
                <div className="grow">
                  {errorMessage(identity.error)}
                  <div className="small">API base URL: {API_URL}</div>
                </div>
                <button className="btn" onClick={() => identity.refetch()}>
                  Retry
                </button>
              </div>
            </section>
          ) : identity.isLoading || !role ? (
            <section className="main">
              <Loading label="Waking the grove…" />
            </section>
          ) : (
            <Outlet />
          )}
        </div>
        <GroveBackdrop showcase={showing} />
      </div>
    </AgentsProvider>
  );
}
