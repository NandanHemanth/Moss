// "/canvas" — a manager's whiteboard for workflows: drag nodes and describe each one in plain language,
// or ask Stag to draw the whole flow from one sentence. Backed by /api/workflows (see docs/02-api-contract.md).
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../styles/canvas.css";
import { AgentAvatar } from "../components/AgentAvatar";
import { Empty, ErrorNote, Loading } from "../components/States";
import { useMossQuery, useRole } from "../hooks/useMoss";
import { errorMessage } from "../providers/http";
import { useTheme } from "../session";
import { BoardContext, StepNodeCard, type BoardState } from "../canvas/StepNode";
import { DRAG_TYPE, Inspector, Palette, RunPanel } from "../canvas/panels";
import {
  BLANK_SNAPSHOT,
  DEFAULT_NAME,
  END_ONLY,
  EXAMPLES,
  TRIGGER_ONLY,
  createWorkflow,
  deleteWorkflow,
  generateWorkflow,
  nextNodeId,
  snapshot,
  toFlow,
  toGraph,
  triggerIds,
  updateWorkflow,
  type Graph,
  type NodeType,
  type StepData,
  type StepNode,
  type Workflow,
} from "../canvas/model";

const NODE_TYPES: NodeTypes = { step: StepNodeCard };
const EDGE_OPTIONS: DefaultEdgeOptions = { type: "default", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } };
const FIT = { padding: 0.1, maxZoom: 1, duration: 250 };
const DELETE_KEYS = ["Backspace", "Delete"];
const LAST_KEY = "moss.canvas.last";
/** Width of a node on the board (see .cv-node in canvas.css). */
const NODE_W = 172;
const NO_TYPES: NodeType[] = [];
const NO_WORKFLOWS: Workflow[] = [];

const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* storage unavailable */
  }
};
const remembered = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

/** Something that would throw away unsaved work, waiting for an inline yes or no. */
interface Pending {
  question: string;
  yes: string;
  run: () => void;
}

