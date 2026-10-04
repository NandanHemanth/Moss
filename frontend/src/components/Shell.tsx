// App shell for Layout A ("Clearing"): top-right controls, left sidebar, page outlet, grove backdrop.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useLogin, useSubscription } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL, PINNED_USERS } from "../config";
import { useAgents, useAllowed, useIdentity, useMossList, useMossQuery, useRole, MOSS_QUERY_KEY } from "../hooks/useMoss";
import { useVoice, voice } from "../hooks/voice";
import { compactMode } from "../lib/agents";
import { firstName, formatCount, plural } from "../lib/format";
import { MOSS_CHANNEL, type MossLiveProvider, type StreamState } from "../providers/liveProvider";
import { errorMessage } from "../providers/http";
import { AMBIENT_SECONDS, SFX_NAMES, SFX_VOLUME, sfx } from "../lib/sfx";
import { applyMotion, applyTheme, motionStore, musicPrefStore, sfxPrefStore, themeStore, useMotion, useMusicPref, useSfxPref, useTheme, useUserId } from "../session";
import type { Agent, Status, User, Whisper } from "../types";
import { AgentAvatar, AgentsProvider } from "./AgentAvatar";
import { GroveBackdrop } from "./GroveBackdrop";
import { GroveMusic } from "./GroveMusic";
import { Popover } from "./Popover";
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

/** The one voice switch (it lives in the Whispers rail). */
export function VoiceToggle() {
  const { enabled, needsGesture } = useVoice();
  return (
    <button
      type="button"
      className="tog"
      aria-pressed={enabled}
      title={enabled ? (needsGesture ? "Click anywhere to start the voice" : "Mute spoken updates") : "Read new whispers aloud"}
      onClick={() => voice.setEnabled(!enabled)}
    >
      <span aria-hidden="true">{enabled ? "🔊 " : "🔇 "}</span>
      {enabled ? "Voice on" : "Voice off"}
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
      <span className="seg" role="group" aria-label="View Moss as">
        {pinned.map((u) => (
          <button key={u.id} type="button" aria-pressed={u.id === current} disabled={isPending} onClick={() => pick(u.id)} data-user={u.id}>
            {firstName(u.name)}
            <span className="sub">{u.role === "manager" ? "Manager" : "Employee"}</span>
          </button>
        ))}
      </span>
      {others.length ? (
        <select className="field compact" aria-label="Switch to another person" value={others.some((u) => u.id === current) ? current : ""} onChange={(e) => pick(e.target.value)}>
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
    <span className="seg" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme === "light"} onClick={() => themeStore.set("light")} title="Notebook (light)">
        Notebook
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => themeStore.set("dark")} title="Enchanted grove (dark)">
        Grove
      </button>
    </span>
  );
}

/** The gear: the rarely used display choices live here so the top bar stays short. */
function SettingsMenu({ onViewGrove }: { onViewGrove: (() => void) | null }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const motion = useMotion();
  const on = motion === "on";
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn boxed"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((o) => !o)}
        data-testid="settings"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label="Settings" align="end" width={250} className="menu">
        <div className="menu-row">
          <span>
            Motion
            <span className="small">Animations and fades</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={on}
            aria-label="Motion"
            onClick={() => motionStore.set(on ? "off" : "on")}
            data-testid="motion-toggle"
          >
            <i />
          </button>
        </div>
        {onViewGrove ? (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onViewGrove();
            }}
          >
            <span aria-hidden="true">🌿</span> View the grove
          </button>
        ) : null}
      </Popover>
    </>
  );
}

/** One dot per agent: green = connected live, grey = mock or seeded data, amber = offline. */
function modeDot(mode: string): { tone: string; text: string } {
  const m = compactMode(mode);
  if (m.split("/").some((p) => p.startsWith("off"))) return { tone: "warn", text: "offline" };
  if (m.split("/").includes("live")) return { tone: "", text: m === "live" ? "live" : `${m} (partly live)` };
  return { tone: "idle", text: `${m} data` };
}

