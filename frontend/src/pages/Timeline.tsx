// "/timeline" — everything from every tool in date order, filterable by account and source.
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { AgentAvatar, useAgentDirectory } from "../components/AgentAvatar";
import { Empty, ErrorNote, Loading } from "../components/States";
import { useMossList, useMossQuery, useRole } from "../hooks/useMoss";
import { dayKey, formatDay, formatDue, formatTime, isHttpUrl, parseDate, plural } from "../lib/format";
import type { Account, Commitment, MossEvent, Status } from "../types";

const FALLBACK_SOURCES = ["meeting", "gmail", "calendar", "slack", "jira", "confluence"];

function AccountPanel({ account }: { account: Account }) {
  const commitments = useMossList<Commitment>("commitments", { status: "open", account: account.name });
  return (
    <div data-section="account-panel">
      <h3>{account.name}</h3>
      <div style={{ margin: "6px 0 8px" }}>
        <span className="chip">{account.kind}</span>
        <span className="chip">{plural(account.events, "event")}</span>
        <span className={`chip ${account.open_commitments ? "w" : ""}`}>{plural(account.open_commitments, "open commitment")}</span>
      </div>
      <p className="small" style={{ margin: "0 0 10px" }}>
        {account.summary}
      </p>
      <div className="lbl">Open commitments</div>
      {commitments.isLoading ? (
        <Loading label="Loading…" />
      ) : commitments.error ? (
        <ErrorNote error={commitments.error} onRetry={() => commitments.refetch()} />
      ) : commitments.data.length === 0 ? (
        <div className="small">None that you can see.</div>
      ) : (
        commitments.data.map((c) => {
          const due = formatDue(c.due);
          return (
            <div className="wh" key={c.id}>
              {c.text}
              <span className="meta">
                {c.owner || "Unassigned"}
                {c.due ? (
                  <>
                    {" · "}
                    <span style={{ color: due.overdue ? "var(--warn)" : undefined }}>due {due.label}</span>
                  </>
                ) : null}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

export function TimelinePage() {
  const role = useRole();
  const { nameOf } = useAgentDirectory();
  const [params, setParams] = useSearchParams();
  const accountId = params.get("account") ?? "";
  const source = params.get("source") ?? "";

  const accounts = useMossList<Account>("accounts");
  const status = useMossQuery<Status>("status", "/api/status");
  const account = accounts.data.find((a) => a.id === accountId);
  // The API filters by account *name*; wait for the accounts list before filtering by it.
  const waitingForAccount = !!accountId && !account && accounts.isLoading;
  const timeline = useMossList<MossEvent>("timeline", { account: account?.name, source: source || undefined, limit: 120 }, { enabled: !waitingForAccount });

  const sources = useMemo(() => {
    const fromStatus = status.data ? Object.keys(status.data.connectors) : [];
    const order = (s: string) => (FALLBACK_SOURCES.includes(s) ? FALLBACK_SOURCES.indexOf(s) : 99);
    return Array.from(new Set([...(fromStatus.length ? fromStatus : FALLBACK_SOURCES), ...(source ? [source] : [])])).sort((a, b) => order(a) - order(b));
  }, [status.data, source]);

  const days = useMemo(() => {
    const groups = new Map<string, { date: Date; items: MossEvent[] }>();
    for (const e of timeline.data) {
      const d = parseDate(e.occurred_at) ?? new Date(0);
      const k = dayKey(d);
      if (!groups.has(k)) groups.set(k, { date: d, items: [] });
      groups.get(k)!.items.push(e);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([key, g]) => ({ key, label: formatDay(g.date), items: g.items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) }));
  }, [timeline.data]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const kinds = Array.from(new Set(accounts.data.map((a) => a.kind)));

  return (
    <>
      <section className="main" data-page="timeline">
        <h1>{account ? account.name : "Timeline"}</h1>
        <div className="small">
          {role === "manager" ? "Everything, every tool" : "Items you are part of"} · {timeline.isLoading ? "loading…" : plural(timeline.data.length, "item")}
        </div>

        <div className="filters">
          <label>
            <span className="small">Account</span>
            <select className="field" value={account ? account.id : ""} onChange={(e) => update({ account: e.target.value })} aria-label="Filter by account">
              <option value="">All accounts and projects</option>
              {kinds.map((kind) => (
                <optgroup key={kind} label={`${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`}>
                  {accounts.data
                    .filter((a) => a.kind === kind)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div>
            <span className="small" id="source-filter-label">
              Source
            </span>
            <div className="seg wrap" role="group" aria-labelledby="source-filter-label">
              <button type="button" aria-pressed={!source} onClick={() => update({ source: "" })}>
                All
              </button>
              {sources.map((s) => (
                <button key={s} type="button" aria-pressed={source === s} onClick={() => update({ source: s })} data-source={s}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {timeline.isLoading || waitingForAccount ? (
          <Loading label="Walking the trail…" />
        ) : timeline.error ? (
          <ErrorNote error={timeline.error} onRetry={() => timeline.refetch()} />
        ) : days.length === 0 ? (
          <div className="card" style={{ marginTop: 14 }}>
            <Empty title="Nothing here yet">
              No items match these filters.{" "}
              {accountId || source ? (
                <button className="linkish" onClick={() => update({ account: "", source: "" })}>
                  Clear filters
                </button>
              ) : null}
            </Empty>
          </div>
        ) : (
          <div className="tl" data-section="timeline">
            {days.map((day) => (
              <div key={day.key} data-day={day.key}>
                <p className="day">{day.label}</p>
                {day.items.map((e) => (
                  <div className="ev" key={e.id} data-event={e.id}>
                    <div className="card">
                      <div className="row top">
                        <AgentAvatar id={e.agent_id} />
                        <div className="grow">
                          <div className="row wrap" style={{ gap: 6 }}>
                            <b className="grow">
                              {isHttpUrl(e.url) ? (
                                <a href={e.url} target="_blank" rel="noreferrer">
                                  {e.title}
                                </a>
                              ) : (
                                e.title
                              )}
                            </b>
                            <span className="small" style={{ whiteSpace: "nowrap" }}>
                              {nameOf(e.agent_id)} · {e.source} · {formatTime(e.occurred_at)}
                            </span>
                          </div>
                          {e.summary ? <div className="small ev-summary">{e.summary}</div> : null}
                          <div style={{ marginTop: 6 }}>
                            {e.account ? <span className="chip">{e.account}</span> : null}
                            {e.participants?.length ? (
                              <span className="small" title={e.participants.join(", ")}>
                                {e.participants.slice(0, 5).join(", ")}
                                {e.participants.length > 5 ? ` +${e.participants.length - 5}` : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="rail" aria-label="Account details">
        {account ? (
          <>
            <AccountPanel account={account} />
            <div className="lbl">Switch account</div>
          </>
        ) : (
          <>
            <h3>What we know</h3>
            <p className="small" style={{ margin: "6px 0 10px" }}>
              Pick a customer or project to see its summary and open commitments.
            </p>
          </>
        )}
        {accounts.isLoading ? (
          <Loading label="Loading accounts…" />
        ) : accounts.error ? (
          <ErrorNote error={accounts.error} onRetry={() => accounts.refetch()} />
        ) : accounts.data.length === 0 ? (
          <div className="small">No accounts yet.</div>
        ) : (
          <>
            {account ? (
              <button type="button" className="acct" onClick={() => update({ account: "" })}>
                All accounts and projects
              </button>
            ) : null}
            {accounts.data.map((a) => (
              <button type="button" key={a.id} className={`acct ${a.id === account?.id ? "on" : ""}`} onClick={() => update({ account: a.id })} data-account={a.id}>
                <span className="grow">{a.name}</span>
                {a.open_commitments ? (
                  <span className="tag" title={plural(a.open_commitments, "open commitment")}>
                    {a.open_commitments} open
                  </span>
                ) : null}
              </button>
            ))}
          </>
        )}
      </aside>
    </>
  );
}
