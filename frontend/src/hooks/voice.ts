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
let currentAudio: HTMLAudioElement | null = null;
let cancelCurrent: (() => void) | null = null;
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

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cancelCurrent = null;
      resolve();
    };
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.onend = finish;
    u.onerror = finish;
    // Safety net: some browsers never fire `end` (no voices installed, tab in background).
    const timer = setTimeout(finish, Math.min(45_000, 4_000 + text.length * 110));
    cancelCurrent = () => {
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

function playBlob(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      cancelCurrent = null;
      resolve(ok);
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    cancelCurrent = () => {
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
    if (!enabled) return;
    if (res.status === 200) {
      const blob = await res.blob();
      if (!enabled) return;
      if (blob.size > 0) played = await playBlob(blob);
    }
    // 204 (no ElevenLabs key) or any error status: fall through to the browser voice.
  } catch {
    /* network error: fall back to the browser voice */
  }
  if (!played && enabled) await speakWithBrowser(item.text);
}

async function pump() {
  if (pumping || !unlocked) return;
  pumping = true;
  try {
    while (enabled && queue.length) {
      const item = queue.shift()!;
      speakingId = item.id;
      publish();
      await speak(item);
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
    cancelCurrent?.();
    currentAudio?.pause();
    currentAudio = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    speakingId = null;
  },
};

export const useVoice = () => useSyncExternalStore(voice.subscribe, voice.getSnapshot);
