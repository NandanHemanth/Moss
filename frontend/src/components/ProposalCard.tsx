// One proposal: the event it came from, the insights found in it, and the proposed actions.
// Managers approve / edit / skip each action; employees see the same card read-only.
import { useMemo, useState, type FormEvent } from "react";
import { useCustomMutation, useInvalidate, type HttpError } from "@refinedev/core";
import { api } from "../config";
import { useAllowed } from "../hooks/useMoss";
import { firstName, formatDue, formatWhen, isHttpUrl, plural } from "../lib/format";
import { errorMessage } from "../providers/http";
import type { Insight, Proposal, ProposedAction, User } from "../types";
import { AgentAvatar, PlainAvatar, useAgentDirectory } from "./AgentAvatar";

const SOURCE_NOUN: Record<string, string> = {
  meeting: "read the transcript",
  gmail: "read the email",
  slack: "read the thread",
  jira: "read the ticket",
  confluence: "read the page",
  calendar: "saw the invite",
};

function InsightChip({ insight }: { insight: Insight }) {
  const kind = insight.kind || "note";
  // decision / commitment / request share the plain chip; only risks are tinted
  const label = kind === "request" ? "Request" : kind.charAt(0).toUpperCase() + kind.slice(1);
  const extras: string[] = [];
  if (insight.owner) extras.push(firstName(insight.owner));
  if (insight.due) extras.push(`due ${formatDue(insight.due).label}`);
  return (
    <span className={`chip ${kind === "risk" ? "w" : ""}`} data-insight={kind}>
      <b>{label}:</b> {insight.text}
      {extras.length ? ` — ${extras.join(" · ")}` : ""}
    </span>
  );
}

// ---------------------------------------------------------------- edit form
type FieldKind = "text" | "long" | "number" | "list";
interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  /** "title" | "detail" live on the action itself, everything else inside params */
  scope: "action" | "params";
  initial: string;
}

const humanise = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const LONG_KEYS = new Set(["description", "text", "body", "detail"]);

function fieldsFor(action: ProposedAction): { fields: Field[]; readOnly: Array<[string, string]> } {
  // What will actually be sent to the tool comes first; the card's own title/detail last.
  const fields: Field[] = [];
  const readOnly: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(action.params ?? {})) {
    if (typeof value === "string") {
      const long = LONG_KEYS.has(key) || value.length > 70 || value.includes("\n");
      fields.push({ key, label: humanise(key), kind: long ? "long" : "text", scope: "params", initial: value });
    } else if (typeof value === "number") {
      fields.push({ key, label: humanise(key), kind: "number", scope: "params", initial: String(value) });
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      fields.push({ key, label: `${humanise(key)} (comma-separated)`, kind: "list", scope: "params", initial: (value as string[]).join(", ") });
    } else {
      readOnly.push([humanise(key), JSON.stringify(value)]);
    }
  }
  // Short fields first, long text after, so the grid packs neatly.
  fields.sort((a, b) => Number(a.kind === "long" || a.kind === "list") - Number(b.kind === "long" || b.kind === "list"));
  fields.push({ key: "title", label: "Action title (shown in this list)", kind: "text", scope: "action", initial: action.title ?? "" });
  fields.push({ key: "detail", label: "Action detail (shown in this list)", kind: "long", scope: "action", initial: action.detail ?? "" });
  return { fields, readOnly };
}

type Edits = { title?: string; detail?: string; params?: Record<string, unknown> };

