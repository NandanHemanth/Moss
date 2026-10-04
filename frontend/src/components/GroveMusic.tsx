// Music for "View the grove": one audio file served by the backend (GET /api/music), looped at low volume.
// Nothing is shown on the page; the "Music on / Music off" toggle next to "Back to Moss" is the only control.
// The file is fetched the first time the grove is viewed with music on, and kept for the rest of the visit.
// 204 (no file on the server) or any failure reports "unavailable" to the toggle.
import { useEffect, useRef } from "react";
import { GROVE_MUSIC_VOLUME } from "../config";
import { rawRequest } from "../providers/http";

const FADE_IN_MS = 1400;
const FADE_OUT_MS = 600;

let trackUrl: Promise<string | null> | null = null;
/** The music as an object URL, or null when the server has none. Fetched once; a failure can be retried. */
function loadTrack(): Promise<string | null> {
  if (!trackUrl) {
    trackUrl = (async () => {
      try {
        const res = await rawRequest("/api/music", { headers: { Accept: "audio/mpeg" } });
        if (res.status !== 200) return null;
        const blob = await res.blob();
        return blob.size > 0 ? URL.createObjectURL(blob) : null;
      } catch {
        return null;
      }
    })();
    void trackUrl.then((url) => {
      if (!url) trackUrl = null; // nothing usable: try again the next time the grove is opened
    });
  }
  return trackUrl;
}

/** `active`: showcase mode is on. `enabled`: the Music toggle. `onUnavailable(true)` when it cannot play. */
export function GroveMusic({ active, enabled, onUnavailable }: { active: boolean; enabled: boolean; onUnavailable: (unavailable: boolean) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const fade = useRef(0);
  const want = active && enabled;
  const wantRef = useRef(want);
  wantRef.current = want;
  const report = useRef(onUnavailable);
  report.current = onUnavailable;

  // Move the volume towards `to`; `then` runs when it gets there. A timer, not animation frames, so a fade
  // still finishes when the tab is in the background.
  const fadeTo = (el: HTMLAudioElement, to: number, ms: number, then?: () => void) => {
    window.clearInterval(fade.current);
    const from = el.volume;
    const start = performance.now();
    const step = () => {
      const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) return;
      window.clearInterval(fade.current);
      then?.();
    };
    fade.current = window.setInterval(step, 40);
  };

  // Play with the toggle and the showcase; fade out and pause otherwise.
  useEffect(() => {
    let cancelled = false;
    let retry: (() => void) | null = null;
    const clearRetry = () => {
      if (!retry) return;
      window.removeEventListener("pointerdown", retry, true);
      window.removeEventListener("keydown", retry, true);
      retry = null;
    };

    if (!want) {
      const el = audio.current;
      if (el && !el.paused) fadeTo(el, 0, FADE_OUT_MS, () => el.pause());
      return;
    }

    void loadTrack().then((url) => {
      if (cancelled || !wantRef.current) return;
      if (!url) {
        report.current(true);
        return;
      }
      let el = audio.current;
      if (!el) {
        el = new Audio(url);
        el.loop = true;
        el.preload = "auto";
        el.volume = 0;
        el.onerror = () => report.current(true);
        audio.current = el;
      }
      const player = el;
      const start = () => {
        player
          .play()
          .then(() => {
            clearRetry();
            if (!cancelled && wantRef.current) fadeTo(player, GROVE_MUSIC_VOLUME, FADE_IN_MS);
          })
          .catch(() => {
            // The browser wants a click first (rare: "View the grove" is itself a click). Try again on the next one.
            if (cancelled || retry) return;
            retry = () => {
              clearRetry();
              if (!cancelled && wantRef.current) start();
            };
            window.addEventListener("pointerdown", retry, true);
            window.addEventListener("keydown", retry, true);
          });
      };
      start();
    });

    return () => {
      cancelled = true;
      clearRetry();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  // Leaving the grove: after the fade, rewind so the next visit starts from the beginning.
  useEffect(() => {
    if (active) return;
    const t = window.setTimeout(() => {
      const el = audio.current;
      if (el) {
        window.clearInterval(fade.current);
        el.pause();
        el.volume = 0;
        el.currentTime = 0;
      }
      report.current(false);
    }, FADE_OUT_MS + 50);
    return () => window.clearTimeout(t);
  }, [active]);

  // The page is going away (theme switch, sign-out): stop at once.
  useEffect(
    () => () => {
      window.clearInterval(fade.current);
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  return null;
}
