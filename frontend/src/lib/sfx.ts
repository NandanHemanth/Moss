// Creature sound effects for "View the grove".
//
// GET /api/sfx/{name} -> MP3 (decoded once, kept in memory), or 204 when the backend has none. When a
// sound is missing or cannot be decoded, a soft short tone is synthesised instead (one gentle pitch per
// creature), so a click always gives feedback. Only one sound plays at a time.
import { rawRequest } from "../providers/http";
import { sfxPrefStore } from "../session";

export const SFX_NAMES = ["stag", "fox", "owl", "raven", "tortoise", "firefly"] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Volume of a clicked creature and of the occasional ambient call. */
export const SFX_VOLUME = { click: 0.5, ambient: 0.12 };
/** Ambient: one random creature every 18–40 s while the grove is being viewed. */
export const AMBIENT_SECONDS: [number, number] = [18, 40];

/** Fallback tone per creature (Hz): low for the big animals, high for the firefly. */
const TONE: Record<SfxName, number> = { stag: 196, tortoise: 147, fox: 330, owl: 262, raven: 220, firefly: 880 };

type Ctx = AudioContext;
let ctx: Ctx | null = null;
const buffers = new Map<SfxName, AudioBuffer | null>(); // null = nothing usable: synthesise
const loading = new Map<SfxName, Promise<AudioBuffer | null>>();
let stopCurrent: (() => void) | null = null;
let playing = false;
let ticket = 0;

function context(): Ctx | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

function load(name: SfxName, ac: Ctx): Promise<AudioBuffer | null> {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name) ?? null);
  let p = loading.get(name);
  if (!p) {
    p = (async () => {
      let buffer: AudioBuffer | null = null;
      try {
        const res = await rawRequest(`/api/sfx/${name}`, { headers: { Accept: "audio/mpeg" } });
        if (res.status === 200) {
          const bytes = await res.arrayBuffer();
          if (bytes.byteLength > 0) buffer = await ac.decodeAudioData(bytes);
        }
        // 204 (none available) or any error status: keep null, the tone is used instead
      } catch {
        buffer = null; // network or decode failure
      }
      buffers.set(name, buffer);
      loading.delete(name);
      return buffer;
    })();
    loading.set(name, p);
  }
  return p;
}

function finishAfter(done: () => void): () => void {
  let over = false;
  return () => {
    if (over) return;
    over = true;
    done();
  };
}

function playBuffer(ac: Ctx, buffer: AudioBuffer, volume: number) {
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = buffer;
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(ac.destination);
  const end = finishAfter(() => {
    playing = false;
    stopCurrent = null;
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      /* already gone */
    }
  });
  src.onended = end;
  stopCurrent = () => {
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* not started */
    }
    end();
  };
  playing = true;
  src.start();
  // safety net in case `ended` never fires (suspended context)
  window.setTimeout(end, Math.ceil(buffer.duration * 1000) + 1500);
}

/** A soft sine with a slow attack and a long tail, a fifth above mixed in very quietly. */
function playTone(ac: Ctx, hz: number, volume: number) {
  const now = ac.currentTime;
  const length = 0.7;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0002, volume * 0.5), now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
  gain.connect(ac.destination);
  const oscs = [hz, hz * 1.5].map((f, i) => {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, now);
    if (i === 0) o.connect(gain);
    else {
      const g = ac.createGain();
      g.gain.value = 0.22;
      o.connect(g);
      g.connect(gain);
    }
    return o;
  });
  const end = finishAfter(() => {
    playing = false;
    stopCurrent = null;
    try {
      gain.disconnect();
    } catch {
      /* already gone */
    }
  });
  oscs[0].onended = end;
  stopCurrent = () => {
    for (const o of oscs) {
      try {
        o.onended = null;
        o.stop();
      } catch {
        /* not started */
      }
    }
    end();
  };
  playing = true;
  for (const o of oscs) {
    o.start(now);
    o.stop(now + length + 0.05);
  }
  window.setTimeout(end, (length + 1) * 1000);
}

export const sfx = {
  enabled: () => sfxPrefStore.get() === "on",
  isPlaying: () => playing,

  /** Play one creature's sound. `interrupt: false` (ambient) gives way to whatever is already playing.
   *  Resolves to what was played: "sample", "tone", or null when nothing was (sounds off, busy, no audio). */
  async play(name: SfxName, volume: number, opts: { interrupt?: boolean } = {}): Promise<"sample" | "tone" | null> {
    if (!sfx.enabled()) return null;
    const interrupt = opts.interrupt ?? true;
    if (playing && !interrupt) return null;
    const ac = context();
    if (!ac) return null;
    const mine = ++ticket;
    try {
      if (ac.state === "suspended") void ac.resume().catch(() => {});
    } catch {
      /* ignore */
    }
    const buffer = await load(name, ac);
    // a newer request, the toggle or a hidden tab may have arrived while the sound was loading
    if (mine !== ticket || !sfx.enabled()) return null;
    if (playing) {
      if (!interrupt) return null;
      stopCurrent?.();
    }
    try {
      if (buffer) {
        playBuffer(ac, buffer, volume);
        return "sample";
      }
      playTone(ac, TONE[name], volume);
      return "tone";
    } catch {
      playing = false;
      stopCurrent = null;
      return null;
    }
  },

  stop() {
    ticket++;
    stopCurrent?.();
  },
};

/** Grove creature name ("fireflies") to sound name ("firefly"). */
export function sfxNameFor(creature: string | null | undefined): SfxName | null {
  if (!creature) return null;
  const n = creature === "fireflies" ? "firefly" : creature;
  return (SFX_NAMES as readonly string[]).includes(n) ? (n as SfxName) : null;
}
