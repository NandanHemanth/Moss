// "/ask" — chat with one agent. Managers default to the orchestrator; employees cannot pick it.
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { CanAccess, useCustomMutation, type HttpError } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../config";
import { AgentAvatar, useAgentDirectory } from "../components/AgentAvatar";
import { Dots, Loading } from "../components/States";
import { MOSS_QUERY_KEY, useRole } from "../hooks/useMoss";
import { compactMode, modeTone } from "../lib/agents";
import { isHttpUrl, plural } from "../lib/format";
import { errorMessage } from "../providers/http";
import { useUserId } from "../session";
import type { Agent, AskResponse } from "../types";

const SUGGESTIONS = [
  "What did we discuss with Harborline last month?",
  "Show me all customers interested in payroll integration",
  "What are the open commitments and next steps for Harborline Freight?",
  "What are the risks on the provider migration?",
];

// ---------------------------------------------------------------- per-session chat store
// Threads and session ids live in module memory: they survive navigating between pages
// and are forgotten on reload ("kept for the session").
type Msg =
  | { id: number; role: "me"; text: string }
  | { id: number; role: "agent"; res: AskResponse }
  | { id: number; role: "error"; text: string };

const threads = new Map<string, Msg[]>();
const sessionIds = new Map<string, string>();
const pendingThreads = new Set<string>();
const storeListeners = new Set<() => void>();
const handledAutoAsks = new Set<string>();
let version = 0;
let nextMsgId = 1;

const bump = () => {
  version += 1;
  storeListeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  storeListeners.add(l);
  return () => {
    storeListeners.delete(l);
  };
};
const threadKey = (userId: string, agentId: string) => `${userId}:${agentId}`;
function sessionIdFor(key: string): string {
  let id = sessionIds.get(key);
  if (!id) {
    id = `${key.replace(":", "-")}-${Math.random().toString(36).slice(2, 10)}`;
    sessionIds.set(key, id);
  }
  return id;
}
function push(key: string, msg: Msg) {
  threads.set(key, [...(threads.get(key) ?? []), msg]);
  bump();
}

// ---------------------------------------------------------------- answer rendering
const BULLET = /^\s*(?:[•\-*–]|\d+[.)])\s+/;

function inline(text: string): ReactNode {
  // Only **bold** is interpreted; everything else is shown as written.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
}

/** Keeps line breaks and turns runs of "• …" / "- …" / "1. …" lines into a list. */
function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      const items = bullets;
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (BULLET.test(line)) {
      bullets.push(line.replace(BULLET, ""));
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{blocks.length ? blocks : <p className="small">(empty answer)</p>}</>;
}

