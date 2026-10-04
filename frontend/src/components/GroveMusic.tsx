// Music for "View the grove": the official YouTube IFrame Player in a small VISIBLE card docked bottom-right.
// Nothing is downloaded or extracted; the video plays in YouTube's own player (privacy-enhanced host), which
// YouTube's terms require to stay visible and at least 200x200 px. Nothing is requested from YouTube until
// showcase mode is on with music enabled, and the player is removed again when showcase mode ends.
// Any failure (offline, blocked, embedding disabled) hides the card quietly and reports "unavailable".
import { useEffect, useRef, useState } from "react";
import { GROVE_MUSIC_CAPTION, GROVE_MUSIC_VIDEO_ID, GROVE_MUSIC_VOLUME } from "../config";

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  destroy(): void;
}
interface YTApi {
  Player: new (el: HTMLElement, opts: { events?: Record<string, (e: { data?: number }) => void> }) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
const EMBED_HOST = "https://www.youtube-nocookie.com";
const PLAYER = { width: 220, height: 200 };
/** How long the API script and the player may take before the music is treated as unavailable. */
const LOAD_TIMEOUT_MS = 12_000;
const FADE_MS = 650;

let apiPromise: Promise<YTApi> | null = null;
function loadApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTApi>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (why: string) => {
      window.clearTimeout(timer);
      script.remove();
      apiPromise = null; // allow another try the next time the grove is opened
      reject(new Error(why));
    };
    const timer = window.setTimeout(() => fail("timeout"), LOAD_TIMEOUT_MS);
    const earlier = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        earlier?.();
      } catch {
        /* not ours */
      }
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail("no player");
    };
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => fail("blocked");
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function embedUrl(id: string = GROVE_MUSIC_VIDEO_ID): string {
  const q = new URLSearchParams({
    enablejsapi: "1",
    autoplay: "1",
    loop: "1",
    playlist: id, // a single video only loops when it is also its own playlist
    playsinline: "1",
    controls: "1",
    rel: "0",
    origin: window.location.origin,
  });
  return `${EMBED_HOST}/embed/${encodeURIComponent(id)}?${q.toString()}`;
}

/** `active`: showcase mode is on. `enabled`: the Music toggle. `onUnavailable(true)` when it cannot play. */
export function GroveMusic({ active, enabled, onUnavailable }: { active: boolean; enabled: boolean; onUnavailable: (unavailable: boolean) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const want = active && enabled;
  const wantRef = useRef(want);
  wantRef.current = want;
  const [mounted, setMounted] = useState(false); // the card (and its iframe) exists
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const report = useRef(onUnavailable);
  report.current = onUnavailable;

  // Create the card when music is first wanted; play / pause with the toggle and the showcase.
  useEffect(() => {
    if (want && !failed) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      if (ready.current) {
        try {
          player.current?.playVideo();
        } catch {
          /* the player went away */
        }
      }
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    if (ready.current) {
      try {
        player.current?.pauseVideo();
      } catch {
        /* the player went away */
      }
    }
  }, [want, failed]);

  // Leaving showcase mode: after the fade, remove the player altogether (normal dark mode loads nothing).
  useEffect(() => {
    if (active) return;
    const t = window.setTimeout(() => {
      setMounted(false);
      setFailed(false);
      report.current(false);
    }, FADE_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  // The player itself. The iframe is made by hand (React does not manage it) so its attributes are exact.
  useEffect(() => {
    if (!mounted) return;
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    const giveUp = () => {
      if (cancelled) return;
      setFailed(true);
      setVisible(false);
      setMounted(false);
      report.current(true);
    };

    const frame = document.createElement("iframe");
    frame.width = String(PLAYER.width);
    frame.height = String(PLAYER.height);
    frame.title = `Grove music: ${GROVE_MUSIC_CAPTION.title}`;
    frame.allow = "autoplay; encrypted-media";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("frameborder", "0");
    frame.dataset.videoId = GROVE_MUSIC_VIDEO_ID;
    frame.src = embedUrl();
    el.appendChild(frame);

    const timer = window.setTimeout(() => {
      if (!ready.current) giveUp();
    }, LOAD_TIMEOUT_MS);

    loadApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(frame, {
          events: {
            onReady: () => {
              if (cancelled) return;
              ready.current = true;
              window.clearTimeout(timer);
              try {
                player.current?.setVolume(GROVE_MUSIC_VOLUME);
                if (wantRef.current) player.current?.playVideo();
                else player.current?.pauseVideo();
              } catch {
                giveUp();
              }
            },
            // 2 bad id, 5 player error, 100 removed / private, 101 and 150 embedding disabled
            onError: () => giveUp(),
          },
        });
      })
      .catch(() => giveUp());

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ready.current = false;
      try {
        player.current?.destroy();
      } catch {
        /* never became a player */
      }
      player.current = null;
      el.replaceChildren();
    };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <aside className="grove-music" data-visible={visible ? "yes" : "no"} aria-label="Grove music" aria-hidden={!visible} data-testid="grove-music">
      <div ref={holder} className="grove-music-player" style={{ width: PLAYER.width, height: PLAYER.height }} />
      <a
        className="grove-music-cap"
        href={`https://www.youtube.com/watch?v=${encodeURIComponent(GROVE_MUSIC_VIDEO_ID)}`}
        target="_blank"
        rel="noreferrer noopener"
        tabIndex={visible ? 0 : -1}
        title="Open the video on YouTube"
      >
        <b>{GROVE_MUSIC_CAPTION.title}</b>
        <span>{GROVE_MUSIC_CAPTION.channel}</span>
      </a>
    </aside>
  );
}
