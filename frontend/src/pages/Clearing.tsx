// "/" — the Clearing for managers, "My work" for employees.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCustomMutation, useInvalidate, type HttpError } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../config";
import { AgentAvatar, useAgentDirectory } from "../components/AgentAvatar";
import { CommitmentsTable } from "../components/CommitmentsTable";
import { ProposalCard } from "../components/ProposalCard";
import { Empty, ErrorNote, Loading } from "../components/States";
import { Whispers } from "../components/Whispers";
import { TOOL_AGENT } from "../lib/agents";
import { MOSS_QUERY_KEY, useAllowed, useIdentity, useMossList, useMossQuery, useRole } from "../hooks/useMoss";
import { firstName, formatDay, formatTime, greeting, isToday, parseDate, plural } from "../lib/format";
import { errorMessage } from "../providers/http";
import type { DemoQueueItem, MeetingEndedResult, MossEvent, Proposal, SyncResult, User } from "../types";

export function ClearingPage() {
  const role = useRole();
  return role === "manager" ? <ManagerClearing /> : <EmployeeWork />;
}

function Greeting() {
  const { data: me } = useIdentity();
  return (
    <h1>
      {greeting()}
      {me ? `, ${firstName(me.name)}` : ""}
    </h1>
  );
}

// ------------------------------------------------------------------ manager
function AskBar() {
  const navigate = useNavigate();
  const { agents } = useAgentDirectory();
  const orchestrator = agents.find((a) => a.manager_only && a.allowed) ?? agents.find((a) => a.allowed);
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    const params = new URLSearchParams();
    if (orchestrator) params.set("agent", orchestrator.id);
    if (text) params.set("q", text);
    navigate(`/ask?${params.toString()}`);
  };
  return (
    <form className="ask" onSubmit={submit} role="search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Ask ${orchestrator?.name ?? "the orchestrator"}… “What are the open commitments for Harborline Freight?”`}
        aria-label={`Ask ${orchestrator?.name ?? "the orchestrator"}`}
      />
      <button className="btn p" type="submit">
        Ask
      </button>
    </form>
  );
}

type SyncProblem = { tool: string; message: string; hint: string | null };
type DemoNote = { tone: "ok" | "fail"; text: string } | { tone: "sync"; text: string; problems: SyncProblem[] };

