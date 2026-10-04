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

export const useUserId = () => useSyncExternalStore(userStore.subscribe, userStore.get);
export const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.get);

export const useMotion = () => useSyncExternalStore(motionStore.subscribe, motionStore.get);

export function applyMotion(motion: "on" | "off") {
  document.documentElement.dataset.motion = motion;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
