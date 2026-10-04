// Open commitments. Managers see everyone's; employees only their own (the API filters).
import { useState } from "react";
import { useUpdate, type HttpError } from "@refinedev/core";
import { useAllowed, useMossList } from "../hooks/useMoss";
import { formatDue } from "../lib/format";
import { errorMessage } from "../providers/http";
import type { Commitment } from "../types";
import { AgentAvatar } from "./AgentAvatar";
import { Empty, ErrorNote, Loading } from "./States";

export function CommitmentsTable({ title, showOwner }: { title: string; showOwner: boolean }) {
  const { data, isLoading, error, refetch } = useMossList<Commitment>("commitments", { status: "open" });
  const canEdit = useAllowed("commitments", "edit");
  const { mutateAsync } = useUpdate<Commitment, HttpError, { status: "done" | "open" }>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<Commitment | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const setStatus = async (c: Commitment, status: "done" | "open") => {
    setBusyId(c.id);
    setFailure(null);
    try {
      await mutateAsync({ resource: "commitments", id: c.id, values: { status }, mutationMode: "pessimistic", successNotification: false, errorNotification: false });
      setLastDone(status === "done" ? c : null);
    } catch (e) {
      setFailure(errorMessage(e, "Could not update the commitment."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card" data-section="commitments">
      <div className="row">
        <h2 className="grow">{title}</h2>
        {data.length ? <span className="small">{data.length} open</span> : null}
      </div>
      {isLoading ? (
        <Loading label="Loading commitments…" />
      ) : error ? (
        <ErrorNote error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <Empty title="Nothing open">{showOwner ? "No one owes anything right now." : "You have no open commitments."}</Empty>
      ) : (
        <div className="table-wrap">
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>What</th>
                {showOwner ? <th>Owner</th> : null}
                <th>Due</th>
                <th>From</th>
                <th>Account</th>
                {canEdit ? <th aria-label="Mark done" /> : null}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const due = formatDue(c.due);
                return (
                  <tr key={c.id} data-commitment={c.id}>
                    <td>
                      {c.text}
                      {c.event_title ? <div className="small">{c.event_title}</div> : null}
                    </td>
                    {showOwner ? <td>{c.owner || "Unassigned"}</td> : null}
                    <td style={{ whiteSpace: "nowrap", color: due.overdue ? "var(--warn)" : undefined }} title={due.overdue ? "Overdue" : undefined}>
                      {due.label}
                    </td>
                    <td>
                      <AgentAvatar id={c.agent_id} />
                    </td>
                    <td>{c.account || "—"}</td>
                    {canEdit ? (
                      <td style={{ textAlign: "right" }}>
                        <button className="btn" disabled={busyId === c.id} onClick={() => setStatus(c, "done")} aria-label={`Mark “${c.text}” done`}>
                          {busyId === c.id ? "Saving…" : "Done"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lastDone ? (
        <div className="small" style={{ marginTop: 10 }} role="status">
          ✓ Marked done: “{lastDone.text}”.{" "}
          <button className="linkish" disabled={busyId === lastDone.id} onClick={() => setStatus(lastDone, "open")}>
            Undo
          </button>
        </div>
      ) : null}
      {failure ? (
        <div className="state error" role="alert" style={{ marginTop: 10 }}>
          {failure}
        </div>
      ) : null}
    </div>
  );
}
