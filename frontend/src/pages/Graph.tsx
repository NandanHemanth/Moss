// "/graph" — the knowledge graph as a force-directed SVG (d3-force). Hover or click a node to
// highlight its neighbours and list the facts that connect them.
import { useMemo, useState, type CSSProperties } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Empty, ErrorNote, Loading } from "../components/States";
import { useMossQuery, useRole } from "../hooks/useMoss";
import { formatDay, plural, truncate } from "../lib/format";
import type { GraphData, GraphEdge, GraphNode } from "../types";

/** Render at most this many nodes (the most connected ones) so the picture stays readable and fast. */
const MAX_NODES = 140;
const W = 960;
const H = 640;

// Mid-tone colours that read on both the notebook paper and the dark grove.
const TYPE_COLORS: Record<string, string> = {
  person: "#d9822b",
  account: "#3c8aa3",
  customer: "#2f7fb5",
  project: "#4f9d8f",
  topic: "#a05a7c",
  event: "#7765a8",
  meeting: "#8d6cc4",
  calendar: "#6f7fcf",
  decision: "#5a9a3c",
  commitment: "#c9a227",
  risk: "#c2452f",
  action: "#2fa36b",
  gmail: "#b0554d",
  slack: "#b98a1e",
  jira: "#3f6fd1",
  ticket: "#5b82c9",
  confluence: "#5f8f8f",
};
const EXTRA_COLORS = ["#8c6a3a", "#737d77", "#a0507c", "#5078a0"];
/** Types whose labels are always drawn; the rest (long fact sentences) show on hover/selection. */
const HUB_TYPES = new Set(["person", "account", "customer", "project", "topic", "event", "meeting"]);

function colorFor(type: string): string {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  let h = 0;
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}

interface SimNode extends SimulationNodeDatum, GraphNode {
  degree: number;
  r: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: GraphEdge;
}
interface Layout {
  nodes: SimNode[];
  links: Array<{ source: SimNode; target: SimNode; edge: GraphEdge }>;
  neighbours: Map<string, Set<string>>;
  viewBox: string;
  totalNodes: number;
  totalEdges: number;
}

function buildLayout(data: GraphData): Layout {
  const degree = new Map<string, number>();
  const known = new Set(data.nodes.map((n) => n.id));
  const validEdges = data.edges.filter((e) => known.has(e.source) && known.has(e.target));
  for (const e of validEdges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  let picked = data.nodes;
  if (picked.length > MAX_NODES) {
    picked = [...picked].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, MAX_NODES);
  }
  const keep = new Set(picked.map((n) => n.id));
  const nodes: SimNode[] = picked.map((n) => {
    const d = degree.get(n.id) ?? 0;
    return { ...n, degree: d, r: Math.min(16, 5 + Math.sqrt(d) * 2.2) };
  });
  const simLinks: SimLink[] = validEdges.filter((e) => keep.has(e.source) && keep.has(e.target)).map((e) => ({ source: e.source, target: e.target, edge: e }));

  const sim = forceSimulation<SimNode>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(84)
        .strength(0.45),
    )
    .force("charge", forceManyBody<SimNode>().strength(-420).distanceMax(520))
    .force("center", forceCenter(W / 2, H / 2))
    .force("x", forceX<SimNode>(W / 2).strength(0.045))
    .force("y", forceY<SimNode>(H / 2).strength(0.085))
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + 16))
    .stop();
  // Lay the graph out up front (no animation): deterministic, cheap, and nothing moves under the cursor.
  const ticks = nodes.length > 90 ? 220 : 320;
  for (let i = 0; i < ticks; i += 1) sim.tick();

  const links = simLinks.map((l) => ({ source: l.source as SimNode, target: l.target as SimNode, edge: l.edge }));
  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neighbours.has(l.source.id)) neighbours.set(l.source.id, new Set());
    if (!neighbours.has(l.target.id)) neighbours.set(l.target.id, new Set());
    neighbours.get(l.source.id)!.add(l.target.id);
    neighbours.get(l.target.id)!.add(l.source.id);
  }

  // Fit the viewBox to the laid-out nodes (plus room for labels).
  const xs = nodes.map((n) => n.x ?? 0);
  const ys = nodes.map((n) => n.y ?? 0);
  const padX = 90;
  const padY = 44;
  let minX = Math.min(...xs) - padX;
  let maxX = Math.max(...xs) + padX;
  let minY = Math.min(...ys) - padY;
  let maxY = Math.max(...ys) + padY;
  // Keep a sane aspect ratio so a tiny or very lopsided graph does not become a sliver.
  const minW = 520;
  const minH = 340;
  if (maxX - minX < minW) {
    const grow = (minW - (maxX - minX)) / 2;
    minX -= grow;
    maxX += grow;
  }
  if (maxY - minY < minH) {
    const grow = (minH - (maxY - minY)) / 2;
    minY -= grow;
    maxY += grow;
  }

  return { nodes, links, neighbours, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, totalNodes: data.nodes.length, totalEdges: validEdges.length };
}

