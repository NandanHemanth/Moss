// Tiny inline SVG charts for the dashboard tiles. No chart library; colours come from the theme variables.
// Rules: no axes or grid in the tile versions, direct labels instead of legends, the data line is stronger
// than any reference line, and every chart has a text alternative (role="img" + <title>).
import { useId } from "react";

const scale = (v: number, d0: number, d1: number, r0: number, r1: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
const path = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
/** A round dot that keeps its size in a stretched SVG: a zero-length stroke with round caps. */
const Dot = ({ x, y, className }: { x: number; y: number; className: string }) => <path className={className} d={`M${x.toFixed(1)} ${y.toFixed(1)}h0`} vectorEffect="non-scaling-stroke" />;

/** Line over the last N values; the last point is marked. */
export function Sparkline({ values, title, height = 28 }: { values: number[]; title: string; height?: number }) {
  const id = useId();
  const W = 100;
  const H = height;
  const max = Math.max(...values, 0);
  const flat = max === 0;
  const pts = values.map((v, i): [number, number] => [scale(i, 0, Math.max(values.length - 1, 1), 2, W - 3), flat ? H - 3 : scale(v, 0, max, H - 3, 3)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="chart spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby={id} style={{ height }}>
      <title id={id}>{title}</title>
      {pts.length > 1 ? <path className={flat ? "ref" : "data"} d={path(pts)} vectorEffect="non-scaling-stroke" /> : null}
      {last && !flat ? <Dot x={last[0]} y={last[1]} className="dot-end" /> : null}
    </svg>
  );
}

/** A few bars (e.g. points per past sprint). With `labels` each bar carries its value. */
export function MiniBars({ values, title, height = 28, labels = false }: { values: number[]; title: string; height?: number; labels?: boolean }) {
  const id = useId();
  const max = Math.max(...values, 1);
  if (labels) {
    // HTML bars: text stays crisp and the values sit directly on the bars.
    return (
      <div className="bars-labelled" role="img" aria-label={title} style={{ height }}>
        {values.map((v, i) => (
          <span key={i} className="bar-col" style={{ ["--h" as string]: Math.max(0.04, v / max) }}>
            <b>{v}</b>
            <i />
          </span>
        ))}
      </div>
    );
  }
  const W = 100;
  const H = height;
  const n = Math.max(values.length, 1);
  const gap = 6;
  const bw = Math.min(18, (W - gap * (n - 1)) / n);
  return (
    <svg className="chart bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMax meet" role="img" aria-labelledby={id} style={{ height }}>
      <title id={id}>{title}</title>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * (H - 2));
        return <rect key={i} className="bar" x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={2} />;
      })}
    </svg>
  );
}

/** Sprint burn-down: points remaining (strong) against the ideal line (quiet, dashed). */
export function Burndown({ remaining, ideal, title, detailed = false }: { remaining: number[]; ideal: number[]; title: string; detailed?: boolean }) {
  const id = useId();
  const days = Math.max(ideal.length - 1, remaining.length - 1, 1);
  const top = Math.max(...ideal, ...remaining, 1);
  if (!detailed) {
    const W = 100;
    const H = 30;
    const at = (v: number, i: number): [number, number] => [scale(i, 0, days, 2, W - 3), scale(v, 0, top, H - 3, 3)];
    const rem = remaining.map(at);
    const end = rem[rem.length - 1];
    return (
      <svg className="chart burn" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby={id} style={{ height: H }}>
        <title id={id}>{title}</title>
        <path className="ref" d={path(ideal.map(at))} vectorEffect="non-scaling-stroke" />
        <path className="data" d={path(rem)} vectorEffect="non-scaling-stroke" />
        {end ? <Dot x={end[0]} y={end[1]} className="dot-end" /> : null}
      </svg>
    );
  }
  // Detail version: real pixel coordinates, direct labels on both lines, only the two day labels as an axis.
  const W = 340;
  const H = 132;
  const L = 8;
  const R = 86;
  const T = 12;
  const B = 22;
  const at = (v: number, i: number): [number, number] => [scale(i, 0, days, L, W - R), scale(v, 0, top, H - B, T)];
  const rem = remaining.map(at);
  const idl = ideal.map(at);
  const end = rem[rem.length - 1];
  const idealEnd = idl[idl.length - 1];
  const lastValue = remaining[remaining.length - 1];
  return (
    <svg className="chart burn detailed" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id}>
      <title id={id}>{title}</title>
      <line className="base" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      <path className="ref" d={path(idl)} />
      <path className="data" d={path(rem)} />
      {end ? <circle className="dot-fill" cx={end[0]} cy={end[1]} r={3.5} /> : null}
      {end ? (
        <text className="lbl-data" x={end[0] + 8} y={end[1] + 4}>
          {lastValue} remaining
        </text>
      ) : null}
      {idealEnd ? (
        <text className="lbl-ref" x={idealEnd[0] + 8} y={idealEnd[1] - 2}>
          Ideal
        </text>
      ) : null}
      <text className="lbl-ref" x={L} y={H - 6}>
        Day 0
      </text>
      <text className="lbl-ref" x={W - R} y={H - 6} textAnchor="end">
        Day {days}
      </text>
    </svg>
  );
}

/** Spend against a budget: month-to-date (solid), forecast (light) and a tick at the budget. */
export function BudgetBar({ spent, forecast, budget, title }: { spent: number; forecast: number; budget: number; title: string }) {
  const max = Math.max(budget, forecast, spent, 1) * 1.06;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  return (
    <div className={`budget ${forecast > budget ? "over" : ""}`} role="img" aria-label={title}>
      <i className="forecast" style={{ width: pct(forecast) }} />
      <i className="spent" style={{ width: pct(spent) }} />
      <i className="limit" style={{ left: pct(budget) }} />
    </div>
  );
}
