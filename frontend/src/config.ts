/** Base URL of the Moss backend. Override with VITE_API_URL (see .env.example). */
export const API_URL: string = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");

/** Build an absolute API URL from a path such as "/api/status". */
export const api = (path: string): string => `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const DEFAULT_USER = "maya";
/** Demo users shown first in the user switcher. */
export const PINNED_USERS = ["maya", "sam"];
