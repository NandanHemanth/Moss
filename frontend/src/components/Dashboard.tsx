// The row of five tiles under the Ask bar. Numbers come from GET /api/dashboard (instant); the suggested
// tasks and the stakeholder summary come from GET /api/dashboard/brief, which can take seconds and is
// loaded on its own so it never holds the page back. Each tile opens a small detail popover.
import { useRef, useState, type ReactNode } from "react";
import { useMossQuery, useRole } from "../hooks/useMoss";
import { formatCompact, formatDue, formatMoney, plural } from "../lib/format";
import { errorMessage } from "../providers/http";
import type { DashBrief, DashCloud, DashRisks, DashTokens, Dashboard, EmployeeDashboard, ManagerDashboard, TileSource } from "../types";
import { BudgetBar, Burndown, MiniBars, Sparkline } from "./Charts";
import { Popover } from "./Popover";

type BriefState = { data: DashBrief | undefined; loading: boolean; error: unknown };

// ---------------------------------------------------------------- tile shell
function Tile({
  id,
  label,
  source,
  sampleNote,
  wide = false,
  children,
  detail,
  detailWidth = 360,
}: {
  id: string;
  label: string;
  source?: TileSource;
  sampleNote?: string;
  wide?: boolean;
  children: ReactNode;
  detail: ReactNode;
  detailWidth?: number;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const sample = source === "sample";
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`dash-tile ${wide ? "wide" : ""}`}
        data-tile={id}
        data-source={source}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dash-head">
          <span className="dash-label">{label}</span>
          {sample ? (
            <span className="sample-tag" title={sampleNote} aria-label={`Sample data. ${sampleNote ?? ""}`} data-testid="sample-tag">
              sample
            </span>
          ) : null}
        </span>
        {children}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={`${label} details`} width={detailWidth} className="dash-detail">
        <div className="pop-head">
          <h3>{label}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        {detail}
        {sample && sampleNote ? <p className="pop-note">{sampleNote}</p> : null}
      </Popover>
    </>
  );
}

