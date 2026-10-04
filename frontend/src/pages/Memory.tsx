// "/memory" — why Moss keeps three layers of memory. Every number on this page comes from the API
// (GET /api/memory, POST /api/memory/compare, GET /api/status) and is measured live; nothing is made up here.
import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useCustomMutation, type HttpError } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../config";
import { AgentAvatar, useAgentDirectory } from "../components/AgentAvatar";
import { Empty, ErrorNote, Loading } from "../components/States";
import { MOSS_QUERY_KEY, useMossQuery, useRole } from "../hooks/useMoss";
import { TOOL_AGENT } from "../lib/agents";
import { formatCount, formatDay, formatMs, formatWhen, plural } from "../lib/format";
import type { MemoryCompare, MemoryStats, Status } from "../types";

const QUESTIONS = [
  "What did we discuss with Harborline last month?",
  "Show me all customers interested in payroll integration",
  "What are the open commitments for Harborline Freight?",
];

const entries = (rec: Record<string, number> | null | undefined): Array<[string, number]> =>
  Object.entries(rec ?? {})
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1]);

/** A tool shown as the agent that owns it: avatar + "Raven · gmail". Unknown tools fall back to the tool name. */
function ToolBadge({ tool, count }: { tool: string; count?: number }) {
  const { byId } = useAgentDirectory();
  const agentId = TOOL_AGENT[tool];
  const agent = agentId ? byId.get(agentId) : undefined;
  return (
    <span className="tool-badge" data-tool={tool} title={agent ? `${agent.name} looks after ${tool}` : tool}>
      {agentId ? <AgentAvatar id={agentId} /> : null}
      <span>
        {agent ? `${agent.name} · ` : ""}
        {tool}
        {count !== undefined ? <b> {formatCount(count)}</b> : null}
      </span>
    </span>
  );
}

