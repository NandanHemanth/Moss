// The board's one node type, styled like an n8n node: a rounded square with the tool's icon,
// the label and a one-line subtitle underneath, and a handle on each side.
import { createContext, memo, useContext, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { END_ONLY, TRIGGER_ONLY, stepLook, type NodeType, type StepNode } from "./model";

export interface BoardState {
  types: Map<string, NodeType>;
  /** Nodes that start the workflow. */
  triggers: Set<string>;
  /** The step being shown by a test run right now. */
  active: string | null;
  /** Steps a test run has already shown. */
  ran: Set<string>;
}

export const BoardContext = createContext<BoardState>({ types: new Map(), triggers: new Set(), active: null, ran: new Set() });

function Bolt() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M7 0.5 2 7h3l-1 4.5L9.5 5h-3z" fill="currentColor" />
    </svg>
  );
}

function StepNodeView({ id, data, selected }: NodeProps<StepNode>) {
  const { types, triggers, active, ran } = useContext(BoardContext);
  const type = types.get(data.kind);
  const look = stepLook(data.kind, type?.agent_id);
  const isTrigger = triggers.has(id);
  const typeLabel = type?.label ?? data.kind;
  const subtitle = ((isTrigger && data.trigger) || data.description || "").trim();
  const cls = ["cv-node", selected ? "selected" : "", active === id ? "pulse" : "", ran.has(id) ? "ran" : ""].filter(Boolean).join(" ");

  return (
    <div className={cls} data-kind={data.kind} data-trigger={isTrigger || undefined}>
      <div className={`cv-node-box${look.plain ? " plain" : ""}`} style={{ "--c": look.color } as CSSProperties} title={type?.hint}>
        {TRIGGER_ONLY.has(data.kind) ? null : <Handle type="target" position={Position.Left} />}
        <span className="cv-node-glyph" aria-hidden="true">
          {look.glyph}
        </span>
        {isTrigger ? (
          <span className="cv-bolt" title="This step starts the workflow">
            <Bolt />
          </span>
        ) : null}
        {END_ONLY.has(data.kind) ? null : <Handle type="source" position={Position.Right} />}
      </div>
      {data.label.trim().toLowerCase() !== typeLabel.toLowerCase() ? <div className="cv-node-kind">{typeLabel}</div> : null}
      <div className="cv-node-label">{data.label || typeLabel}</div>
      {subtitle ? (
        <div className="cv-node-sub" title={subtitle}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

export const StepNodeCard = memo(StepNodeView);
