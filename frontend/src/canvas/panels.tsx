// The panels around the board: node palette, node inspector and the test-run drawer.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Link } from "react-router";
import { AgentAvatar } from "../components/AgentAvatar";
import { errorMessage } from "../providers/http";
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
                {result.proposal_id ? (
                  <span className="cv-queued">
                    Sent to the approval queue. <Link to="/">Open the Clearing</Link>
                  </span>
                ) : queued ? (
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