function AgentRow({ agent }: { agent: Agent }) {
  const allowed = useAllowed("agents", "ask", { id: agent.id, manager_only: agent.manager_only }) && agent.allowed;
  const dot = modeDot(agent.mode);
  if (!allowed) {
    return (
      <div className="nav-item off" aria-disabled="true" title={`${agent.name} answers to managers only`} data-agent={agent.id} data-locked="true">
        <AgentAvatar id={agent.id} />
        <span className="who-name">{agent.name}</span>
        <span className="lock" aria-label="Managers only">
          Manager
        </span>
      </div>
    );
  }
  return (
    <Link
      to={`/ask?agent=${encodeURIComponent(agent.id)}`}
      title={`Ask ${agent.name} · ${agent.tool} · ${dot.text}${agent.reason ? `\n${agent.reason}` : ""}`}
      data-agent={agent.id}
      data-reason={agent.reason || undefined}
    >
      <AgentAvatar id={agent.id} />
      <span className="who-name">{agent.name}</span>
      <i className={`dot ${dot.tone}`} role="img" aria-label={dot.text} data-mode={compactMode(agent.mode)} />
    </Link>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The voice in use: ElevenLabs with its default or a custom voice, otherwise the browser's own. */
function voiceLabel(status: Status): string {
  const id = status.voice_detail?.voice;
  if (/eleven/i.test(status.voice) || id) return `ElevenLabs · ${!id || id === "default" ? "default voice" : "custom voice"}`;
  return /browser/i.test(status.voice) ? "Browser voice" : cap(status.voice);
}

/** Debug: ?groveAmbient=3 plays the ambient creature sound every 3 seconds instead of every 18–40. */
function ambientDelayMs(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get("groveAmbient");
    const fixed = Number(raw);
    if (raw && Number.isFinite(fixed) && fixed > 0) return fixed * 1000;
  } catch {
    /* ignore */
  }
  const [lo, hi] = AMBIENT_SECONDS;
  return (lo + Math.random() * (hi - lo)) * 1000;
}

/** One line at the bottom of the sidebar; the details open in a popover. */
function StatusLine() {
  const { data: status, error } = useMossQuery<Status>("status", "/api/status");
  const stream = useStreamState();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const offline = status?.llm.mode === "offline";
  const streamLabel = stream === "live" ? "On" : stream === "connecting" ? "Connecting…" : stream === "reconnecting" ? "Reconnecting…" : "Off";
  let label = "Checking…";
  let tone = "idle";
  if (error && !status) {
    label = "Status unavailable";
    tone = "warn";
  } else if (status) {
    if (stream === "reconnecting") {
      label = "Reconnecting…";
      tone = "warn";
    } else if (offline) {
      label = "Offline mode";
      tone = "warn";
    } else {
      label = `Live · ${cap(status.llm.mode)}`;
      tone = stream === "live" ? "" : "idle";
    }
  }
  const watch = status?.watch;
  const watchErrors = Object.entries(watch?.errors ?? {});
  return (
    <>
      <button ref={ref} type="button" className="status-line" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="System status" data-testid="status-line">
        <i className={`dot ${tone}`} aria-hidden="true" />
        <span>{label}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label="System status" side="top" width={300} className="status-pop">
        <div className="pop-head">
          <h3>System status</h3>
        </div>
        {status ? (
          <dl className="kv" data-testid="status-details">
            <dt>Model</dt>
            <dd>
              {offline ? "Offline (built-in rules, no model)" : cap(status.llm.mode)}
              {status.llm.last_route ? <span className="small">Last route: {status.llm.last_route}</span> : null}
              {status.llm.last_error ? <span className="small warn-text">{status.llm.last_error}</span> : null}
            </dd>
            <dt>Graph</dt>
            <dd>
              {status.graph.backend} · {formatCount(status.graph.facts)} facts
            </dd>
            <dt>Cache</dt>
            <dd>
              {formatCount(status.cache.hits)} hits · {formatCount(status.cache.misses)} misses
            </dd>
            <dt>Voice</dt>
            <dd data-testid="voice-status">
              {voiceLabel(status)}
              {status.voice_detail?.note ? <span className="small">{status.voice_detail.note}</span> : null}
            </dd>
            <dt>Updates</dt>
            <dd>{streamLabel}</dd>
            <dt>Watcher</dt>
            <dd data-testid="watch-status">
              {watch?.enabled ? (
                <>
                  {watch.watching?.length ? watch.watching.join(", ") : "Live tools"} · every {watch.every_seconds} s
                  <span className="small">
                    {watch.runs ?? 0} runs · {watch.triggered ?? 0} triggered
                  </span>
                  {watchErrors.map(([tool, msg]) => (
                    <span key={tool} className="small warn-text">
                      {tool}: {msg}
                    </span>
                  ))}
                </>
              ) : (
                "Idle (no live tools)"
              )}
            </dd>
            <dt>Backlog</dt>
            <dd>{plural(Number(status.backlog) || 0, "item")} waiting</dd>
          </dl>
        ) : (
          <p className="pop-empty">{error ? "The status could not be loaded." : "Loading…"}</p>
        )}
      </Popover>
    </>
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
        <NavLink to="/memory" className={({ isActive }) => (isActive ? "on" : "")}>
          Memory
        </NavLink>
        {role === "manager" ? (
          <NavLink to="/canvas" className={({ isActive }) => (isActive ? "on" : "")}>
            Canvas
          </NavLink>
        ) : null}
      </nav>
      <div className="lbl">Agents</div>
      <nav className="nav agent-nav" aria-label="Agents">
        {loading && !agents.length ? <div className="small">Loading agents…</div> : null}
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} />
        ))}
      </nav>
      <StatusLine />
    </aside>
  );
}