function CountChips({ data, label }: { data: Record<string, number> | null | undefined; label: string }) {
  const list = entries(data);
  if (!list.length) return <span className="small">none yet</span>;
  return (
    <span className="chips" aria-label={label}>
      {list.map(([k, v]) => (
        <span key={k} className="chip">
          {k} <b>{formatCount(v)}</b>
        </span>
      ))}
    </span>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="mem-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function LayerCard({ id, name, job, without, children }: { id: string; name: string; job: string; without: string; children: ReactNode }) {
  return (
    <article className="card mem-card" data-layer={id}>
      <h2>
        {name} <span className="mem-job">{job}</span>
      </h2>
      <p className="mem-without">
        <b>Without it:</b> {without}
      </p>
      {children}
    </article>
  );
}

function Layers({ memory, isManager }: { memory: MemoryStats; isManager: boolean }) {
  const { cache, graph, store } = memory;
  const audit = store?.recent_audit ?? [];
  const decisions = store?.decisions ?? {};
  return (
    <div className="mem-cards">
      <LayerCard id="cache" name="Cache" job="speed" without="every repeated question pays the full LLM and lookup cost again, and burns free-tier quota.">
        <div className="mem-stats">
          <Stat value={formatCount(cache?.hits)} label="hits" />
          <Stat value={formatCount(cache?.misses)} label="misses" />
          <Stat value={formatMs(cache?.saved_ms)} label="time saved" />
        </div>
        <div className="mem-row">
          <span className="mem-key">Entries by namespace</span>
          <CountChips data={cache?.namespaces} label="Cache entries by namespace" />
        </div>
      </LayerCard>

      <LayerCard
        id="graph"
        name="Knowledge graph"
        job="connection"
        without="a decision from a meeting, the ticket it led to and the customer email about it are three unrelated documents."
      >
        <div className="mem-stats">
          <Stat value={formatCount(graph?.facts)} label="facts" />
          <Stat value={formatCount(graph?.cross_tool?.filter((c) => c.tools.length > 1).length)} label="accounts linked across tools" />
          <Stat value={graph?.backend ?? "—"} label="backend" />
        </div>
        <div className="mem-row">
          <span className="mem-key">Facts by type</span>
          <CountChips data={graph?.by_type} label="Facts by type" />
        </div>
        <div className="mem-row">
          <span className="mem-key">Facts by tool</span>
          <span className="chips">
            {entries(graph?.by_tool).map(([tool, n]) => (
              <ToolBadge key={tool} tool={tool} count={n} />
            ))}
            {!entries(graph?.by_tool).length ? <span className="small">none yet</span> : null}
          </span>
        </div>
        <div className="mem-row">
          <span className="mem-key">Accounts connected across tools</span>
          {graph?.cross_tool?.length ? (
            <ul className="mem-list" data-testid="cross-tool">
              {graph.cross_tool.map((c) => (
                <li key={c.account}>
                  <div className="mem-list-head">
                    <b>{c.account}</b>
                    <span className="small">{plural(c.facts, "fact")}</span>
                  </div>
                  <span className="chips">
                    {c.tools.map((t) => (
                      <ToolBadge key={t} tool={t} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="small">none yet</span>
          )}
        </div>
      </LayerCard>

      <LayerCard
        id="store"
        name="SQLite"
        job="truth and accountability"
        without="there is no exact state (what is open, who approved what) and nothing survives a restart."
      >
        <div className="mem-row">
          <span className="mem-key">Rows per table</span>
          <CountChips data={store?.tables} label="Rows per table" />
        </div>
        <div className="mem-row">
          <span className="mem-key">Action decisions</span>
          <span className="chips" aria-label="Action decisions">
            <span className="chip ok">
              approved <b>{formatCount(decisions.approved ?? 0)}</b>
            </span>
            <span className="chip">
              skipped <b>{formatCount(decisions.skipped ?? 0)}</b>
            </span>
            {entries(decisions)
              .filter(([k]) => k !== "approved" && k !== "skipped")
              .map(([k, v]) => (
                <span key={k} className="chip">
                  {k} <b>{formatCount(v)}</b>
                </span>
              ))}
          </span>
        </div>
        {isManager ? (
          <div className="mem-row">
            <span className="mem-key">Recent audit trail</span>
            {audit.length ? (
              <ul className="mem-list audit" data-testid="audit">
                {audit.slice(0, 6).map((a, i) => (
                  <li key={`${a.ts}-${i}`}>
                    <div className="mem-list-head">
                      <b>{a.user_id}</b>
                      <span className="small">{formatWhen(a.ts)}</span>
                    </div>
                    <span className="audit-what">
                      {a.action}
                      {a.detail ? ` · ${a.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="small">nothing recorded yet</span>
            )}
          </div>
        ) : null}
      </LayerCard>
    </div>
  );
}

/** Two horizontal bars on one scale. Widths come straight from the two measured values. */
function Bars({ title, a, b, format, note }: { title: string; a: { label: string; value: number }; b: { label: string; value: number }; format: (n: number) => string; note?: string }) {
  const max = Math.max(a.value, b.value, 0);
  const width = (v: number) => (max > 0 ? `${Math.max(1.5, (v / max) * 100)}%` : "0%");
  return (
    <div className="bars">
      <div className="bars-title">
        <b>{title}</b>
        {note ? <span className="small">{note}</span> : null}
      </div>
      {[a, b].map((row, i) => (
        <div className="bar-row" key={row.label}>
          <span className="bar-label">{row.label}</span>
          <span className="bar-track">
            <i className={i === 0 ? "bar-fill raw" : "bar-fill"} style={{ "--w": width(row.value) } as CSSProperties} />
          </span>
          <span className="bar-value">{format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function CompareResult({ res }: { res: MemoryCompare }) {
  const { raw, graph, cache, store, llm_answer: llm } = res;
  const commitments = store?.open_commitments ?? [];
  return (
    <div className="compare" data-testid="compare-result">
      <div className="compare-cols">
        <div className="compare-col raw">
          <h3>Without memory</h3>
          <p>
            <b>{plural(raw.documents, "raw document")}</b> from {plural(raw.tools?.length ?? 0, "tool")}, ≈{formatCount(raw.tokens)} tokens the model would have to read.
          </p>
          <span className="chips">{raw.tools?.map((t) => <ToolBadge key={t} tool={t} />)}</span>
          {raw.sample?.length ? (
            <ul className="plain">
              {raw.sample.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ul>
          ) : (
            <div className="small">No documents matched this question.</div>
          )}
        </div>
        <div className="compare-col graph">
          <h3>With the knowledge graph</h3>
          <p>
            <b>{plural(graph.facts, "dated fact")}</b> from {plural(graph.tools?.length ?? 0, "tool")}, ≈{formatCount(graph.tokens)} tokens
            {typeof res.context_saving_percent === "number" ? (
              <>
                {" "}
                · <b className="saving">{res.context_saving_percent >= 0 ? `${res.context_saving_percent}% less to read` : `${-res.context_saving_percent}% more to read`}</b>
              </>
            ) : null}
            .
          </p>
          <span className="chips">{graph.tools?.map((t) => <ToolBadge key={t} tool={t} />)}</span>
          {graph.sample?.length ? (
            <ul className="plain facts">
              {graph.sample.map((f, i) => (
                <li key={i}>
                  {f.fact}
                  <span className="small">
                    {[f.date ? formatDay(f.date) : null, f.source].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="small">The graph has no facts for this question.</div>
          )}
        </div>
      </div>

      <div className="compare-bars">
        <Bars title="Tokens to read" a={{ label: "Raw documents", value: raw.tokens }} b={{ label: "Graph facts", value: graph.tokens }} format={(n) => `≈${formatCount(n)}`} />
        <Bars
          title="Lookup time"
          note={Number.isFinite(cache?.speedup) ? `${cache.speedup}× faster from the cache` : undefined}
          a={{ label: "Cold (computed)", value: cache?.cold_ms ?? 0 }}
          b={{ label: "Warm (cached)", value: cache?.warm_ms ?? 0 }}
          format={formatMs}
        />
      </div>

      {llm ? (
        <div className={`compare-llm${llm.error ? " failed" : ""}`} data-testid="compare-llm">
          <h3>The model's answer</h3>
          {llm.error ? (
            <p className="warn-text">The model call failed: {llm.error}</p>
          ) : (
            <>
              <p className="llm-text">{llm.text}</p>
              <div className="small">
                first call {formatMs(llm.first_ms)} → repeat {formatMs(llm.repeat_ms)} (served from cache){llm.route ? ` · ${llm.route}` : ""}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="compare-store">
        <h3>From SQLite</h3>
        <p className="small">
          {plural(commitments.length, "open commitment")} for the accounts involved · {plural(store?.approved_actions ?? 0, "approved action")} · {plural(store?.audit_entries ?? 0, "audit entry", "audit entries")}
        </p>
        {commitments.length ? (
          <ul className="plain">
            {commitments.map((c, i) => (
              <li key={i}>
                {c.text}
                <span className="small">
                  {[c.owner ?? "no owner", c.due ? `due ${formatDay(c.due)}` : "no due date", c.account].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ProveIt({ llmMode }: { llmMode: string | undefined }) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useCustomMutation<MemoryCompare, HttpError, { question: string; with_llm: boolean }>();
  const [question, setQuestion] = useState(QUESTIONS[0]);
  const [withLlm, setWithLlm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MemoryCompare | null>(null);
  const [error, setError] = useState<unknown>(null);
  const llmAvailable = !!llmMode && llmMode !== "offline";

  const run = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mutateAsync({ url: api("/api/memory/compare"), method: "post", values: { question: text, with_llm: llmAvailable && withLlm } });
      setResult(res.data as MemoryCompare);
      // the comparison itself reads and fills the cache: refresh the live numbers above and in the sidebar
      void queryClient.invalidateQueries({ queryKey: [MOSS_QUERY_KEY] }, { cancelRefetch: false });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(question);
  };

  return (
    <section className="card prove" aria-labelledby="prove-title" data-section="prove">
      <h2 id="prove-title">Prove it</h2>
      <p className="small">Ask one question and see what each layer contributes. The numbers are measured on this run.</p>
      <form className="prove-form" onSubmit={submit}>
        <input
          className="field"
          aria-label="Question to compare"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about an account, a customer or a project"
          maxLength={300}
        />
        <button className="btn p" type="submit" disabled={busy || !question.trim()} data-testid="compare-run">
          {busy ? "Measuring…" : "Run"}
        </button>
      </form>
      <div className="suggestions">
        {QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="chip suggestion"
            disabled={busy}
            onClick={() => {
              setQuestion(q);
              void run(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>
      <label className={`check${llmAvailable ? "" : " off"}`} title={llmAvailable ? undefined : "The model is offline, so only the lookups are measured"}>
        <input type="checkbox" checked={llmAvailable && withLlm} disabled={!llmAvailable || busy} onChange={(e) => setWithLlm(e.target.checked)} data-testid="compare-llm-toggle" />
        Also ask the model (uses LLM quota)
        {llmAvailable ? null : <span className="small"> — unavailable, the model is offline</span>}
      </label>

      {busy && !result ? <Loading label="Measuring the three layers…" /> : null}
      {error ? <ErrorNote error={error} onRetry={() => void run(question)} /> : null}
      {result ? (
        <>
          <div className="small compare-q">
            Result for: <b>{result.question}</b>
          </div>
          {result.raw.documents === 0 && result.graph.facts === 0 ? (
            <Empty title="Nothing matched this question">Neither the raw documents nor the graph mention it. Try one of the suggested questions.</Empty>
          ) : (
            <CompareResult res={result} />
          )}
        </>
      ) : null}
    </section>
  );
}

export function MemoryPage() {
  const role = useRole();
  const memory = useMossQuery<MemoryStats>("memory", "/api/memory");
  const status = useMossQuery<Status>("status", "/api/status");
  const llmMode = status.data?.llm?.mode ?? memory.data?.llm?.mode;

  return (
    <section className="main memory-page" data-page="memory">
      <h1>Memory</h1>
      <p className="premise">Moss remembers in three layers. Each one does a different job, and removing any one of them costs something specific.</p>

      <ol className="flow" aria-label="How a piece of work travels through the three layers">
        <li>Every email, message, ticket, page and meeting</li>
        <li>
          <b>SQLite</b> keeps the record
        </li>
        <li>
          <b>Knowledge graph</b> connects the facts
        </li>
        <li>
          <b>Cache</b> keeps hot answers
        </li>
      </ol>

      {memory.error && !memory.data ? (
        <ErrorNote error={memory.error} onRetry={() => void memory.refetch()} />
      ) : memory.isLoading || !memory.data ? (
        <Loading label="Reading the three layers…" />
      ) : (
        <Layers memory={memory.data} isManager={role === "manager"} />
      )}

      <ProveIt llmMode={llmMode} />
    </section>
  );
}
