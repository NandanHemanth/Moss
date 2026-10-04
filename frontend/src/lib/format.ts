// Date and text helpers. API timestamps come in two flavours:
//   "2026-10-03T22:43:26+00:00"  (created_at, UTC)   and   "2026-10-03T14:00" (occurred_at, local wall time)
// `new Date()` parses the first as UTC and the second as local time, which is what we want.

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // A bare date ("2026-10-16") would be parsed as UTC midnight; treat it as a local day instead.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isToday(value: string | null | undefined): boolean {
  const d = parseDate(value);
  return !!d && sameDay(d, new Date());
}

export function formatTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

/** "Today", "Yesterday", "Tomorrow", "Oct 3" or "Oct 3, 2025". */
export function formatDay(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const shift = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  if (sameDay(d, shift(-1))) return "Yesterday";
  if (sameDay(d, shift(1))) return "Tomorrow";
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** "today 2:00 PM", "Sep 12, 3:00 PM". */
export function formatWhen(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  const day = formatDay(d);
  const lower = day === "Today" || day === "Yesterday" || day === "Tomorrow" ? day.toLowerCase() : `${day},`;
  return `${lower} ${formatTime(value)}`;
}

/** Short due date ("Oct 16") plus whether it is in the past. */
export function formatDue(value: string | null | undefined): { label: string; overdue: boolean } {
  const d = parseDate(value);
  if (!d) return { label: "—", overdue: false };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { label: formatDay(d), overdue: d < startOfToday };
}

export function relativeTime(value: string | null | undefined, now: number = Date.now()): string {
  const d = parseDate(value);
  if (!d) return "";
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return formatDay(d);
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export const firstName = (name: string | null | undefined): string => (name || "").trim().split(/\s+/)[0] || "";

export const isHttpUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Durations: "0.03 ms", "0.87 ms", "9.4 ms", "12 ms", "850 ms", "1.2 s", "14 s". Under 10 ms keeps 1–2 decimals. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms >= 10_000) return `${Math.round(ms / 1000)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  if (Number.isInteger(ms)) return `${ms} ms`; // whole numbers (rounded by the API) get no fake precision
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export const formatCount = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—");
