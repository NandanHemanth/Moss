// "/" — the Clearing for managers, "My work" for employees.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useCustomMutation, useInvalidate, type HttpError } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../config";
import { AgentAvatar, useAgentDirectory } from "../components/AgentAvatar";
import { CommitmentsTable } from "../components/CommitmentsTable";
import { DashboardTiles } from "../components/Dashboard";
import { ProposalCard } from "../components/ProposalCard";
import { Empty, ErrorNote, Loading } from "../components/States";
import { Whispers } from "../components/Whispers";
import { TOOL_AGENT } from "../lib/agents";
import { MOSS_QUERY_KEY, useAllowed, useIdentity, useMossList, useMossQuery, useRole } from "../hooks/useMoss";
import { firstName, formatDay, formatTime, greeting, isToday, parseDate, plural } from "../lib/format";
import { errorMessage } from "../providers/http";
import type { DemoQueueItem, MeetingEndedResult, MossEvent, Proposal, Status, SyncResult, User } from "../types";

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

// ------------------------------------------------------------------ shared
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
        placeholder={`Ask ${orchestrator?.name ?? "Moss"}… e.g. “What is open for Harborline Freight?”`}
        aria-label={`Ask ${orchestrator?.name ?? "Moss"}`}
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
    <div className="sync-report grow" role="status" data-testid="sync-report">
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

/** "Simulate a meeting" and "Sync": two quiet buttons in the section header; the result shows as one dismissible line. */
function useDecisionTools() {
  const canDemo = useAllowed("demo", "trigger");
  const canSync = useAllowed("sync", "run");
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const queue = useMossQuery<DemoQueueItem[]>("demo-queue", "/api/demo/queue", { enabled: canDemo });
  // same query key as the sidebar status line, so this shares its request and its refreshes
  const status = useMossQuery<Status>("status", "/api/status", { enabled: canSync });
  const backlog = Number(status.data?.backlog) || 0;
  const { mutateAsync: postMeeting } = useCustomMutation<MeetingEndedResult, HttpError, Record<string, never>>();
  const { mutateAsync: postSync } = useCustomMutation<SyncResult, HttpError, Record<string, never>>();
  const [busy, setBusy] = useState<"meeting" | "sync" | null>(null);
  const [note, setNote] = useState<DemoNote | null>(null);

  const next = queue.data?.[0];
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

  const meetingTitle = queue.isLoading
    ? "Checking for sample meetings…"
    : queue.error
      ? errorMessage(queue.error)
      : next
        ? `Plays the next sample meeting: “${next.title}”`
        : "No sample meetings left to play";

  const buttons =
    canDemo || canSync ? (
      <div className="section-tools" data-section="demo">
        {canDemo ? (
          <span title={meetingTitle}>
            <button className="btn" onClick={meetingEnded} disabled={!next || busy !== null} data-testid="meeting-ended">
              {busy === "meeting" ? "Reading the transcript…" : "Simulate a meeting"}
            </button>
          </span>
        ) : null}
        {canSync ? (
          <button className="btn" onClick={sync} disabled={busy !== null} title="Pull new items from the connected tools" data-testid="sync">
            {busy === "sync" ? "Syncing…" : backlog > 0 ? `Sync (${backlog} waiting)` : "Sync"}
          </button>
        ) : null}
      </div>
    ) : null;

  const result = note ? (
    <div className={`notice ${note.tone === "fail" ? "fail" : ""}`} data-testid="demo-note">
      {note.tone === "sync" ? (
        <SyncReport text={note.text} problems={note.problems} />
      ) : (
        <div className="grow" role="status">
          {note.text}
        </div>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNote(null)}>
        ×
      </button>
    </div>
  ) : null;

  return { buttons, result };
}

function ManagerClearing() {
  const proposals = useMossList<Proposal>("proposals", { status: "all" });
  const users = useMossList<User>("users");
  const tools = useDecisionTools();
  const [showDecided, setShowDecided] = useState(false);
  const pending = proposals.data.filter((p) => p.status === "pending");
  const done = proposals.data.filter((p) => p.status !== "pending").slice(0, 4);
  const pendingActions = pending.reduce((n, p) => n + p.actions.filter((a) => a.status === "pending").length, 0);

  return (
    <>
      <section className="main" data-page="clearing">
        <Greeting />
        <AskBar />
        <DashboardTiles />

        <div className="section-head">
          <h2 data-testid="needs-decision-label">
            Needs your decision
            {pending.length ? <span className="count">{plural(pendingActions, "action")}</span> : null}
          </h2>
          {tools.buttons}
        </div>
        {tools.result}
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
              <Empty title="Nothing is waiting for you">Proposed next steps appear here after a meeting.</Empty>
            </div>
          ) : (
            pending.map((p) => <ProposalCard key={p.id} proposal={p} users={users.data} />)
          )}
        </div>

        <CommitmentsTable title="Open commitments" showOwner />

        {done.length ? (
          <>
            <div className="section-head">
              <h2>
                <button type="button" className="disclosure" aria-expanded={showDecided} aria-controls="recently-decided" onClick={() => setShowDecided((v) => !v)} data-testid="toggle-decided">
                  <span className="caret" aria-hidden="true" />
                  Recently decided
                  <span className="count">{done.length}</span>
                </button>
              </h2>
            </div>
            {showDecided ? (
              <div id="recently-decided" data-section="decided">
                {done.map((p) => (
                  <ProposalCard key={p.id} proposal={p} users={users.data} />
                ))}
              </div>
            ) : null}
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
function MyDay() {
  const { data, isLoading, error, refetch } = useMossList<MossEvent>("timeline", { source: "calendar" });

  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const today = data.filter((e) => isToday(e.occurred_at)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const upcoming = data
    .filter((e) => !isToday(e.occurred_at) && (parseDate(e.occurred_at) ?? startOfToday) > startOfToday)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .slice(0, 3);

  const item = (e: MossEvent, withDay: boolean) => (
    <div className="wh" key={e.id}>
      {withDay ? `${formatDay(e.occurred_at)} ` : ""}
      {formatTime(e.occurred_at)} · {e.title}
      <span className="meta">{[e.account, e.participants?.length ? plural(e.participants.length, "person", "people") : null].filter(Boolean).join(" · ") || e.summary}</span>
    </div>
  );

  return (
    <>
      <h3 className="rail-title">My day</h3>
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
        <AskBar />
        <DashboardTiles />

        <CommitmentsTable title="My commitments" showOwner={false} />

        <div className="section-head">
          <h2>From your meetings</h2>
        </div>
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
              <Empty title="Nothing proposed yet">Next steps from your meetings appear here.</Empty>
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
