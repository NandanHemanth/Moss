// The panels around the board: node palette, node inspector and the test-run drawer.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Link } from "react-router";
import { AgentAvatar } from "../components/AgentAvatar";
import { errorMessage, request } from "../providers/http";
import type { Proposal, ProposedAction } from "../types";
import { SAMPLE_INPUT, TEXT_FIELDS, runWorkflow, stepLook, type Graph, type NodeType, type RunResult, type StepData, type StepNode, type TextField } from "./model";

/** dataTransfer type used when a palette item is dragged onto the board. */
export const DRAG_TYPE = "application/x-moss-node";

// ---------- palette ----------
export function Palette({ types, onAdd }: { types: NodeType[]; onAdd: (type: string) => void }) {
  const onDragStart = (e: DragEvent<HTMLDivElement>, type: string) => {
    e.dataTransfer.setData(DRAG_TYPE, type);
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <aside className="cv-palette" aria-label="Node types">
      <div className="lbl first">Nodes</div>
      <ul>
        {types.map((t) => {
          const look = stepLook(t.type, t.agent_id);
          return (
            <li key={t.type}>
              {/* a div, not a <button>: Firefox does not start a drag from a button */}
              <div
                role="button"
                tabIndex={0}
                className="cv-palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, t.type)}
                onClick={() => onAdd(t.type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onAdd(t.type);
                  }
                }}
                title={`${t.hint} Drag onto the board, or click to add.`}
                data-node-type={t.type}
              >
                {t.agent_id ? (
                  <AgentAvatar id={t.agent_id} />
                ) : (
                  <span className="av cv-plain-av" style={{ "--c": look.color } as CSSProperties} aria-hidden="true">
                    {look.glyph}
                  </span>
                )}
                <span className="cv-palette-text">
                  <b>{t.label}</b>
                  {t.agent_name ? <span className="small">{t.agent_name}</span> : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---------- inspector ----------
const FIELD_COPY: Record<TextField, { label: string; help: string; placeholder: string }> = {
  trigger: { label: "Trigger", help: "When should this workflow start?", placeholder: "e.g. When an email reports a bug" },
  description: { label: "Description", help: "What should this step do?", placeholder: "e.g. Create a ticket for the bug" },
  input: { label: "Input", help: "What it reads.", placeholder: "e.g. The email's text" },
  output: { label: "Output", help: "What it hands on.", placeholder: "e.g. A short summary" },
};

export function Inspector({
  node,
  type,
  isTrigger,
  onChange,
  onRemove,
  onClose,
}: {
  node: StepNode;
  type: NodeType | undefined;
  isTrigger: boolean;
  onChange: (patch: Partial<StepData>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const fields = TEXT_FIELDS.filter((f) => f !== "trigger" || isTrigger);
  return (
    <aside className="cv-inspector" aria-label="Selected node" data-testid="inspector">
      <div className="cv-inspector-head">
        <h2>{type?.label ?? node.data.kind}</h2>
        {type?.agent_name ? <span className="small">{type.agent_name}</span> : null}
        <button type="button" className="cv-x" onClick={onClose} aria-label="Close" title="Close">
          ×
        </button>
      </div>
      <label className="cv-field">
        <span className="cv-field-name">Label</span>
        <input className="field" value={node.data.label} maxLength={60} onChange={(e) => onChange({ label: e.target.value })} data-field="label" />
      </label>
      {fields.map((f) => (
        <label className="cv-field" key={f}>
          <span className="cv-field-name">
            {FIELD_COPY[f].label} <span className="small">{FIELD_COPY[f].help}</span>
          </span>
          <textarea
            className="field"
            rows={f === "description" || f === "trigger" ? 3 : 2}
            value={node.data[f]}
            maxLength={600}
            placeholder={FIELD_COPY[f].placeholder}
            onChange={(e) => onChange({ [f]: e.target.value })}
            data-field={f}
          />
        </label>
      ))}
      <button type="button" className="btn cv-danger" onClick={onRemove}>
        Remove node
      </button>
    </aside>
  );
}

// ---------- test run ----------
const STEP_MS = 520;

function paramText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ---------- approve the queued actions without leaving the canvas (only managers reach this page) ----------
type Approval =
  | { state: "loading" }
  | { state: "error"; error: unknown }
  | { state: "ready" | "approving" | "done"; proposal: Proposal; error?: unknown };

function ActionOutcome({ action }: { action: ProposedAction }) {
  const r = action.result;
  const url = typeof r?.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : null;
  const tone = action.status === "executed" ? "ok" : action.status === "failed" ? "fail" : "";
  return (
    <li className="cv-approve-row" data-status={action.status}>
      <span className={`chip ${tone}`}>{action.status}</span>
      <div className="cv-approve-text">
        <b>{action.title}</b>
        {action.status === "executed" && (r?.text || url) ? (
          <span className="small">
            {r?.text}
            {url ? (
              <>
                {r?.text ? " · " : ""}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  Open
                </a>
              </>
            ) : null}
          </span>
        ) : null}
        {action.status === "failed" ? <span className="small warn-text">{r?.error || "It could not be run."}</span> : null}
      </div>
    </li>
  );
}

function ApprovePanel({ proposalId }: { proposalId: string }) {
  const [approval, setApproval] = useState<Approval>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setApproval({ state: "loading" });
    request<Proposal[]>("/api/proposals", { query: { status: "all" } })
      .then((list) => {
        if (cancelled) return;
        const proposal = (Array.isArray(list) ? list : []).find((p) => p.id === proposalId);
        if (!proposal) throw { message: "The queued actions were not found. Review them in the Clearing.", statusCode: 404 };
        setApproval({ state: proposal.actions.some((a) => a.status === "pending") ? "ready" : "done", proposal });
      })
      .catch((error: unknown) => {
        if (!cancelled) setApproval({ state: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [proposalId, attempt]);

  const approve = async () => {
    if (approval.state !== "ready") return;
    const before = approval.proposal;
    setApproval({ state: "approving", proposal: before });
    try {
      const after = await request<Proposal>(`/api/proposals/${encodeURIComponent(proposalId)}/approve-all`, { method: "POST" });
      setApproval({ state: "done", proposal: after && Array.isArray(after.actions) ? after : before });
    } catch (error) {
      setApproval({ state: "ready", proposal: before, error });
    }
  };

  const clearing = <Link to="/">review in the Clearing</Link>;
  if (approval.state === "loading") {
    return (
      <div className="cv-approve" data-testid="approve-panel" data-state="loading">
        <div className="state" role="status">
          <span className="spin" aria-hidden="true" />
          Sent to approvals. Loading the queued actions…
        </div>
      </div>
    );
  }
  if (approval.state === "error") {
    return (
      <div className="cv-approve" data-testid="approve-panel" data-state="error">
        <div className="state error" role="alert">
          <div className="grow">{errorMessage(approval.error, "The queued actions could not be loaded.")}</div>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
        <span className="small">Sent to approvals. You can also {clearing}.</span>
      </div>
    );
  }
  const actions = [...approval.proposal.actions].sort((a, b) => a.position - b.position);
  const done = approval.state === "done";
  const ran = actions.filter((a) => a.status === "executed").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  return (
    <div className="cv-approve" data-testid="approve-panel" data-state={approval.state}>
      <div className="cv-approve-head">
        <b>
          {done
            ? `${ran} of ${actions.length} ran${failed ? ` · ${failed} failed` : ""}`
            : `${actions.length} ${actions.length === 1 ? "action is" : "actions are"} waiting for approval. Nothing has been sent yet.`}
        </b>
        {!done ? (
          <button type="button" className="btn p" disabled={approval.state === "approving"} onClick={() => void approve()} data-testid="approve-run">
            {approval.state === "approving" ? "Running…" : "Approve and run"}
          </button>
        ) : null}
        <span className="small">{done ? <Link to="/">Open the Clearing</Link> : <>or {clearing}</>}</span>
      </div>
      {approval.error ? (
        <div className="state error" role="alert">
          {errorMessage(approval.error, "The actions could not be approved.")}
        </div>
      ) : null}
      <ul className="cv-approve-list" data-testid="approve-actions">
        {actions.map((a) => (
          <ActionOutcome key={a.id} action={a} />
        ))}
      </ul>
    </div>
  );
}

export function RunPanel({
  workflowId,
  name,
  getGraph,
  hasNodes,
  types,
  onStep,
  onClose,
}: {
  workflowId: string | null;
  name: string;
  getGraph: () => Graph;
  hasNodes: boolean;
  types: Map<string, NodeType>;
  /** Tells the board which step is being shown (null when the reveal is over) and which ones were shown. */
  onStep: (active: string | null, ran: string[]) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [busy, setBusy] = useState<"dry" | "queue" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [queued, setQueued] = useState(false);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const listRef = useRef<HTMLOListElement>(null);

  // Reveal the steps one at a time, highlighting each node on the board as its step appears.
  useEffect(() => {
    if (!result) return;
    const steps = result.steps ?? [];
    const ids = steps.slice(0, shown).map((s) => s.node_id);
    if (shown >= steps.length) {
      const t = window.setTimeout(() => onStepRef.current(null, ids), shown ? STEP_MS : 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), shown ? STEP_MS : 80);
    return () => window.clearTimeout(t);
  }, [result, shown]);
  useEffect(() => {
    if (!result || !shown) return;
    const steps = result.steps ?? [];
    onStepRef.current(steps[shown - 1]?.node_id ?? null, steps.slice(0, shown).map((s) => s.node_id));
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [result, shown]);
  useEffect(() => () => onStepRef.current(null, []), []);

  const run = async (queue: boolean) => {
    if (busy) return;
    setBusy(queue ? "queue" : "dry");
    setError(null);
    setResult(null);
    setShown(0);
    onStepRef.current(null, []);
    try {
      const res = await runWorkflow(workflowId ?? "draft", { input, queue, graph: getGraph(), name: name.trim() || "Draft" });
      setQueued(queue);
      setResult(res);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const steps = result?.steps ?? [];
  const done = !!result && shown >= steps.length;

  return (
    <section className="cv-run" aria-label="Test run" data-testid="run-panel">
      <div className="cv-run-form">
        <div className="cv-run-head">
          <h2>Test run</h2>
          <button type="button" className="cv-x" onClick={onClose} aria-label="Close test run" title="Close">
            ×
          </button>
        </div>
        <label className="cv-field">
          <span className="cv-field-name">Sample input</span>
          <textarea className="field" rows={5} value={input} onChange={(e) => setInput(e.target.value)} data-testid="run-input" />
        </label>
        <div className="cv-run-actions">
          <button type="button" className="btn p" disabled={!!busy || !hasNodes} onClick={() => void run(false)} title="Runs the steps without sending anything" data-testid="run-dry">
            {busy === "dry" ? "Running…" : "Dry run"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy || !hasNodes}
            onClick={() => void run(true)}
            title="Puts the proposed actions in the Clearing for approval"
            data-testid="run-queue"
          >
            {busy === "queue" ? "Sending…" : "Send to approvals"}
          </button>
        </div>
        {!hasNodes ? <div className="small">Add a node first.</div> : null}
      </div>

      <div className="cv-run-result" aria-live="polite">
        {error ? (
          <div className="state error" role="alert">
            {errorMessage(error, "The run failed.")}
          </div>
        ) : null}
        {busy ? (
          <div className="state" role="status">
            <span className="spin" aria-hidden="true" />
            Running the workflow…
          </div>
        ) : null}
        {!busy && !result && !error ? <div className="small cv-run-hint">A dry run shows what each step would do. Nothing is sent until a manager approves it.</div> : null}
        {result && !queued ? (
          <div className="cv-dry-note" data-testid="dry-note">
            <b>Dry run — nothing was sent.</b>
            <button type="button" className="btn p" disabled={!!busy || !hasNodes} onClick={() => void run(true)} data-testid="dry-send">
              Send to approvals
            </button>
          </div>
        ) : null}
        {result?.proposal_id ? <ApprovePanel key={result.proposal_id} proposalId={result.proposal_id} /> : null}
        {result ? (
          <>
            {steps.length ? (
              <ol className="cv-steps" ref={listRef} data-testid="run-steps">
                {steps.slice(0, shown).map((s, i) => {
                  const look = stepLook(s.type, types.get(s.type)?.agent_id);
                  const params = Object.entries(s.action?.params ?? {}).filter(([, v]) => paramText(v) !== "");
                  return (
                    <li key={`${s.node_id}-${i}`} className="cv-step" data-role={s.role}>
                      <span className={`cv-step-icon${look.plain ? " plain" : ""}`} style={{ "--c": look.color } as CSSProperties} aria-hidden="true">
                        {look.glyph}
                      </span>
                      <div className="cv-step-body">
                        <div className="cv-step-head">
                          <b>{s.label}</b>
                          <span className="chip">{s.role}</span>
                        </div>
                        <p className="cv-step-out">{s.output}</p>
                        {s.action ? (
                          <div className="cv-action" data-testid="action-preview">
                            <div className="cv-action-head">
                              <span className="chip ok">{s.action.kind}</span>
                              <b>{s.action.title}</b>
                            </div>
                            {params.length ? (
                              <dl>
                                {params.slice(0, 4).map(([k, v]) => (
                                  <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>{paramText(v)}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="small cv-run-hint">No steps ran. Connect the nodes so the workflow has a path to follow.</div>
            )}
            {done ? (
              <div className="cv-run-summary" data-testid="run-summary">
                {result.summary ? <b>{result.summary}</b> : null}
                {result.proposal_id ? null : queued ? (
                  <span className="small">Nothing was queued: this run proposed no actions.</span>
                ) : null}
                <span className="small">
                  {result.status}
                  {result.route ? ` · ${result.route}` : ""}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