/** Result of a sync: a neutral summary line, then one row per tool that had a problem. */
function SyncReport({ text, problems }: { text: string; problems: SyncProblem[] }) {
  const { byId } = useAgentDirectory();
  return (
    <div className="demo-note sync-report" role="status" data-testid="sync-report">
      <div className="sync-summary">{text}</div>
      {problems.length ? (
        <ul className="sync-problems" aria-label="Sync problems">
          {problems.map((p) => {
            const agentId = TOOL_AGENT[p.tool];
            const agentName = agentId ? byId.get(agentId)?.name : undefined;
            return (
              <li key={p.tool} data-tool={p.tool}>
                {agentId && agentName ? <AgentAvatar id={agentId} /> : <span className="dot warn" aria-hidden="true" />}
                <div className="grow">
                  <div>
                    <b>{agentName ?? p.tool}</b>
                    {agentName ? <span className="small"> · {p.tool}</span> : null}
                    <span className="sync-msg"> {p.message}</span>
                  </div>
                  {p.hint ? <div className="small sync-hint">{p.hint}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function DemoControls() {
  const canDemo = useAllowed("demo", "trigger");
  const canSync = useAllowed("sync", "run");
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const queue = useMossQuery<DemoQueueItem[]>("demo-queue", "/api/demo/queue", { enabled: canDemo });
  const { mutateAsync: postMeeting } = useCustomMutation<MeetingEndedResult, HttpError, Record<string, never>>();
  const { mutateAsync: postSync } = useCustomMutation<SyncResult, HttpError, Record<string, never>>();
  const [busy, setBusy] = useState<"meeting" | "sync" | null>(null);
  const [note, setNote] = useState<DemoNote | null>(null);

  if (!canDemo && !canSync) return null;

  const next = queue.data?.[0];
  const left = queue.data?.length ?? 0;
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: [MOSS_QUERY_KEY] }, { cancelRefetch: false });
    (["proposals", "commitments", "timeline", "notifications", "accounts"] as const).forEach((resource) => void invalidate({ resource, invalidates: ["list"] }));
  };

  const meetingEnded = async () => {
    setBusy("meeting");
    setNote(null);
    try {
      const res = await postMeeting({ url: api("/api/demo/meeting-ended"), method: "post", values: {} });
      const r = res.data;
      setNote({
        tone: "ok",
        text: `“${next?.title ?? r.event_id}” was processed: ${plural(r.insights ?? 0, "insight")} found${r.proposal_id ? ", actions are waiting below." : ", nothing to approve."}`,
      });
    } catch (e) {
      setNote({ tone: "fail", text: errorMessage(e, "The meeting could not be processed.") });
    } finally {
      setBusy(null);
      refreshAll();
    }
  };

  const sync = async () => {
    setBusy("sync");
    setNote(null);
    try {
      const res = await postSync({ url: api("/api/sync"), method: "post", values: {} });
      const r = res.data;
      const understood = Array.isArray(r.processed) ? r.processed.length : 0;
      const deferred = r.deferred ?? 0;
      const hints = r.hints ?? {};
      const problems = Object.entries(r.errors ?? {}).map(([tool, message]) => ({
        tool,
        message: String(message ?? "").trim() || "Something went wrong.",
        hint: hints[tool] ? String(hints[tool]) : null,
      }));
      setNote({
        tone: "sync",
        text:
          `Sync finished: ${r.new ?? 0} new, ${understood} understood` +
          (deferred > 0 ? `, ${deferred} still waiting — click Sync again to continue` : "."),
        problems,
      });
    } catch (e) {
      setNote({ tone: "fail", text: errorMessage(e, "Sync failed.") });
    } finally {
      setBusy(null);
      refreshAll();
    }
  };

  return (
    <div className="demo" data-section="demo">
      <div className="row wrap">
        <span className="demo-badge">Demo</span>
        <div className="grow" style={{ minWidth: 180 }}>
          {queue.isLoading ? (
            <span className="small">Checking seeded meetings…</span>
          ) : queue.error ? (
            <span className="small">Could not load the demo queue: {errorMessage(queue.error)}</span>
          ) : next ? (
            <>
              <b>Next seeded meeting:</b> {next.title}
              <div className="small">{left > 1 ? `${left} meetings left in the queue` : "Last one in the queue"}</div>
            </>
          ) : (
            <>
              <b>No seeded meetings left</b>
              <div className="small">Re-run the seeder to reset the demo.</div>
            </>
          )}
        </div>
        <button className="btn p big" onClick={meetingEnded} disabled={!next || busy !== null} data-testid="meeting-ended">
          {busy === "meeting" ? "Reading the transcript…" : "A meeting just ended"}
        </button>
        <button className="btn big" onClick={sync} disabled={busy !== null} title="Pull new items from the live connectors" data-testid="sync">
          {busy === "sync" ? "Syncing…" : "Sync"}
        </button>
      </div>
      {note?.tone === "sync" ? (
        <SyncReport text={note.text} problems={note.problems} />
      ) : note ? (
        <div className={`small demo-note ${note.tone}`} role="status">
          {note.text}
        </div>
      ) : null}
    </div>
  );
}

function ManagerClearing() {
  const proposals = useMossList<Proposal>("proposals", { status: "all" });
  const users = useMossList<User>("users");
  const pending = proposals.data.filter((p) => p.status === "pending");
  const done = proposals.data.filter((p) => p.status !== "pending").slice(0, 4);
  const pendingActions = pending.reduce((n, p) => n + p.actions.filter((a) => a.status === "pending").length, 0);

  return (
    <>
      <section className="main" data-page="clearing">
        <Greeting />
        <AskBar />
        <DemoControls />

        <div className="lbl first" data-testid="needs-decision-label">
          Needs your decision{pending.length ? ` · ${plural(pending.length, "item")}, ${plural(pendingActions, "action")}` : ""}
        </div>
        <div data-section="pending">
          {proposals.isLoading ? (
            <div className="card">
              <Loading label="Looking for proposals…" />
            </div>
          ) : proposals.error ? (
            <div className="card">
              <ErrorNote error={proposals.error} onRetry={() => proposals.refetch()} />
            </div>
          ) : pending.length === 0 ? (
            <div className="card">
              <Empty title="The clearing is calm">Nothing is waiting for your decision. When a meeting ends, proposed next steps appear here.</Empty>
            </div>
          ) : (
            pending.map((p) => <ProposalCard key={p.id} proposal={p} users={users.data} />)
          )}
        </div>

        <CommitmentsTable title="Open commitments" showOwner />

        {done.length ? (
          <>
            <div className="lbl">Recently decided</div>
            <div data-section="decided">
              {done.map((p) => (
                <ProposalCard key={p.id} proposal={p} users={users.data} />
              ))}
            </div>
          </>
        ) : null}
      </section>
      <aside className="rail" aria-label="Whispers">
        <Whispers />
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ employee
function AgentTiles() {
  const { agents, isLoading } = useAgentDirectory();
  const callable = agents.filter((a) => a.allowed && !a.manager_only);
  if (isLoading && !agents.length) return <Loading label="Finding the agents…" />;
  if (!callable.length) return <Empty title="No agents available" />;
  return (
    <div className="grid5" data-section="agent-tiles">
      {callable.map((a) => (
        <Link key={a.id} className="tile" to={`/ask?agent=${encodeURIComponent(a.id)}`} data-agent={a.id}>
          <div className="row">
            <AgentAvatar id={a.id} />
            <b>{a.name}</b>
          </div>
          <p>{a.tool}</p>
          <p>{a.description}</p>
        </Link>
      ))}
    </div>
  );
}

function MyDay() {
  const { data, isLoading, error, refetch } = useMossList<MossEvent>("timeline", { source: "calendar" });
  const { agents, nameOf } = useAgentDirectory();
  const orchestrator = agents.find((a) => a.manager_only);
  const calendarAgent = data[0]?.agent_id;

  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const today = data.filter((e) => isToday(e.occurred_at)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const upcoming = data
    .filter((e) => !isToday(e.occurred_at) && (parseDate(e.occurred_at) ?? startOfToday) > startOfToday)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .slice(0, 4);

  const item = (e: MossEvent, withDay: boolean) => (
    <div className="wh" key={e.id}>
      {withDay ? `${formatDay(e.occurred_at)} ` : ""}
      {formatTime(e.occurred_at)} · {e.title}
      <span className="meta">{[e.account, e.participants?.length ? plural(e.participants.length, "person", "people") : null].filter(Boolean).join(" · ") || e.summary}</span>
    </div>
  );

  return (
    <>
      <h3>My day</h3>
      <div className="small">{calendarAgent ? `From ${nameOf(calendarAgent)}` : "From your calendar"}</div>
      {isLoading ? (
        <Loading label="Checking the calendar…" />
      ) : error ? (
        <ErrorNote error={error} onRetry={() => refetch()} />
      ) : today.length === 0 && upcoming.length === 0 ? (
        <Empty title="Nothing on the calendar today" />
      ) : (
        <div data-section="my-day">
          {today.length === 0 ? <div className="wh small">Nothing on the calendar today.</div> : today.map((e) => item(e, false))}
          {upcoming.length ? <div className="lbl">Coming up</div> : null}
          {upcoming.map((e) => item(e, true))}
        </div>
      )}
      <div className="lbl">Ask {orchestrator?.name ?? "the orchestrator"}</div>
      <div className="small">{orchestrator?.name ?? "The orchestrator"} is available to managers only. You can ask any single agent directly.</div>
    </>
  );
}

function EmployeeWork() {
  const proposals = useMossList<Proposal>("proposals", { status: "all" });
  const users = useMossList<User>("users");
  return (
    <>
      <section className="main" data-page="my-work">
        <Greeting />
        <div className="lbl">Call an agent</div>
        <AgentTiles />

        <CommitmentsTable title="My commitments" showOwner={false} />

        <div className="lbl">From your meetings</div>
        <div data-section="from-meetings">
          {proposals.isLoading ? (
            <div className="card">
              <Loading label="Looking for proposals…" />
            </div>
          ) : proposals.error ? (
            <div className="card">
              <ErrorNote error={proposals.error} onRetry={() => proposals.refetch()} />
            </div>
          ) : proposals.data.length === 0 ? (
            <div className="card">
              <Empty title="Nothing proposed yet">When one of your meetings ends, the next steps Moss proposes show up here.</Empty>
            </div>
          ) : (
            proposals.data.map((p) => <ProposalCard key={p.id} proposal={p} users={users.data} />)
          )}
        </div>
      </section>
      <aside className="rail" aria-label="My day">
        <MyDay />
      </aside>
    </>
  );
}