function Board() {
  const theme = useTheme();
  const flow = useReactFlow<StepNode, Edge>();
  const typesQuery = useMossQuery<NodeType[]>("workflow-node-types", "/api/workflows/node-types");
  const listQuery = useMossQuery<Workflow[]>("workflows", "/api/workflows");
  const nodeTypes = Array.isArray(typesQuery.data) ? typesQuery.data : NO_TYPES;
  const workflows = Array.isArray(listQuery.data) ? listQuery.data : NO_WORKFLOWS;
  const typeMap = useMemo(() => new Map(nodeTypes.map((t) => [t.type, t])), [nodeTypes]);

  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(BLANK_SNAPSHOT);

  const [prompt, setPrompt] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingLive, setTogglingLive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runMark, setRunMark] = useState<{ active: string | null; ran: string[] }>({ active: null, ran: [] });
  const [boardVersion, setBoardVersion] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const graphRef = useRef<Graph>(graph);
  graphRef.current = graph;
  const dirty = snapshot(name, description, enabled, graph) !== saved;
  const triggers = useMemo(() => triggerIds(nodes, edges, typeMap), [nodes, edges, typeMap]);
  const board = useMemo<BoardState>(
    () => ({ types: typeMap, triggers, active: runMark.active, ran: new Set(runMark.ran) }),
    [typeMap, triggers, runMark],
  );
  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const fitSoon = useCallback(() => {
    // wait for React Flow to measure the new nodes
    window.setTimeout(() => void flow.fitView(FIT), 80);
  }, [flow]);

  // ---------- loading a board ----------
  const show = useCallback(
    (g: Graph, meta: { id: string | null; name: string; description: string; enabled: boolean; saved: boolean }) => {
      const next = toFlow(g);
      setNodes(next.nodes);
      setEdges(next.edges);
      setWorkflowId(meta.id);
      setName(meta.name || DEFAULT_NAME);
      setDescription(meta.description || "");
      setEnabled(meta.enabled);
      setSaved(meta.saved ? snapshot(meta.name || DEFAULT_NAME, meta.description || "", meta.enabled, toGraph(next.nodes, next.edges)) : BLANK_SNAPSHOT);
      setConfirmDelete(false);
      setPending(null);
      setError(null);
      setRunMark({ active: null, ran: [] });
      setBoardVersion((v) => v + 1);
      remember(meta.id);
      fitSoon();
    },
    [setNodes, setEdges, fitSoon],
  );
  const open = useCallback(
    (wf: Workflow) => {
      setSource(null);
      show(wf.graph, { id: wf.id, name: wf.name, description: wf.description, enabled: !!wf.enabled, saved: true });
    },
    [show],
  );
  const openBlank = useCallback(() => {
    setSource(null);
    show({ nodes: [], edges: [] }, { id: null, name: DEFAULT_NAME, description: "", enabled: false, saved: true });
  }, [show]);

  // Reopen the workflow this browser had open last (once the list has arrived).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !Array.isArray(listQuery.data)) return;
    restored.current = true;
    if (graphRef.current.nodes.length) return; // already building something
    const last = remembered();
    const wf = last ? listQuery.data.find((w) => w.id === last) : undefined;
    if (wf) open(wf);
  }, [listQuery.data, open]);

  /** Run `action` now, or ask first when it would discard unsaved work. */
  const guard = (question: string, yes: string, action: () => void) => {
    if (dirty && nodes.length) setPending({ question, yes, run: action });
    else action();
  };

  const pick = (id: string) => {
    if (id === (workflowId ?? "")) return;
    const wf = workflows.find((w) => w.id === id);
    guard(wf ? `Open “${wf.name}” and discard the unsaved changes?` : "Start a new workflow and discard the unsaved changes?", wf ? "Open" : "Start new", () =>
      wf ? open(wf) : openBlank(),
    );
  };

  // ---------- ask Stag ----------
  const draw = async (text: string) => {
    setPending(null);
    setDrawing(true);
    setError(null);
    try {
      const res = await generateWorkflow(text);
      show(res.graph, { id: null, name: res.name, description: res.description, enabled: false, saved: false });
      setSource(res.source);
    } catch (e) {
      setError(errorMessage(e, "Stag could not draw that workflow."));
    } finally {
      setDrawing(false);
    }
  };
  const build = (text: string) => {
    const t = text.trim();
    if (!t || drawing) return;
    guard("Replace the board with Stag's new drawing? Unsaved changes will be lost.", "Replace", () => void draw(t));
  };
  const onBuild = (e: FormEvent) => {
    e.preventDefault();
    build(prompt);
  };
  const tryExample = (text: string) => {
    setPrompt(text);
    build(text);
  };

  // ---------- editing ----------
  const addNode = useCallback(
    (kind: string, at?: { x: number; y: number }) => {
      const type = typeMap.get(kind);
      if (!type) return;
      let position = at;
      if (!position) {
        if (nodes.length) {
          const last = nodes.reduce((a, b) => (b.position.x > a.position.x ? b : a));
          position = { x: last.position.x + 270, y: last.position.y };
        } else {
          const rect = stageRef.current?.getBoundingClientRect();
          const centre = rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 200, y: 160 };
          position = { x: centre.x - NODE_W / 2, y: centre.y - 50 };
        }
      }
      const node: StepNode = {
        id: nextNodeId(nodes),
        type: "step",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        selected: true,
        data: { kind, label: type.label, trigger: "", description: "", input: "", output: "" },
      };
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
      setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
      if (!at) fitSoon();
    },
    [typeMap, nodes, flow, setNodes, setEdges, fitSoon],
  );

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE);
    if (!kind) return;
    e.preventDefault();
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // centre the node's icon under the pointer
    addNode(kind, { x: p.x - NODE_W / 2, y: p.y - 36 });
  };

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
      const from = nodes.find((n) => n.id === c.source);
      const to = nodes.find((n) => n.id === c.target);
      return !!from && !!to && !END_ONLY.has(from.data.kind) && !TRIGGER_ONLY.has(to.data.kind);
    },
    [edges, nodes],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (!isValidConnection(c)) return;
      setEdges((es) => addEdge({ ...c, id: `${c.source}-${c.target}` }, es));
    },
    [isValidConnection, setEdges],
  );

  const patchNode = (id: string, patch: Partial<StepData>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  const removeNode = (id: string) => void flow.deleteElements({ nodes: [{ id }] });
  const deselect = () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));

  // ---------- saving ----------
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const cleanName = name.trim() || DEFAULT_NAME;
    const body = { name: cleanName, description, enabled, graph };
    try {
      const wf = workflowId ? await updateWorkflow(workflowId, body) : await createWorkflow(body);
      setWorkflowId(wf.id);
      setName(cleanName);
      setSaved(snapshot(cleanName, description, enabled, graph));
      remember(wf.id);
      await listQuery.refetch();
    } catch (e) {
      setError(errorMessage(e, "Could not save the workflow."));
    } finally {
      setSaving(false);
    }
  };

  const toggleLive = async () => {
    const next = !enabled;
    if (!workflowId) {
      setEnabled(next); // saved together with the rest
      return;
    }
    // A saved workflow goes live (or stops) straight away; the rest of the board stays as it is.
    setTogglingLive(true);
    setError(null);
    try {
      await updateWorkflow(workflowId, { enabled: next });
      setEnabled(next);
      setSaved((s) => {
        try {
          return JSON.stringify({ ...(JSON.parse(s) as object), enabled: next });
        } catch {
          return s;
        }
      });
      void listQuery.refetch();
    } catch (e) {
      setError(errorMessage(e, "Could not change the Live setting."));
    } finally {
      setTogglingLive(false);
    }
  };

  const remove = async () => {
    if (!workflowId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkflow(workflowId);
      openBlank();
      await listQuery.refetch();
    } catch (e) {
      setError(errorMessage(e, "Could not delete the workflow."));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const onStep = useCallback((active: string | null, ran: string[]) => setRunMark({ active, ran }), []);
  const toggleRun = () => {
    setRunOpen((o) => !o);
    fitSoon();
  };

  const loadError = typesQuery.error || listQuery.error;
  const liveTitle = enabled
    ? "Live: matching real events start this workflow. Its actions still wait for approval."
    : "Off. Turn on to let matching real events start this workflow. Its actions still wait for approval.";

  return (
    <section className="main canvas-page" data-page="canvas">
      <div className="cv-toolbar">
        <h1>Canvas</h1>
        <select className="field compact cv-picker" aria-label="Workflow" value={workflowId ?? ""} onChange={(e) => pick(e.target.value)} data-testid="workflow-picker">
          <option value="">New workflow</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.enabled ? " · live" : ""}
            </option>
          ))}
        </select>
        <input
          className="field compact cv-name"
          aria-label="Workflow name"
          value={name}
          maxLength={80}
          placeholder="Workflow name"
          onChange={(e) => setName(e.target.value)}
          data-testid="workflow-name"
        />
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className="cv-switch"
          title={liveTitle}
          disabled={togglingLive}
          onClick={() => void toggleLive()}
          data-testid="live-switch"
        >
          <i aria-hidden="true" />
          Live
        </button>
        <span className="cv-spacer" />
        {dirty ? (
          <span className="small cv-unsaved" data-testid="unsaved">
            Unsaved changes
          </span>
        ) : null}
        <button type="button" className="btn p" disabled={!dirty || saving} onClick={() => void save()} data-testid="save">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn" aria-pressed={runOpen} onClick={toggleRun} data-testid="test-run">
          Test run
        </button>
        {confirmDelete ? (
          <span className="cv-confirm" role="group" aria-label="Confirm delete">
            <span className="small">Delete this workflow?</span>
            <button type="button" className="btn cv-danger" disabled={deleting} onClick={() => void remove()} data-testid="delete-confirm">
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={!workflowId}
            title={workflowId ? undefined : "Nothing saved to delete yet"}
            onClick={() => setConfirmDelete(true)}
            data-testid="delete"
          >
            Delete
          </button>
        )}
      </div>

      <div className="cv-stag">
        <form className="ask cv-ask" onSubmit={onBuild}>
          <AgentAvatar id="stag" />
          <input
            aria-label="Describe a workflow for Stag to draw"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="@Stag, build a workflow that… e.g. when an email reports a bug, create a Jira ticket and tell the team in Slack"
            maxLength={400}
            disabled={drawing}
            data-testid="stag-input"
          />
          <button type="submit" className="btn p" disabled={drawing || !prompt.trim()} data-testid="stag-build">
            {drawing ? "Drawing…" : "Build"}
          </button>
        </form>
        <div className="cv-stag-foot">
          {drawing ? (
            <span className="cv-status" role="status">
              <span className="spin" aria-hidden="true" />
              Stag is drawing…
            </span>
          ) : pending ? (
            <span className="cv-confirm" role="alertdialog" aria-label="Unsaved changes" data-testid="replace-confirm">
              <span>{pending.question}</span>
              <button type="button" className="btn p" onClick={pending.run} data-testid="replace-yes">
                {pending.yes}
              </button>
              <button type="button" className="btn" onClick={() => setPending(null)}>
                Keep editing
              </button>
            </span>
          ) : (
            <span className="suggestions">
              {EXAMPLES.map((ex) => (
                <button key={ex.label} type="button" className="chip suggestion" title={ex.prompt} onClick={() => tryExample(ex.prompt)}>
                  {ex.label}
                </button>
              ))}
            </span>
          )}
          {source && !drawing && !pending ? (
            <span className="small cv-source" title={description || undefined} data-testid="stag-source">
              Drawn by Stag · {source}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="state error cv-error" role="alert" data-testid="canvas-error">
          <div className="grow">{error}</div>
          <button type="button" className="btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {loadError ? (
        <ErrorNote
          error={loadError}
          onRetry={() => {
            void typesQuery.refetch();
            void listQuery.refetch();
          }}
        />
      ) : null}

      <div className="cv-work">
        {nodeTypes.length ? <Palette types={nodeTypes} onAdd={(kind) => addNode(kind)} /> : <aside className="cv-palette">{typesQuery.isLoading ? <Loading label="Loading…" /> : null}</aside>}

        <div className="cv-boardcol">
          <div className="cv-stage" ref={stageRef} onDragOver={onDragOver} onDrop={onDrop} data-testid="board">
            <BoardContext.Provider value={board}>
              <ReactFlow<StepNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                defaultEdgeOptions={EDGE_OPTIONS}
                defaultMarkerColor={null}
                deleteKeyCode={DELETE_KEYS}
                colorMode={theme}
                minZoom={0.3}
                maxZoom={1.75}
                fitView
                fitViewOptions={FIT}
                aria-label="Workflow board"
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
                <Controls showInteractive={false} fitViewOptions={FIT} />
              </ReactFlow>
            </BoardContext.Provider>

            {!nodes.length && !drawing ? (
              <div className="cv-empty" data-testid="canvas-empty">
                <div className="cv-empty-card">
                  <AgentAvatar id="stag" size="lg" />
                  <h2>Describe a workflow, and Stag draws it</h2>
                  <p className="small">Or drag a node from the left onto the board. Every action still waits for your approval.</p>
                  <div className="suggestions">
                    {EXAMPLES.map((ex) => (
                      <button key={ex.label} type="button" className="chip suggestion" title={ex.prompt} onClick={() => tryExample(ex.prompt)}>
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {drawing ? (
              <div className="cv-empty">
                <div className="cv-status" role="status">
                  <span className="spin" aria-hidden="true" />
                  Stag is drawing…
                </div>
              </div>
            ) : null}

            {selected ? (
              <Inspector
                key={selected.id}
                node={selected}
                type={typeMap.get(selected.data.kind)}
                isTrigger={triggers.has(selected.id)}
                onChange={(patch) => patchNode(selected.id, patch)}
                onRemove={() => removeNode(selected.id)}
                onClose={deselect}
              />
            ) : null}
          </div>

          {runOpen ? (
            <RunPanel
              key={boardVersion}
              workflowId={workflowId}
              name={name}
              getGraph={() => graphRef.current}
              hasNodes={nodes.length > 0}
              types={typeMap}
              onStep={onStep}
              onClose={toggleRun}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Default export: the route lazy-loads this file. */
export default function CanvasPage() {
  const role = useRole();
  if (role === undefined) {
    return (
      <section className="main canvas-page" data-page="canvas">
        <Loading label="Opening the canvas…" />
      </section>
    );
  }
  if (role !== "manager") {
    return (
      <section className="main canvas-page" data-page="canvas">
        <h1>Canvas</h1>
        <Empty title="Canvas is for managers">Workflows are built and run by managers. Ask your manager if you need one.</Empty>
      </section>
    );
  }
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  );
}

export { CanvasPage };