export function Shell() {
  const theme = useTheme();
  const identity = useIdentity();
  const role = useRole();
  const agentsQuery = useAgents();
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

  // Grove music and creature sounds: both only exist while the grove is being viewed.
  const musicOn = useMusicPref() === "on";
  const soundsOn = useSfxPref() === "on";
  const [musicUnavailable, setMusicUnavailable] = useState(false);
  useEffect(() => {
    if (!showing || !soundsOn) return;
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        // quiet when the tab is hidden; `interrupt: false` never talks over a clicked creature
        if (!document.hidden) void sfx.play(SFX_NAMES[Math.floor(Math.random() * SFX_NAMES.length)], SFX_VOLUME.ambient, { interrupt: false });
        next();
      }, ambientDelayMs());
    };
    next();
    return () => {
      window.clearTimeout(timer);
      sfx.stop();
    };
  }, [showing, soundsOn]);

  useEffect(() => applyTheme(theme), [theme]);
  const motion = useMotion();
  useEffect(() => applyMotion(motion), [motion]);
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
          {showing ? (
            <>
              <button
                type="button"
                className="tog grove-opt"
                aria-pressed={musicOn && !musicUnavailable}
                aria-disabled={musicUnavailable || undefined}
                title={musicUnavailable ? "The music could not be loaded" : musicOn ? "Pause the music" : "Play music"}
                onClick={() => {
                  if (!musicUnavailable) musicPrefStore.set(musicOn ? "off" : "on");
                }}
                data-testid="music-toggle"
              >
                <span aria-hidden="true">♪</span>
                {musicUnavailable ? "Music unavailable" : musicOn ? "Music on" : "Music off"}
              </button>
              <button
                type="button"
                className="tog grove-opt"
                aria-pressed={soundsOn}
                title={soundsOn ? "Mute the creature sounds" : "Click a creature to hear it"}
                onClick={() => sfxPrefStore.set(soundsOn ? "off" : "on")}
                data-testid="sounds-toggle"
              >
                <span aria-hidden="true">{soundsOn ? "🔔" : "🔕"}</span>
                {soundsOn ? "Sounds on" : "Sounds off"}
              </button>
            </>
          ) : null}
          {theme === "dark" ? (
            <button
              type="button"
              className={`icon-btn boxed grove-toggle ${showing ? "showing" : ""}`}
              aria-pressed={showing}
              aria-label={showing ? "Back to Moss" : "View the grove"}
              title={showing ? "Bring the panels back (Esc)" : "View the grove"}
              onClick={() => setShowcase((on) => !on)}
              data-testid="grove-toggle"
            >
              <span aria-hidden="true">{showing ? "↩" : "🌿"}</span>
              {showing ? <span>Back to Moss</span> : null}
            </button>
          ) : null}
          <SettingsMenu onViewGrove={theme === "dark" ? () => setShowcase(true) : null} />
        </header>

        <div className="frame A" inert={showing}>
          <Sidebar agents={agentsQuery.agents} loading={agentsQuery.isLoading} />
          {identity.isError ? (
            <section className="main">
              <h1>Moss is not available right now</h1>
              <div className="state error" role="alert" style={{ marginTop: 14 }}>
                <div className="grow">
                  {errorMessage(identity.error)}
                  {import.meta.env.DEV ? <div className="small">API base URL: {API_URL || "same origin"}</div> : null}
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
        {theme === "dark" ? <GroveMusic active={showing} enabled={musicOn} onUnavailable={setMusicUnavailable} /> : null}
      </div>
    </AgentsProvider>
  );
}
