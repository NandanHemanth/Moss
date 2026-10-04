// One fetch wrapper for every call to the Moss API. Adds X-Moss-User and normalises errors.
import type { HttpError } from "@refinedev/core";
import { API_URL } from "../config";
import { userStore } from "../session";

export type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url;
}

export function authHeaders(userId: string = userStore.get()): Record<string, string> {
  return { "X-Moss-User": userId };
}

function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)));
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

export interface RequestOptions {
  method?: string;
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Override the user for this call (used while switching users). */
  userId?: string;
}

/** Fetch that returns the raw Response (used for audio). Throws HttpError on network failure only. */
export async function rawRequest(url: string, opts: RequestOptions = {}): Promise<Response> {
  const full = withQuery(/^https?:\/\//.test(url) ? url : `${API_URL}${url}`, opts.query);
  const headers: Record<string, string> = { Accept: "application/json", ...authHeaders(opts.userId), ...opts.headers };
  const init: RequestInit = { method: (opts.method || "GET").toUpperCase(), headers, signal: opts.signal };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(full, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const err: HttpError = { message: `Cannot reach the Moss API at ${API_URL}. Is the backend running?`, statusCode: 0 };
    throw err;
  }
}

/** JSON request. Rejects with a refine HttpError ({ message, statusCode }). */
export async function request<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(url, opts);
  let payload: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
  }
  if (!res.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? (payload as { detail: unknown }).detail : payload;
    const err: HttpError = { message: detailToMessage(detail, `Request failed (${res.status})`), statusCode: res.status };
    throw err;
  }
  return payload as T;
}

export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message || fallback;
  }
  return fallback;
}
