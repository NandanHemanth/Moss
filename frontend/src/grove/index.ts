// Entry point of the 3D "Enchanted grove" backdrop. This whole folder is loaded with a dynamic import(),
// so three.js is only downloaded when the dark theme is actually shown.
//
// createGrove() owns one canvas, one WebGL context and one animation loop, and gives all of it back in
// dispose(). It throws if a WebGL context cannot be created; the caller then shows the SVG scenery.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { buildCreatures } from "./creatures";
import { FOG_DENSITY, PALETTE, buildEnvironment } from "./environment";
import { CAMERA, FRAMING } from "./layout";
import { damp, disposeTree, glowTexture, groundY } from "./util";

/** 0 = bloom + full counts, 1 = no bloom, 2 = no bloom, fewer particles and grass, lower resolution. */
export type GroveQuality = 0 | 1 | 2;

/** Everything worth tuning lives here. */
export const TUNING = {
  /** Device pixel ratio cap per quality level. */
  pixelRatio: [1.5, 1.25, 1] as const,
  /** MSAA samples of the bloom render target (quality 0 only; the other levels use the canvas's own antialiasing). */
  msaa: 2,
  /** Tone-mapping exposure behind the UI, and in "View the grove" (brighter, nothing to read over it). */
  exposure: 0.92,
  showcaseExposure: 1.15,
  bloom: { strength: 0.42, radius: 0.55, threshold: 0.9 },
  /** The governor steps quality down when the average frame takes longer than this (ms)… */
  slowFrameMs: 24,
  /** …for this many consecutive windows of `windowSeconds`. */
  slowWindows: 2,
  windowSeconds: 2.5,
  parallax: { x: 0.6, y: 0.1 },
  sway: { x: 0.26, y: 0.05 },
  /** Scene time shown by the still frame when the in-app motion preference is off. */
  stillTime: 5.5,
};

export interface GroveOptions {
  reducedMotion: boolean;
  /** "auto" picks a starting level from the GPU's name and lets the frame-time governor lower it; a number pins it. */
  quality?: "auto" | GroveQuality;
  /** With "auto": start here instead of guessing from the GPU's name. */
  startLevel?: GroveQuality;
  /** Start the scene at this time in seconds (creatures are stepped forward to it). */
  startTime?: number;
  showcase?: boolean;
  /** Debug: frame one creature (stag, fox, owl, raven, tortoise, fireflies) instead of the grove view. */
  focus?: string | null;
  onQuality?: (level: GroveQuality) => void;
  onFirstFrame?: () => void;
  onContextLost?: () => void;
}

export interface GroveInfo {
  quality: GroveQuality;
  bloom: boolean;
  pixelRatio: number;
  time: number;
  running: boolean;
  drawCalls: number;
  triangles: number;
  points: number;
  budget: Record<string, number>;
  creatures: Record<string, [number, number, number]>;
}

export interface GroveHandle {
  /** The live scene graph (for profiling in dev tools). */
  scene: THREE.Scene;
  dispose(): void;
  setReducedMotion(reduced: boolean): void;
  /** Showcase mode: the UI is faded out, so the scene may be brighter. */
  setShowcase(on: boolean): void;
  info(): GroveInfo;
}

/** Starting quality from the GPU's name: software renderers start lightest, older Intel graphics without bloom. */
function guessLevel(renderer: THREE.WebGLRenderer): GroveQuality {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 2;
    if (/intel/i.test(name) && !/iris\(r\) xe|iris xe|arc/i.test(name)) return 1;
  } catch {
    /* no name available: start at full quality and let the governor decide */
  }
  return 0;
}