const Headline = ({ value, unit, warn = false }: { value: ReactNode; unit?: string; warn?: boolean }) => (
  <span className={`dash-num ${warn ? "warn" : ""}`}>
    {value}
    {unit ? <small> {unit}</small> : null}
  </span>
);
const Support = ({ children, warn = false }: { children: ReactNode; warn?: boolean }) => <span className={`dash-sub ${warn ? "warn" : ""}`}>{children}</span>;
const Skeleton = ({ lines = 3 }: { lines?: number }) => (
  <span className="skeleton" role="status" aria-label="Loading" data-testid="brief-skeleton">
    {Array.from({ length: lines }, (_, i) => (
      <i key={i} />
    ))}
  </span>
);
const Stat = ({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) => (
  <div className="stat">
    <b className={warn ? "warn" : ""}>{value}</b>
    <span>{label}</span>
  </div>
);

// ---------------------------------------------------------------- shared tiles
function TokensTile({ tokens, label, note }: { tokens: DashTokens; label: string; note: string }) {
  const people = tokens.by_person;
  const top = Math.max(...(people ?? []).map((p) => p.tokens), 1);
  return (
    <Tile
      id="tokens"
      label={label}
      source={tokens.source}
      sampleNote={note}
      detail={
        <>
          <div className="stats">
            <Stat label="total" value={formatCompact(tokens.total)} />
            <Stat label="today" value={formatCompact(tokens.today)} />
            <Stat label={tokens.calls === 1 ? "model call" : "model calls"} value={formatCompact(tokens.calls)} />
          </div>
          <div className="pop-key">Last 7 days</div>
          <Sparkline values={tokens.series} title={`Tokens per day over the last 7 days: ${tokens.series.join(", ")}`} height={44} />
          {people ? (
            <>
              <div className="pop-key">By person</div>
              {people.length ? (
                <ul className="meter-list">
                  {people.map((p) => (
                    <li key={p.name}>
                      <span>{p.name}</span>
                      <i style={{ ["--w" as string]: `${(p.tokens / top) * 100}%` }} />
                      <b>{formatCompact(p.tokens)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pop-empty">No model usage yet.</p>
              )}
            </>
          ) : null}
        </>
      }
    >
      <Headline value={formatCompact(tokens.total)} />
      <Sparkline values={tokens.series} title={`Tokens per day over the last 7 days: ${tokens.series.join(", ")}`} />
      <Support>{formatCompact(tokens.today)} today</Support>
    </Tile>
  );
}

function RiskList({ risks }: { risks: DashRisks }) {
  if (!risks.items.length) return <p className="pop-empty">No risks raised in your meetings.</p>;
  return (
    <ul className="pop-list">
      {risks.items.map((r, i) => (
        <li key={i}>
          {r.text}
          <span className="small">{[r.event_title, r.account].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskList({ brief }: { brief: BriefState }) {
  if (brief.loading) return <Skeleton />;
  if (brief.error) return <p className="pop-empty">{errorMessage(brief.error, "Suggestions are unavailable right now.")}</p>;
  const tasks = brief.data?.next_tasks ?? [];
  if (!tasks.length) return <p className="pop-empty">Nothing to suggest right now.</p>;
  return (
    <ol className="pop-list numbered">
      {tasks.map((t, i) => (
        <li key={i}>
          {t.task}
          <span className="small">{t.why}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- employee
function EmployeeTiles({ d, brief }: { d: EmployeeDashboard; brief: BriefState }) {
  const v = d.velocity;
  const tasks = (brief.data?.next_tasks ?? []).slice(0, 3);
  const deadlines = d.deadlines;
  const nextDue = deadlines.items.slice(0, 3);
  return (
    <>
      <Tile
        id="velocity"
        label="My velocity"
        source={v?.source ?? "live"}
        sampleNote={d.sample_note}
        detail={
          v ? (
            <>
              <div className="stats">
                <Stat label={`${v.unit} per sprint, on average`} value={v.average} />
                <Stat label={`of ${v.committed} done in ${v.sprint}`} value={v.done} />
              </div>
              <div className="pop-key">Last {plural(v.history.length, "sprint")}</div>
              <MiniBars values={v.history} title={`${v.unit} completed in the last ${v.history.length} sprints: ${v.history.join(", ")}`} height={64} labels />
            </>
          ) : (
            <p className="pop-empty">No sprint data for you yet.</p>
          )
        }
      >
        {v ? (
          <>
            <Headline value={v.average} unit="pts avg" />
            <MiniBars values={v.history} title={`${v.unit} completed in the last ${v.history.length} sprints: ${v.history.join(", ")}`} height={20} />
            <Support>
              {v.done} of {v.committed} done this sprint
            </Support>
          </>
        ) : (
          <Support>No sprint data</Support>
        )}
      </Tile>

      <TokensTile tokens={d.tokens} label="Tokens used" note={d.sample_note} />

      <Tile id="next" label="Suggested next" wide detail={<TaskList brief={brief} />} detailWidth={400}>
        {brief.loading ? (
          <Skeleton />
        ) : tasks.length ? (
          <ol className="dash-lines">
            {tasks.map((t, i) => (
              <li key={i} title={`${t.task} — ${t.why}`}>
                {t.task}
              </li>
            ))}
          </ol>
        ) : (
          <Support>{brief.error ? "Unavailable right now" : "Nothing to suggest"}</Support>
        )}
      </Tile>

      <Tile id="risks" label="Risks" source={d.risks.source} sampleNote={d.sample_note} detail={<RiskList risks={d.risks} />} detailWidth={400}>
        <Headline value={d.risks.count} />
        <Support>{d.risks.items[0]?.text ?? "None raised"}</Support>
      </Tile>

      <Tile
        id="deadlines"
        label="Deadlines"
        source={deadlines.source}
        sampleNote={d.sample_note}
        detailWidth={400}
        detail={
          deadlines.items.length ? (
            <ul className="pop-list">
              {deadlines.items.map((c) => (
                <li key={c.id}>
                  <span className="pop-row">
                    <span>{c.text}</span>
                    <b className={c.overdue ? "warn" : ""}>{c.due ? formatDue(c.due).label : "No date"}</b>
                  </span>
                  <span className="small">{[c.overdue ? "Overdue" : null, c.event_title, c.account].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pop-empty">Nothing due.</p>
          )
        }
      >
        <Headline value={deadlines.count} unit="open" />
        {deadlines.overdue > 0 ? (
          <Support warn>{deadlines.overdue} overdue</Support>
        ) : nextDue.length ? (
          <Support>
            Next: {nextDue[0].due ? `${formatDue(nextDue[0].due).label} · ` : ""}
            {nextDue[0].text}
          </Support>
        ) : (
          <Support>Nothing due</Support>
        )}
      </Tile>
    </>
  );
}

// ---------------------------------------------------------------- manager
function CloudDetail({ cloud }: { cloud: DashCloud }) {
  const over = cloud.forecast > cloud.budget;
  const top = Math.max(...cloud.by_service.map((s) => s.amount), 1);
  const money = (n: number) => formatMoney(n, cloud.currency);
  return (
    <>
      <div className="stats">
        <Stat label="month to date" value={money(cloud.month_to_date)} />
        <Stat label="forecast" value={money(cloud.forecast)} warn={over} />
        <Stat label="budget" value={money(cloud.budget)} />
      </div>
      <BudgetBar spent={cloud.month_to_date} forecast={cloud.forecast} budget={cloud.budget} title={`${money(cloud.month_to_date)} spent, ${money(cloud.forecast)} forecast, budget ${money(cloud.budget)}`} />
      <p className={`pop-line ${over ? "warn" : ""}`}>
        {over ? `Forecast is ${money(cloud.forecast - cloud.budget)} over budget.` : `Forecast is ${money(cloud.budget - cloud.forecast)} under budget.`} Last month: {money(cloud.last_month)}.
      </p>
      <div className="pop-key">By service, month to date</div>
      <ul className="meter-list">
        {cloud.by_service.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <i style={{ ["--w" as string]: `${(s.amount / top) * 100}%` }} />
            <b>{money(s.amount)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function SummaryDetail({ brief }: { brief: BriefState }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const summary = brief.data?.summary ?? [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.join("\n"));
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    window.setTimeout(() => setCopied(null), 2500);
  };
  if (brief.loading) return <Skeleton />;
  if (brief.error) return <p className="pop-empty">{errorMessage(brief.error, "The summary is unavailable right now.")}</p>;
  return (
    <>
      {summary.length ? (
        <ul className="pop-list">
          {summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="pop-empty">Nothing to report yet.</p>
      )}
      {summary.length ? (
        <div className="pop-actions">
          <span className="small" role="status">
            {copied === "yes" ? "Copied" : copied === "no" ? "Copy is blocked by this browser" : ""}
          </span>
          <button type="button" className="btn" onClick={copy} data-testid="copy-summary">
            Copy
          </button>
        </div>
      ) : null}
      <div className="pop-key">Suggested next</div>
      <TaskList brief={brief} />
    </>
  );
}

function ManagerTiles({ d, brief }: { d: ManagerDashboard; brief: BriefState }) {
  const b = d.burndown;
  const left = b.remaining[b.remaining.length - 1] ?? b.committed;
  const day = Math.max(b.remaining.length - 1, 0);
  const burnTitle = `${b.sprint} burn-down: ${left} of ${b.committed} ${b.unit} remaining on day ${day} of ${b.length_days}`;
  const cloud = d.cloud;
  const over = cloud.forecast > cloud.budget;
  const team = d.team;
  const summary = brief.data?.summary ?? [];
  return (
    <>
      <Tile
        id="burndown"
        label="Burn-down"
        source={b.source}
        sampleNote={d.sample_note}
        detailWidth={380}
        detail={
          <>
            <div className="stats">
              <Stat label={`${b.unit} remaining`} value={left} />
              <Stat label="committed" value={b.committed} />
              <Stat label="avg velocity" value={b.velocity} />
            </div>
            <div className="pop-key">
              {b.sprint} · day {day} of {b.length_days}
            </div>
            <Burndown remaining={b.remaining} ideal={b.ideal} title={burnTitle} detailed />
            <p className="pop-line">Last sprints: {b.history.join(", ")} {b.unit}.</p>
          </>
        }
      >
        <Headline value={left} unit="pts left" />
        <Burndown remaining={b.remaining} ideal={b.ideal} title={burnTitle} />
        <Support>Avg velocity {b.velocity}</Support>
      </Tile>

      <TokensTile tokens={d.tokens} label="Tokens (team)" note={d.sample_note} />

      <Tile id="cloud" label="Cloud bill" source={cloud.source} sampleNote={d.sample_note} detail={<CloudDetail cloud={cloud} />} detailWidth={380}>
        <Headline value={formatMoney(cloud.month_to_date, cloud.currency)} />
        <BudgetBar
          spent={cloud.month_to_date}
          forecast={cloud.forecast}
          budget={cloud.budget}
          title={`${formatMoney(cloud.month_to_date, cloud.currency)} spent this month, forecast ${formatMoney(cloud.forecast, cloud.currency)}, budget ${formatMoney(cloud.budget, cloud.currency)}`}
        />
        <Support warn={over}>
          Forecast {formatMoney(cloud.forecast, cloud.currency, true)} of {formatMoney(cloud.budget, cloud.currency, true)}
        </Support>
      </Tile>

      <Tile
        id="team"
        label="Team"
        source={team.source}
        sampleNote={d.sample_note}
        detailWidth={380}
        detail={
          <>
            <table className="pop-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Open</th>
                  <th className="num">Overdue</th>
                  <th className="num">Done</th>
                </tr>
              </thead>
              <tbody>
                {team.people.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{p.open}</td>
                    <td className={`num ${p.overdue > 0 ? "warn" : ""}`}>{p.overdue}</td>
                    <td className="num">{p.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pop-key">Proposed actions</div>
            <div className="stats">
              <Stat label="pending" value={team.pending} />
              <Stat label="approved" value={team.approved} />
              <Stat label="skipped" value={team.skipped} />
            </div>
          </>
        }
      >
        <Headline value={team.open} unit="open" />
        <Support warn={team.overdue > 0}>{team.overdue} overdue</Support>
      </Tile>

      <Tile id="summary" label="Stakeholder summary" wide detail={<SummaryDetail brief={brief} />} detailWidth={420}>
        {brief.loading ? (
          <Skeleton />
        ) : summary.length ? (
          <>
            <span className="dash-quote">{summary[0]}</span>
            {summary.length > 1 ? <Support>+{summary.length - 1} more</Support> : null}
          </>
        ) : (
          <Support>{brief.error ? "Unavailable right now" : "Nothing to report yet"}</Support>
        )}
      </Tile>
    </>
  );
}

export function DashboardTiles() {
  const role = useRole();
  const dash = useMossQuery<Dashboard>("dashboard", "/api/dashboard");
  const briefQuery = useMossQuery<DashBrief>("dashboard-brief", "/api/dashboard/brief");
  const brief: BriefState = { data: briefQuery.data, loading: briefQuery.isLoading, error: briefQuery.data ? null : briefQuery.error };
  const d = dash.data;

  if (dash.error && !d) return null; // the tiles are a summary; the page below still works without them
  return (
    <div className="dash-wrap" data-section="dashboard">
      <div className="dash" aria-label="At a glance" role="group" aria-busy={!d}>
      {!d || d.role !== role ? (
        Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`dash-tile placeholder ${i === (role === "manager" ? 4 : 2) ? "wide" : ""}`} aria-hidden="true">
            <Skeleton lines={2} />
          </div>
        ))
      ) : d.role === "manager" ? (
        <ManagerTiles d={d} brief={brief} />
      ) : (
        <EmployeeTiles d={d} brief={brief} />
      )}
      </div>
    </div>
  );
}
