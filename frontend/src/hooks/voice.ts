// Spoken notifications (manager only).
//
// For each notification: GET /api/notifications/{id}/audio.
//   200 -> play the returned audio (ElevenLabs),  204 -> speak the text with window.speechSynthesis.
// Utterances are queued so they never overlap. Muting clears the queue and stops speech at once.
// Browsers block audio until a user gesture, so voice is OFF by default and the toggle click is the gesture.
import { useSyncExternalStore } from "react";
import { rawRequest } from "../providers/http";
import { voicePrefStore } from "../session";
import type { Whisper } from "../types";

type Item = Pick<Whisper, "id" | "text">;

interface VoiceSnapshot {
  enabled: boolean;
  /** Notification id being spoken right now, if any. */
  speakingId: string | null;
  /** True when the preference is "on" from an earlier visit but this page has not had a user gesture yet. */
  needsGesture: boolean;
}

const listeners = new Set<() => void>();
const queue: Item[] = [];
let enabled = voicePrefStore.get() === "on";
let unlocked = false; // a user gesture happened on this page
let speakingId: string | null = null;
let pumping = false;
/** What is sounding right now. The whisper queue and the on-request "Listen" each have their own slot. */
interface Slot {
  cancel: (() => void) | null;
}
const whisperSlot: Slot = { cancel: null };
const listenSlot: Slot = { cancel: null };
// Shared "busy" guard: while something else is being read on request, the whisper queue holds.
let held = false;
let interrupted = false;
let releaseWaiters: Array<() => void> = [];
let snapshot: VoiceSnapshot = { enabled, speakingId, needsGesture: enabled && !unlocked };

function publish() {
  snapshot = { enabled, speakingId, needsGesture: enabled && !unlocked };
  listeners.forEach((l) => l());
}

function onFirstGesture() {
  unlocked = true;
  window.removeEventListener("pointerdown", onFirstGesture, true);
  window.removeEventListener("keydown", onFirstGesture, true);
  publish();
  void pump();
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);
}

function speakWithBrowser(text: string, slot: Slot = whisperSlot): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      slot.cancel = null;
      resolve();
    };
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.onend = finish;
    u.onerror = finish;
    // Safety net: some browsers never fire `end` (no voices installed, tab in background).
    const timer = setTimeout(finish, Math.min(45_000, 4_000 + text.length * 110));
    slot.cancel = () => {
      synth.cancel();
      finish();
    };
    try {
      synth.cancel(); // drop anything stale so the new utterance starts immediately
      synth.speak(u);
    } catch {
      finish();
    }
  });
}

function playBlob(blob: Blob, slot: Slot = whisperSlot): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      slot.cancel = null;
      resolve(ok);
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    slot.cancel = () => {
      audio.pause();
      finish(true);
    };
    audio.play().catch(() => finish(false));
  });
}

async function speak(item: Item): Promise<void> {
  let played = false;
  try {
    const res = await rawRequest(`/api/notifications/${encodeURIComponent(item.id)}/audio`, { headers: { Accept: "audio/mpeg" } });
    if (!enabled || held) return;
    if (res.status === 200) {
      const blob = await res.blob();
      if (!enabled || held) return;
      if (blob.size > 0) played = await playBlob(blob);
    }
    // 204 (no ElevenLabs key) or any error status: fall through to the browser voice.
  } catch {
    /* network error: fall back to the browser voice */
  }
  if (!played && enabled && !held) await speakWithBrowser(item.text);
}

async function pump() {
  if (pumping || !unlocked) return;
  pumping = true;
  try {
    while (enabled && queue.length) {
      if (held) {
        // something is being read on request: wait until it is over, then carry on with the queue
        await new Promise<void>((resolve) => releaseWaiters.push(resolve));
        continue;
      }
      const item = queue.shift()!;
      speakingId = item.id;
      interrupted = false;
      publish();
      await speak(item);
      // cut short by a "Listen" click: read it again afterwards instead of losing it
      if (enabled && (interrupted || held) && !queue.some((q) => q.id === item.id)) queue.unshift(item);
      speakingId = null;
      publish();
    }
  } finally {
    pumping = false;
  }
}

export const voice = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getSnapshot: () => snapshot,

  /** Call from a click handler: the click is the user gesture browsers require. */
  setEnabled(next: boolean) {
    enabled = next;
    voicePrefStore.set(next ? "on" : "off");
    if (next) {
      unlocked = true;
    } else {
      voice.stop();
    }
    publish();
  },

  /** Queue a notification to be read aloud (ignored while muted). */
  enqueue(item: Item) {
    if (!enabled) return;
    if (queue.some((q) => q.id === item.id) || speakingId === item.id) return;
    queue.push(item);
    void pump();
  },

  /** Stop the current utterance and drop everything queued. */
  stop() {
    queue.length = 0;
    interrupted = false;
    whisperSlot.cancel?.();
    if (!held) {
      // (while "Listen" is speaking, the browser voice belongs to it)
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    }
    speakingId = null;
  },
};

/** The tiny shared guard: hold the whisper queue while something else speaks. Returns the release function. */
export function holdVoice(): () => void {
  held = true;
  if (speakingId) {
    interrupted = true;
    whisperSlot.cancel?.();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
    const waiting = releaseWaiters;
    releaseWaiters = [];
    waiting.forEach((w) => w());
    void pump();
  };
}

// ---------------------------------------------------------------- "Listen": read one text aloud, on request only
// POST /api/speak {text} -> 200 audio (played) or 204 (spoken with window.speechSynthesis). It is independent of
// the whisper voice switch, never starts by itself, and holds the whisper queue while it plays.
const SPEAK_MAX = 900; // the backend caps the text at 900 characters
const listenListeners = new Set<() => void>();
let listening = false;
let listenRun = 0;
let releaseListen: (() => void) | null = null;

function setListening(next: boolean) {
  if (listening === next) return;
  listening = next;
  listenListeners.forEach((l) => l());
}

export const listen = {
  subscribe(l: () => void) {
    listenListeners.add(l);
    return () => {
      listenListeners.delete(l);
    };
  },
  getSnapshot: () => listening,

  /** Call from a click handler (the click is the user gesture). Starting again restarts from the top. */
  async start(text: string): Promise<void> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, SPEAK_MAX);
    if (!clean) return;
    listen.stop();
    const run = ++listenRun;
    releaseListen = holdVoice();
    setListening(true);
    let played = false;
    try {
      const res = await rawRequest("/api/speak", { method: "POST", body: { text: clean }, headers: { Accept: "audio/mpeg" } });
      if (run !== listenRun) return;
      if (res.status === 200) {
        const blob = await res.blob();
        if (run !== listenRun) return;
        if (blob.size > 0) played = await playBlob(blob, listenSlot);
      }
      // 204 (no ElevenLabs audio) or an error status: the browser voice reads it
    } catch {
      /* network error: the browser voice reads it */
    }
    if (run !== listenRun) return;
    if (!played) await speakWithBrowser(clean, listenSlot);
    if (run !== listenRun) return;
    releaseListen?.();
    releaseListen = null;
    setListening(false);
  },

  /** Stop at once. */
  stop() {
    if (!listening) return;
    listenRun++;
    listenSlot.cancel?.();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    releaseListen?.();
    releaseListen = null;
    setListening(false);
  },
};

export const useListening = () => useSyncExternalStore(listen.subscribe, listen.getSnapshot);

export const useVoice = () => useSyncExternalStore(voice.subscribe, voice.getSnapshot);
