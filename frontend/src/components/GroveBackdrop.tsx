// Backdrop of the dark "Enchanted grove" theme: a live 3D grove on a fixed, full-viewport canvas behind
// the UI. The scene code (and three.js with it) is fetched with a dynamic import() only while the dark
// theme is on. If WebGL is missing, the context cannot be created, the chunk fails to load or the context
// is lost later, the flat SVG scenery is shown instead.
import { useEffect, useRef, useState } from "react";
import { SFX_VOLUME, sfx, sfxNameFor } from "../lib/sfx";
import { motionStore, useTheme } from "../session";
import { Scenery } from "./Scenery";
import type { GroveHandle, GroveInfo, GroveQuality } from "../grove";

declare global {
  interface Window {
    /** Debug handle for the running grove scene (undefined in the light theme or in fallback mode). */
    __mossGrove?: {
      info: () => GroveInfo;
      scene?: unknown;
      /** Viewport pixel position of each creature, so a test can click one without guessing. */
      creatureScreenPositions: () => Record<string, { x: number; y: number; visible: boolean }>;
      pick: (clientX: number, clientY: number) => string | null;
    };
  }
}

let webglSupport: boolean | null = null;
/** Cheap probe so the three.js chunk is not even requested where WebGL 2 does not work. */
function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2");
    webglSupport = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** Harmless debug switches: ?grove=high|medium|low (pin the quality), ?grove=govern (governor only, from full quality),
 *  ?grove=off (SVG fallback), ?groveFocus=stag|fox|owl|raven|tortoise|fireflies, ?groveT=seconds. */
function debugParams(): { quality: "auto" | GroveQuality; startLevel: GroveQuality | undefined; off: boolean; focus: string | null; startTime: number | undefined } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = new URLSearchParams();
  }
  const q = params.get("grove");
  const t = Number(params.get("groveT"));
  return {
    quality: q === "high" ? 0 : q === "medium" ? 1 : q === "low" ? 2 : "auto",
    startLevel: q === "govern" ? 0 : undefined,
    off: q === "off",
    focus: params.get("groveFocus"),
    startTime: params.has("groveT") && Number.isFinite(t) && t >= 0 ? Math.min(t, 3600) : undefined,
  };
}

function GroveScene({ showcase }: { showcase: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GroveHandle | null>(null);
  const showcaseRef = useRef(showcase);
  showcaseRef.current = showcase;
  useEffect(() => handleRef.current?.setShowcase(showcase), [showcase]);
  const [fallback, setFallback] = useState(() => debugParams().off || !hasWebGL());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (fallback) return;
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    let handle: GroveHandle | null = null;
    const root = document.documentElement;
    // The in-app motion preference decides, not the OS "reduce motion" setting (see session.ts).
    const onMotion = () => handle?.setReducedMotion(motionStore.get() === "off");
    let unsubscribe: (() => void) | null = null;
    const debug = debugParams();

    import("../grove")
      .then(({ createGrove }) => {
        if (cancelled) return;
        handle = createGrove(el, {
          reducedMotion: motionStore.get() === "off",
          showcase: showcaseRef.current,
          quality: debug.quality,
          startLevel: debug.startLevel,
          focus: debug.focus,
          startTime: debug.startTime,
          onFirstFrame: () => setReady(true),
          onQuality: (level) => {
            root.dataset.groveQuality = String(level);
          },
          onContextLost: () => setFallback(true),
        });
        handleRef.current = handle;
        const debugHandle = { info: handle.info, creatureScreenPositions: handle.creatureScreenPositions, pick: handle.pick };
        window.__mossGrove = import.meta.env.DEV ? { ...debugHandle, scene: handle.scene } : debugHandle;
        unsubscribe = motionStore.subscribe(onMotion);
        onMotion();
      })
      .catch((e) => {
        if (cancelled) return;
        console.info("Moss: the 3D grove could not start, showing the flat scenery instead.", e instanceof Error ? e.message : e);
        setFallback(true);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      handle?.dispose();
      handle = null;
      handleRef.current = null;
      delete window.__mossGrove;
      delete root.dataset.groveQuality;
      setReady(false);
    };
  }, [fallback]);

  // Showcase only: the layer takes pointer events (see grove.css), a click on a creature plays its sound
  // and makes it glow, and the cursor turns into a pointer over one.
  useEffect(() => {
    const el = holder.current;
    if (!el || fallback || !showcase) return;
    let frame = 0;
    let lastMove: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      lastMove = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (lastMove) el.style.cursor = handleRef.current?.pick(lastMove.clientX, lastMove.clientY) ? "pointer" : "";
      });
    };
    const onClick = (e: MouseEvent) => {
      const handle = handleRef.current;
      const hit = handle?.pick(e.clientX, e.clientY) ?? null;
      const name = sfxNameFor(hit);
      if (!handle || !name) return;
      el.dataset.lastPick = name;
      handle.react(name);
      void sfx.play(name, SFX_VOLUME.click);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("click", onClick);
      if (frame) cancelAnimationFrame(frame);
      el.style.cursor = "";
    };
  }, [showcase, fallback]);

  if (fallback) return <Scenery />;
  return <div ref={holder} className={`grove-layer${ready ? " ready" : ""}`} aria-hidden="true" data-testid="grove-layer" />;
}

/** Mounted by the shell; renders nothing at all in the light theme. */
export function GroveBackdrop({ showcase = false }: { showcase?: boolean }) {
  const theme = useTheme();
  return theme === "dark" ? <GroveScene showcase={showcase} /> : null;
}