export function createGrove(container: HTMLElement, options: GroveOptions): GroveHandle {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  // The context is requested here rather than by three.js, so a refusal is a quiet, catchable failure.
  let renderer: THREE.WebGLRenderer;
  try {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, stencil: false, depth: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL 2 context unavailable");
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: false, stencil: false });
  } catch (e) {
    canvas.remove();
    throw e;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  let showcase = !!options.showcase;
  const exposureTarget = () => (showcase || options.focus ? TUNING.showcaseExposure : TUNING.exposure);
  renderer.toneMappingExposure = exposureTarget();
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.mist, FOG_DENSITY);
  scene.background = PALETTE.mist.clone().multiplyScalar(0.4);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 420);

  const time = { value: 0 };
  const glow = glowTexture(128, 0, 2.2);
  const env = buildEnvironment(20261003, time);
  const creatures = buildCreatures(time, glow);
  scene.add(env.group, creatures.group);

  let reduced = options.reducedMotion;
  const auto = options.quality === "auto" || options.quality === undefined;
  let level: GroveQuality = auto ? (options.startLevel ?? guessLevel(renderer)) : (options.quality as GroveQuality);
  let composer: EffectComposer | null = null;
  let disposed = false;
  let firstFrame = true;
  let raf = 0;
  let last = 0;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  // eye height is measured from the clearing floor, so the animals keep their place in the frame
  const eyeY = groundY(0, -3) + CAMERA.eye;
  const camNow = new THREE.Vector3(CAMERA.x, eyeY, CAMERA.z);
  const focusCreature = options.focus ? creatures.list.find((c) => c.name === options.focus) : undefined;

  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, TUNING.pixelRatio[level]);

  function makeComposer(w: number, h: number) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: TUNING.msaa });
    const c = new EffectComposer(renderer, target);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), TUNING.bloom.strength, TUNING.bloom.radius, TUNING.bloom.threshold));
    c.addPass(new OutputPass());
    return c;
  }

  function resize() {
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    const pr = pixelRatio();
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (level === 0 && !composer) {
      try {
        composer = makeComposer(w, h);
      } catch {
        composer = null; // float targets unsupported: carry on without bloom
      }
    }
    if (level > 0 && composer) {
      composer.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      composer = null;
    }
    if (composer) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    }
    if (focusCreature) {
      camera.clearViewOffset();
      camera.fov = 30;
      camera.aspect = w / h;
      env.setPointScale((h * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
    } else {
      // A level camera with the frame shifted upwards: the horizon sits low in the viewport (the ground is
      // the open band under the UI) and tree trunks stay upright.
      const up = (1 - FRAMING.horizon) * FRAMING.span;
      const fullH = (h * 2 * up) / FRAMING.span;
      camera.fov = (2 * Math.atan(up) * 180) / Math.PI;
      camera.aspect = w / fullH;
      camera.setViewOffset(w, fullH, 0, 0, w, h);
      env.setPointScale((h * pr) / FRAMING.span);
      creatures.swarm.uniforms.uScale.value = (h * pr) / FRAMING.span;
    }
    if (focusCreature) creatures.swarm.uniforms.uScale.value = (h * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.updateProjectionMatrix();
  }

  function setLevel(next: GroveQuality) {
    if (next === level) return;
    level = next;
    env.setQuality(level);
    creatures.swarm.points.geometry.setDrawRange(0, level >= 2 ? Math.round(creatures.swarm.count * 0.6) : creatures.swarm.count);
    resize();
    options.onQuality?.(level);
  }

  function step(dt: number) {
    time.value += dt;
    env.update(time.value);
    creatures.update(dt, time.value, camNow);
  }

  function placeCamera(dt: number) {
    if (focusCreature) {
      const f = focusCreature.focus;
      const d = focusCreature.size * 2.9;
      camera.position.set(f.x + d * 0.42, f.y + d * 0.16, f.z + d * 0.9);
      camera.lookAt(f);
      camNow.copy(camera.position);
      return;
    }
    const t = time.value;
    const still = reduced ? 0 : 1;
    mouse.sx = damp(mouse.sx, mouse.x * still, 2.2, dt);
    mouse.sy = damp(mouse.sy, mouse.y * still, 2.2, dt);
    camNow.set(
      CAMERA.x + mouse.sx * TUNING.parallax.x + Math.sin(t * 0.11) * TUNING.sway.x * still,
      eyeY - mouse.sy * TUNING.parallax.y + Math.sin(t * 0.17 + 1.3) * TUNING.sway.y * still,
      CAMERA.z,
    );
    camera.position.copy(camNow);
    camera.lookAt(CAMERA.x - mouse.sx * 0.9, camNow.y, CAMERA.targetZ);
  }

  function render(dt = 1) {
    renderer.toneMappingExposure = damp(renderer.toneMappingExposure, exposureTarget(), 2.2, dt);
    if (Math.abs(renderer.toneMappingExposure - exposureTarget()) < 0.002) renderer.toneMappingExposure = exposureTarget();
    renderer.info.reset();
    if (composer) composer.render();
    else renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame?.();
    }
  }

  // ---- frame-time governor
  let warm = 3;
  let acc = 0;
  let frames = 0;
  let slow = 0;
  function govern(raw: number) {
    if (!auto || level >= 2) return;
    if (warm > 0) {
      warm -= raw;
      return;
    }
    // One long gap (the machine slept, the window was covered) must not look like two slow windows, so a
    // single frame counts for at most a second; visibility changes reset the window as well.
    acc += Math.min(raw, 1);
    frames++;
    if (acc < TUNING.windowSeconds) return;
    const avgMs = (acc / frames) * 1000;
    acc = 0;
    frames = 0;
    slow = avgMs > TUNING.slowFrameMs ? slow + 1 : 0;
    if (slow >= TUNING.slowWindows) {
      slow = 0;
      warm = 1.5;
      setLevel((level + 1) as GroveQuality);
    }
  }

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(raw, 0), 0.1);
    step(dt);
    placeCamera(dt);
    render(dt);
    govern(raw);
  }
  function start() {
    if (raf || disposed || reduced || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function renderStill() {
    if (disposed) return;
    placeCamera(0);
    render(100); // no easing: jump straight to the target exposure
  }

  // ---- events
  const onResize = () => {
    resize();
    if (!raf) renderStill();
  };
  const onVisibility = () => {
    if (document.hidden) stop();
    else {
      warm = 2;
      acc = frames = slow = 0;
      start();
    }
  };
  const onPointer = (e: PointerEvent) => {
    mouse.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    mouse.y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  };
  // A lost context first gets a chance to come back (preventDefault allows the browser to restore it; three.js
  // re-creates its GPU state on "webglcontextrestored"). Only if it stays lost does the caller fall back.
  let lostTimer = 0;
  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    if (disposed) return;
    window.clearTimeout(lostTimer);
    lostTimer = window.setTimeout(() => {
      if (!disposed && renderer.getContext().isContextLost()) options.onContextLost?.();
    }, 4000);
  };
  const onRestored = () => {
    window.clearTimeout(lostTimer);
    if (disposed) return;
    warm = 3;
    acc = frames = slow = 0;
    // three.js resets its own state in its listener; ours may run first, so resume on the next task
    window.setTimeout(() => {
      if (disposed) return;
      resize();
      if (reduced || document.hidden) renderStill();
      start();
    }, 0);
  };
  // Safety net: whatever paused the loop (a missed visibility event, a restored context, bfcache), it is
  // started again within two seconds as long as motion is on and the page is visible. start() is a no-op otherwise.
  const watchdog = window.setInterval(() => {
    if (!raf && !disposed && !reduced && !document.hidden && !renderer.getContext().isContextLost()) start();
  }, 2000);
  const onShow = () => onVisibility();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onPointer, { passive: true });
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  window.addEventListener("pageshow", onShow);
  window.addEventListener("focus", onShow);

  // ---- go
  env.setQuality(level);
  resize();
  const startAt = options.startTime ?? (reduced ? TUNING.stillTime : 0);
  for (let t = 0; t < startAt; t += 1 / 30) step(1 / 30);
  step(0);
  if (reduced || document.hidden) {
    renderStill();
    // once more on the next frame, in case the browser had not laid the page out yet
    requestAnimationFrame(() => {
      if (!raf) {
        resize();
        renderStill();
      }
    });
  }
  start();
  if (level > 0) options.onQuality?.(level);

  return {
    scene,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.clearInterval(watchdog);
      window.clearTimeout(lostTimer);
      disposeTree(scene);
      glow.dispose();
      if (composer) {
        composer.dispose();
        composer.renderTarget1.dispose();
        composer.renderTarget2.dispose();
        composer = null;
      }
      renderer.dispose();
      // hand the GPU context back now instead of waiting for garbage collection (browsers cap live contexts)
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      canvas.remove();
    },
    setReducedMotion(next) {
      if (next === reduced) return;
      reduced = next;
      if (reduced) {
        stop();
        renderStill();
      } else start();
    },
    setShowcase(on) {
      if (on === showcase) return;
      showcase = on;
      if (!raf) renderStill();
    },
    info() {
      const out: GroveInfo = {
        quality: level,
        bloom: !!composer,
        pixelRatio: renderer.getPixelRatio(),
        time: time.value,
        running: raf !== 0,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        budget: { ...env.budget, swarm: creatures.swarm.count },
        creatures: {},
      };
      for (const c of creatures.list) out.creatures[c.name] = [c.focus.x, c.focus.y, c.focus.z].map((v) => Math.round(v * 100) / 100) as [number, number, number];
      return out;
    },
  };
}