function AgentMessage({ res, isManager }: { res: AskResponse; isManager: boolean }) {
  const { nameOf } = useAgentDirectory();
  const queued = res.queued_actions ?? [];
  return (
    <div className="msg" data-role="agent" data-agent={res.agent_id}>
      <Answer text={res.answer || ""} />
      {res.sources?.length ? (
        <div className="sources" aria-label="Sources">
          {res.sources.map((s, i) => {
            const body = (
              <>
                {s.agent_id ? <b>{nameOf(s.agent_id)}</b> : null}
                {s.agent_id ? " · " : ""}
                {s.label}
              </>
            );
            return isHttpUrl(s.url) ? (
              <a key={i} className="chip" href={s.url} target="_blank" rel="noreferrer">
                {body} ↗
              </a>
            ) : (
              <span key={i} className="chip">
                {body}
              </span>
            );
          })}
        </div>
      ) : null}
      {queued.length ? (
        <div className="queued" role="status">
          <span className="chip w">Queued for manager approval · {plural(queued.length, "action")}</span>{" "}
          <Link to="/">{isManager ? "Review in the Clearing" : "See it in My work"}</Link>
        </div>
      ) : null}
      <div className="trace small">
        <span className="route" title="Which model route answered">
          {res.route || "unknown route"}
        </span>
        {res.trace?.length ? <span title="Tools the agent used"> · tools: {res.trace.join(", ")}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
function PickerButton({ agent, selected, onPick }: { agent: Agent; selected: boolean; onPick: () => void }) {
  const locked = (
    <button type="button" className="pick" disabled title={`${agent.name} answers to managers only`} data-agent={agent.id} data-locked="true">
      <AgentAvatar id={agent.id} />
      <span>{agent.name}</span>
      <span className="lock">Manager</span>
    </button>
  );
  if (!agent.allowed) return locked;
  return (
    <CanAccess resource="agents" action="ask" params={{ id: agent.id, manager_only: agent.manager_only }} fallback={locked}>
      <button type="button" className="pick" aria-pressed={selected} onClick={onPick} title={`${agent.epithet} · ${agent.tool}`} data-agent={agent.id}>
        <AgentAvatar id={agent.id} />
        <span>{agent.name}</span>
      </button>
    </CanAccess>
  );
}

export function AskPage() {
  const userId = useUserId();
  const role = useRole();
  const isManager = role === "manager";
  const { agents, byId, isLoading: agentsLoading } = useAgentDirectory();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { mutateAsync } = useCustomMutation<AskResponse, HttpError, { agent_id: string; message: string; session_id: string }>();
  useSyncExternalStore(subscribe, () => version);

  const usable = useMemo(() => agents.filter((a) => a.allowed && (isManager || !a.manager_only)), [agents, isManager]);
  const requested = params.get("agent");
  const fallback = (isManager ? usable.find((a) => a.manager_only) : undefined) ?? usable[0];
  const agent = usable.find((a) => a.id === requested) ?? fallback;
  const requestedLocked = !!requested && !!byId.get(requested) && !usable.some((a) => a.id === requested);

  const key = agent ? threadKey(userId, agent.id) : "";
  const thread = (key && threads.get(key)) || [];
  const busy = !!key && pendingThreads.has(key);

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (target: Agent, text: string) => {
    const message = text.trim();
    const k = threadKey(userId, target.id);
    if (!message || pendingThreads.has(k)) return;
    push(k, { id: nextMsgId++, role: "me", text: message });
    pendingThreads.add(k);
    bump();
    try {
      const res = await mutateAsync({
        url: api("/api/ask"),
        method: "post",
        values: { agent_id: target.id, message, session_id: sessionIdFor(k) },
      });
      push(k, { id: nextMsgId++, role: "agent", res: res.data });
    } catch (e) {
      const status = (e as HttpError)?.statusCode;
      push(k, { id: nextMsgId++, role: "error", text: `${status ? `${status} · ` : ""}${errorMessage(e, "The agent could not answer.")}` });
    } finally {
      pendingThreads.delete(k);
      bump();
      void queryClient.invalidateQueries({ queryKey: [MOSS_QUERY_KEY, "status"] });
    }
  };

  // A question handed over in the URL (?q=…) is asked once, then removed from the URL.
  // If it was addressed to an agent this user may not call, it is NOT re-routed to another agent:
  // it is left in the input as a draft instead.
  const q = params.get("q");
  useEffect(() => {
    if (!q || !agent) return;
    const once = `${location.key}|${agent.id}|${q}`;
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
    if (handledAutoAsks.has(once)) return;
    handledAutoAsks.add(once);
    if (requestedLocked) setDraft(q);
    else void ask(agent, q);
  }, [q, agent?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length, busy]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [agent?.id]);

  const pick = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("agent", id);
    next.delete("q");
    setParams(next, { replace: true });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!agent || busy || !draft.trim()) return;
    const text = draft;
    setDraft("");
    void ask(agent, text);
  };

  if (agentsLoading && !agents.length) {
    return (
      <section className="main" data-page="ask">
        <Loading label="Finding the agents…" />
      </section>
    );
  }

  return (
    <>
      <section className="main ask-page" data-page="ask">
        <div className="row">
          {agent ? <AgentAvatar id={agent.id} size="lg" /> : null}
          <div className="grow">
            <h1>{agent ? `Ask ${agent.name}` : "Ask"}</h1>
            <div className="small">
              {agent ? `${agent.epithet} · ${agent.tool}${agent.manager_only ? " · can call every agent" : isManager ? "" : " · employees talk to one agent at a time"}` : "No agent is available to you."}
            </div>
          </div>
        </div>

        <div className="picker" role="group" aria-label="Choose an agent">
          {agents.map((a) => (
            <PickerButton key={a.id} agent={a} selected={a.id === agent?.id} onPick={() => pick(a.id)} />
          ))}
        </div>
        {requestedLocked ? (
          <div className="state error" role="alert">
            {byId.get(requested!)?.name} answers to managers only. {agent ? `You are talking to ${agent.name} instead.` : ""}
          </div>
        ) : null}

        <div className="chat" data-section="thread" aria-live="polite">
          {thread.length === 0 && !busy && agent ? (
            <div className="card suggestions">
              <h3>Try asking {agent.name}</h3>
              <div style={{ marginTop: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip suggestion" onClick={() => void ask(agent, s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {thread.map((m) =>
            m.role === "me" ? (
              <div key={m.id} className="msg me" data-role="me">
                {m.text}
              </div>
            ) : m.role === "agent" ? (
              <AgentMessage key={m.id} res={m.res} isManager={isManager} />
            ) : (
              <div key={m.id} className="msg err" role="alert" data-role="error">
                {m.text}
              </div>
            ),
          )}
          {busy && agent ? (
            <div className="msg thinking" role="status" data-role="loading">
              {agent.name} is thinking <Dots />
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form className="ask composer" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={agent ? `Message ${agent.name}…` : "No agent available"}
            aria-label={agent ? `Message ${agent.name}` : "Message"}
            disabled={!agent}
          />
          <button className="btn p" type="submit" disabled={!agent || busy || !draft.trim()}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </form>
      </section>

      <aside className="rail" aria-label="About this agent">
        {agent ? (
          <>
            <h3>{agent.epithet}</h3>
            <p className="small" style={{ margin: "6px 0 10px" }}>
              {agent.description}
            </p>
            <span className="chip">{agent.tool}</span>
            <span className={`tag ${modeTone(agent.mode)}`} style={{ marginLeft: 0 }}>
              {compactMode(agent.mode)}
            </span>
          </>
        ) : null}
        <div className="lbl">Suggested questions</div>
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="acct suggestion-row" disabled={!agent || busy} onClick={() => agent && void ask(agent, s)}>
            {s}
          </button>
        ))}
        {!isManager ? (
          <>
            <div className="lbl">Good to know</div>
            <div className="small">
              {agents.find((a) => a.manager_only)?.name ?? "The orchestrator"} is available to managers only. Anything an agent wants to change (a ticket, a message, an invite) is queued for
              your manager's approval first.
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