function EditForm({ action, busy, onCancel, onSubmit }: { action: ProposedAction; busy: boolean; onCancel: () => void; onSubmit: (edits: Edits) => void }) {
  const { fields, readOnly } = useMemo(() => fieldsFor(action), [action]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [`${f.scope}.${f.key}`, f.initial])));
  const set = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const edits: Edits = {};
    const params: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[`${f.scope}.${f.key}`] ?? "";
      if (raw === f.initial) continue; // only send what changed
      if (f.scope === "action") {
        if (raw.trim()) edits[f.key as "title" | "detail"] = raw.trim();
      } else if (f.kind === "number") {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) params[f.key] = n;
      } else if (f.kind === "list") {
        params[f.key] = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        params[f.key] = raw;
      }
    }
    if (Object.keys(params).length) edits.params = params;
    onSubmit(edits);
  };

  return (
    <form className="edit" onSubmit={submit} aria-label={`Edit “${action.title}”`}>
      {fields.map((f) => {
        const id = `${action.id}-${f.scope}-${f.key}`;
        const value = values[`${f.scope}.${f.key}`] ?? "";
        return (
          <label key={id} htmlFor={id} className={f.kind === "long" || f.kind === "list" || f.scope === "action" ? "wide" : ""}>
            <span>{f.label}</span>
            {f.kind === "long" ? (
              <textarea id={id} className="field" rows={Math.min(8, Math.max(2, value.split("\n").length + Math.floor(value.length / 90)))} value={value} onChange={(e) => set(`${f.scope}.${f.key}`, e.target.value)} />
            ) : (
              <input id={id} className="field" type={f.kind === "number" ? "number" : "text"} value={value} onChange={(e) => set(`${f.scope}.${f.key}`, e.target.value)} />
            )}
          </label>
        );
      })}
      {readOnly.length ? (
        <div className="small wide">
          Not editable here: {readOnly.map(([k, v]) => `${k} = ${v}`).join(" · ")}
        </div>
      ) : null}
      <div className="row wide" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn p" disabled={busy}>
          {busy ? "Approving…" : "Approve with changes"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- one action row
function StatusChip({ status }: { status: string }) {
  if (status === "executed") return <span className="chip ok">Done</span>;
  if (status === "skipped") return <span className="chip">Skipped</span>;
  if (status === "failed") return <span className="chip fail">Failed</span>;
  if (status === "approved") return <span className="chip">Running…</span>;
  return <span className="chip">{status}</span>;
}

function ActionRow({ action: serverAction, canDecide }: { action: ProposedAction; canDecide: boolean }) {
  const { nameOf } = useAgentDirectory();
  const invalidate = useInvalidate();
  const { mutateAsync } = useCustomMutation<ProposedAction, HttpError, { decision: "approve" | "skip" } & Edits>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The decide call returns the final action; show it right away, before the list refetch lands.
  const [decided, setDecided] = useState<ProposedAction | null>(null);

  const action = serverAction.status === "pending" && decided ? decided : serverAction;
  const pending = action.status === "pending";

  const decide = async (decision: "approve" | "skip", edits: Edits = {}) => {
    setBusy(decision);
    setError(null);
    try {
      const res = await mutateAsync({
        url: api(`/api/actions/${encodeURIComponent(action.id)}/decide`),
        method: "post",
        values: { decision, ...edits },
      });
      setDecided(res.data);
      setEditing(false);
      void invalidate({ resource: "proposals", invalidates: ["list"] });
    } catch (e) {
      setError(errorMessage(e, "Could not save the decision."));
    } finally {
      setBusy(null);
    }
  };

  const result = action.result;
  return (
    <div className="act" data-action={action.id} data-status={action.status} data-kind={action.kind}>
      <AgentAvatar id={action.agent_id} />
      <div className="grow">
        <b>{action.title}</b>
        <div className="small">{action.detail}</div>
      </div>
      <div className="bt">
        {pending && canDecide && !editing ? (
          <>
            <button className="btn p" disabled={!!busy} onClick={() => decide("approve")}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn" disabled={!!busy} onClick={() => decide("skip")}>
              {busy === "skip" ? "Skipping…" : "Skip"}
            </button>
          </>
        ) : pending ? (
          editing ? null : <span className="chip">Waiting for manager</span>
        ) : (
          <StatusChip status={action.status} />
        )}
      </div>

      {editing && pending ? <EditForm action={action} busy={!!busy} onCancel={() => setEditing(false)} onSubmit={(edits) => decide("approve", edits)} /> : null}

      {action.status === "executed" ? (
        <div className="result ok">
          ✓ {result?.text || `${nameOf(action.agent_id)} finished.`}
          {isHttpUrl(result?.url) ? (
            <>
              {" "}
              <a href={result.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {action.status === "failed" ? <div className="result fail">Failed: {result?.error || "The action could not be completed."}</div> : null}
      {error ? (
        <div className="result fail" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the card
export function ProposalCard({ proposal, users = [] }: { proposal: Proposal; users?: User[] }) {
  const { nameOf } = useAgentDirectory();
  const canDecide = useAllowed("proposals", "decide");
  const invalidate = useInvalidate();
  const { mutateAsync } = useCustomMutation<Proposal, HttpError, Record<string, never>>();
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ev = proposal.event;
  const insights = proposal.insights ?? ev?.meta?._extraction?.insights ?? [];
  const pendingCount = proposal.actions.filter((a) => a.status === "pending").length;

  const requester = proposal.actions.find((a) => a.requested_by)?.requested_by ?? null;
  const requesterName = requester ? (users.find((u) => u.id === requester)?.name ?? requester) : null;

  const approveAll = async () => {
    setBusyAll(true);
    setError(null);
    try {
      await mutateAsync({ url: api(`/api/proposals/${encodeURIComponent(proposal.id)}/approve-all`), method: "post", values: {} });
    } catch (e) {
      setError(errorMessage(e, "Could not approve everything."));
    } finally {
      setBusyAll(false);
      void invalidate({ resource: "proposals", invalidates: ["list"] });
    }
  };

  const facts: string[] = [];
  if (ev) {
    facts.push(`${nameOf(ev.agent_id)} ${SOURCE_NOUN[ev.source] ?? `· ${ev.source}`}`);
    if (ev.meta?.duration_minutes) facts.push(`${ev.meta.duration_minutes} min`);
    if (ev.participants?.length) facts.push(plural(ev.participants.length, "person", "people"));
    if (ev.account) facts.push(ev.account);
  } else {
    facts.push(requesterName ? `Requested by ${requesterName}` : "Requested in a chat with an agent");
    facts.push(formatWhen(proposal.created_at));
  }

  return (
    <div className="card proposal" data-proposal={proposal.id} data-status={proposal.status}>
      <div className="row top">
        {ev ? <AgentAvatar id={ev.agent_id} size="lg" /> : <PlainAvatar glyph="💬" label="Requested in chat" size="lg" />}
        <div className="grow">
          <h2>{ev ? `${ev.title} · ${formatWhen(ev.occurred_at)}` : "Requested in chat"}</h2>
          <div className="small">{facts.filter(Boolean).join(" · ")}</div>
          {ev?.summary ? <p className="summary">{ev.summary}</p> : null}
          {insights.length ? (
            <div style={{ marginTop: 8 }}>
              {insights.map((ins, i) => (
                <InsightChip key={i} insight={ins} />
              ))}
            </div>
          ) : null}
        </div>
        {canDecide && pendingCount > 0 ? (
          <button className="btn p" disabled={busyAll} onClick={approveAll}>
            {busyAll ? "Approving…" : "Approve all"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="state error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      <div className="acts">
        {proposal.actions.map((a) => (
          <ActionRow key={a.id} action={a} canDecide={canDecide} />
        ))}
      </div>
    </div>
  );
}
