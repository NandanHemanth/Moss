// Tiny persisted stores for the per-browser choices: demo user, theme, voice, motion.
import { useSyncExternalStore } from "react";
import { DEFAULT_USER } from "./config";

type Listener = () => void;

function persisted<T extends string>(key: string, initial: T, valid: (v: string) => boolean = () => true) {
  let value: T = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw && valid(raw)) value = raw as T;
  } catch {
    /* storage unavailable: keep the default */
  }
  const listeners = new Set<Listener>();
  return {
    get: (): T => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export type Theme = "light" | "dark";

export const userStore = persisted<string>("moss.user", DEFAULT_USER, (v) => /^[a-z0-9_-]{1,40}$/i.test(v));
export const themeStore = persisted<Theme>("moss.theme", "light", (v) => v === "light" || v === "dark");
/** Voice defaults to OFF: browsers block audio until the user clicks something. */
export const voicePrefStore = persisted<"on" | "off">("moss.voice", "off", (v) => v === "on" || v === "off");

/** In-app motion preference. Defaults to ON for everyone and deliberately ignores the OS "reduce motion"
 *  setting (Windows "Animation effects" off made the grove a still picture); the top-bar toggle turns it off. */
export const motionStore = persisted<"on" | "off">("moss.motion", "on", (v) => v === "on" || v === "off");

/** "View the grove": background music (YouTube mini-player) and creature sounds. Both default to ON. */
export const musicPrefStore = persisted<"on" | "off">("moss.groveMusic", "on", (v) => v === "on" || v === "off");
export const sfxPrefStore = persisted<"on" | "off">("moss.groveSounds", "on", (v) => v === "on" || v === "off");
export const useMusicPref = () => useSyncExternalStore(musicPrefStore.subscribe, musicPrefStore.get);
export const useSfxPref = () => useSyncExternalStore(sfxPrefStore.subscribe, sfxPrefStore.get);

export const useUserId = () => useSyncExternalStore(userStore.subscribe, userStore.get);
export const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.get);

export const useMotion = () => useSyncExternalStore(motionStore.subscribe, motionStore.get);

export function applyMotion(motion: "on" | "off") {
  document.documentElement.dataset.motion = motion;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

// ---------------------------------------------------------------- access code (hosted demo)
// When the backend is started with an access code, every /api call needs it (header X-Moss-Code, `&code=` on SSE).
const CODE_KEY = "moss.code";
type Access = { code: string; required: boolean; rejected: boolean };
let access: Access = { code: "", required: false, rejected: false };
try {
  access = { ...access, code: localStorage.getItem(CODE_KEY) ?? "" };
} catch {
  /* storage unavailable */
}
const accessListeners = new Set<Listener>();
const setAccess = (next: Access) => {
  access = next;
  try {
    if (next.code) localStorage.setItem(CODE_KEY, next.code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
  accessListeners.forEach((l) => l());
};

export const accessStore = {
  get: (): Access => access,
  code: (): string => access.code,
  /** A valid code was entered. */
  accept(code: string) {
    setAccess({ code, required: false, rejected: false });
  },
  /** The API answered "access code required": ask for one (a stored code that was sent is wrong, so drop it). */
  demand() {
    if (access.required && !access.code) return;
    setAccess({ code: "", required: true, rejected: access.code !== "" });
  },
  subscribe(l: Listener) {
    accessListeners.add(l);
    return () => {
      accessListeners.delete(l);
    };
  },
};
export const useAccess = () => useSyncExternalStore(accessStore.subscribe, accessStore.get);