export function GraphPage() {
  const role = useRole();
  const { data, isLoading, error, refetch } = useMossQuery<GraphData>("graph", "/api/graph");
  const layout = useMemo(() => (data && data.nodes?.length ? buildLayout({ nodes: data.nodes, edges: data.edges ?? [] }) : null), [data]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const selectedNode = layout?.nodes.find((n) => n.id === selected) ?? null;
  const focusId = hover ?? (selectedNode ? selectedNode.id : null);
  const lit = useMemo(() => {
    if (!layout) return null;
    if (focusId) return new Set([focusId, ...(layout.neighbours.get(focusId) ?? [])]);
    if (typeFilter) return new Set(layout.nodes.filter((n) => n.type === typeFilter).map((n) => n.id));
    return null;
  }, [layout, focusId, typeFilter]);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    layout?.nodes.forEach((n) => counts.set(n.type, (counts.get(n.type) ?? 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [layout]);

  const detailNode = selectedNode ?? layout?.nodes.find((n) => n.id === hover) ?? null;
  const facts = useMemo(() => {
    if (!layout || !detailNode) return [];
    // The same fact can be recorded by several events (e.g. the meeting and its calendar entry): list it once.
    const seen = new Map<string, { other: SimNode; label: string; outgoing: boolean; validAt: string; count: number }>();
    for (const l of layout.links) {
      const outgoing = l.source.id === detailNode.id;
      if (!outgoing && l.target.id !== detailNode.id) continue;
      const other = outgoing ? l.target : l.source;
      const key = `${outgoing ? ">" : "<"}|${l.edge.label}|${other.id}`;
      const prev = seen.get(key);
      const validAt = l.edge.valid_at ?? "";
      if (prev) {
        prev.count += 1;
        if (validAt > prev.validAt) prev.validAt = validAt;
      } else {
        seen.set(key, { other, label: l.edge.label, outgoing, validAt, count: 1 });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.validAt.localeCompare(a.validAt));
  }, [layout, detailNode]);

  const focusNode = focusId ? (layout?.nodes.find((n) => n.id === focusId) ?? null) : null;
  const labelAll = (layout?.nodes.length ?? 0) <= 30;
  const crowded = !!focusId && (layout?.neighbours.get(focusId)?.size ?? 0) > 8;

  return (
    <>
      <section className="main" data-page="graph">
        <h1>Knowledge graph</h1>
        <div className="small">
          {role === "manager" ? "Everything Moss remembers" : "What Moss remembers from items you are part of"}
          {layout ? ` · ${plural(layout.totalNodes, "node")}, ${plural(layout.totalEdges, "fact")}` : ""}
          {layout && layout.totalNodes > layout.nodes.length ? ` · showing the ${layout.nodes.length} most connected` : ""}
        </div>

        {isLoading ? (
          <Loading label="Tracing the roots…" />
        ) : error ? (
          <ErrorNote error={error} onRetry={() => refetch()} />
        ) : !layout ? (
          <div className="card" style={{ marginTop: 14 }}>
            <Empty title="The graph is empty">Facts appear here once Moss has processed a meeting, an email or a ticket.</Empty>
          </div>
        ) : (
          <div className="card graph-card">
            <svg
              className={`graph ${lit ? "has-focus" : ""}`}
              viewBox={layout.viewBox}
              role="img"
              aria-label={`Knowledge graph with ${layout.nodes.length} nodes`}
              onClick={() => setSelected(null)}
              data-testid="graph-svg"
            >
              <g className="edges">
                {layout.links.map((l, i) => {
                  const on = focusId ? l.source.id === focusId || l.target.id === focusId : false;
                  return <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} className={on ? "on" : ""} />;
                })}
              </g>
              <g className="nodes">
                {layout.nodes.map((n) => {
                  const on = lit ? lit.has(n.id) : true;
                  const isFocus = n.id === focusId || n.id === selected;
                  // Around a busy hub only the hub-type neighbours are labelled (the rail lists every fact anyway).
                  const showLabel = isFocus || (lit ? lit.has(n.id) && ((!!focusId && !crowded) || HUB_TYPES.has(n.type)) : labelAll || HUB_TYPES.has(n.type));
                  return (
                    <g
                      key={n.id}
                      className={`node ${on ? "on" : "dim"} ${isFocus ? "focus" : ""}`}
                      transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${n.label} (${n.type})`}
                      aria-pressed={n.id === selected}
                      data-node-type={n.type}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(n.id)}
                      onBlur={() => setHover(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected((cur) => (cur === n.id ? null : n.id));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected((cur) => (cur === n.id ? null : n.id));
                        }
                      }}
                    >
                      <circle r={n.r} style={{ "--c": colorFor(n.type) } as CSSProperties} />
                      {showLabel ? (
                        focusNode && !isFocus && lit?.has(n.id) ? (
                          // Neighbours of the focused node: push the label outwards, away from the hub.
                          <text x={(n.x ?? 0) >= (focusNode.x ?? 0) ? n.r + 5 : -(n.r + 5)} y={4} textAnchor={(n.x ?? 0) >= (focusNode.x ?? 0) ? "start" : "end"}>
                            {truncate(n.label, 28)}
                          </text>
                        ) : (
                          <text y={-(n.r + 5)} textAnchor="middle">
                            {truncate(n.label, isFocus ? 60 : 24)}
                          </text>
                        )
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        )}
      </section>

      <aside className="rail" aria-label="Graph legend and details">
        <h3>Legend</h3>
        <div className="small">Colour = node type. Click a type to spotlight it.</div>
        <div className="legend" data-section="legend">
          {types.map(([type, count]) => (
            <button key={type} type="button" className={`legend-item ${typeFilter === type ? "on" : ""}`} aria-pressed={typeFilter === type} onClick={() => setTypeFilter((t) => (t === type ? null : type))}>
              <i style={{ background: colorFor(type) }} aria-hidden="true" />
              {type}
              <span className="small">{count}</span>
            </button>
          ))}
          {layout && types.length === 0 ? <span className="small">No nodes.</span> : null}
        </div>

        <div className="lbl">Connected facts</div>
        {detailNode ? (
          <div data-section="facts">
            <div className="row" style={{ marginBottom: 6 }}>
              <i className="dot" style={{ background: colorFor(detailNode.type), width: 10, height: 10 }} aria-hidden="true" />
              <b className="grow">{detailNode.label}</b>
            </div>
            <span className="chip">{detailNode.type}</span>
            <span className="chip">{plural(facts.length, "fact")}</span>
            {selectedNode ? (
              <button className="linkish small" onClick={() => setSelected(null)}>
                Clear
              </button>
            ) : null}
            {facts.length === 0 ? <div className="small">No connections.</div> : null}
            {facts.map((f, i) => (
              <div className="wh" key={i}>
                {f.outgoing ? (
                  <>
                    <span className="small">{f.label} →</span> {f.other.label}
                  </>
                ) : (
                  <>
                    {f.other.label} <span className="small">→ {f.label} this</span>
                  </>
                )}
                <span className="meta">
                  {f.other.type}
                  {f.validAt ? ` · ${formatDay(f.validAt)}` : ""}
                  {f.count > 1 ? ` · recorded ${f.count}×` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="small">Hover or click a node to see what it is connected to.</div>
        )}
      </aside>
    </>
  );
}
