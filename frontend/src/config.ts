/** Base URL of the Moss backend, without a trailing slash.
 *  - `VITE_API_URL` always wins when it is set.
 *  - Production build: "" (same origin, so every call is a relative `/api/...`).
 *  - Dev server: http://localhost:8000. */
const fromEnv = (import.meta.env.VITE_API_URL ?? "").trim();
export const API_URL: string = (fromEnv || (import.meta.env.PROD ? "" : "http://localhost:8000")).replace(/\/+$/, "");

/** Build an API URL from a path such as "/api/status". Already-resolved URLs pass through unchanged. */
export function api(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_URL && (p === API_URL || p.startsWith(`${API_URL}/`))) return p;
  return `${API_URL}${p}`;
}

export const DEFAULT_USER = "maya";
/** Demo users shown first in the user switcher. */
export const PINNED_USERS = ["maya", "sam"];

/** Music for "View the grove" (dark theme, showcase mode only): the audio file the backend serves at
 *  GET /api/music. To change the track, replace the .mp3 in the backend folder (or set GROVE_MUSIC in .env). */
/** Music volume, 0–1. */
export const GROVE_MUSIC_VOLUME = 0.35;
