// refine live provider backed by the Moss server-sent-events stream (GET /api/stream?user=<id>).
//
// SSE event      -> refine channels that get a LiveEvent (lists on those resources refetch in liveMode "auto")
//   proposal     -> resources/proposals
//   action       -> resources/proposals, resources/timeline
//   timeline     -> resources/timeline, resources/commitments, resources/accounts, resources/proposals
//   notification -> resources/notifications
// Every SSE event is also published on the "moss" channel with `type` = the SSE event name and
// `payload` = its JSON data (used for voice and for refreshing non-resource queries).
import type { LiveEvent, LiveProvider } from "@refinedev/core";
import { api } from "../config";

export type StreamState = "connecting" | "live" | "reconnecting" | "closed";

type Subscription = {
  channel: string;
  types: string[];
  callback: (event: LiveEvent) => void;
};

const ROUTES: Record<string, { resources: string[]; type: LiveEvent["type"] }> = {
  proposal: { resources: ["proposals"], type: "created" },
  action: { resources: ["proposals", "timeline"], type: "updated" },
  timeline: { resources: ["timeline", "commitments", "accounts", "proposals"], type: "created" },
  notification: { resources: ["notifications"], type: "created" },
};
const ALL_RESOURCES = ["proposals", "timeline", "commitments", "accounts", "notifications"];

export const MOSS_CHANNEL = "moss";

export interface MossLiveProvider extends LiveProvider {
  /** Open the stream (idempotent). */
  connect(): void;
  /** Close the stream and stop reconnecting. */
  close(): void;
  getState(): StreamState;
  onState(listener: () => void): () => void;
}

export function createLiveProvider(userId: string): MossLiveProvider {
  const subs = new Set<Subscription>();
  const stateListeners = new Set<() => void>();
  let source: EventSource | null = null;
  let state: StreamState = "closed";
  let hadError = false;

  const setState = (next: StreamState) => {
    if (state === next) return;
    state = next;
    stateListeners.forEach((l) => l());
  };

  const emit = (channel: string, type: string, payload: LiveEvent["payload"]) => {
    const event: LiveEvent = { channel, type, payload, date: new Date() };
    subs.forEach((s) => {
      if (s.channel === channel && (s.types.includes("*") || s.types.includes(type))) {
        try {
          s.callback(event);
        } catch (e) {
          console.warn("[moss] live subscriber failed", e);
        }
      }
    });
  };

  const handle = (kind: string) => (ev: MessageEvent) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(ev.data || "{}");
    } catch {
      /* keep {} */
    }
    const route = ROUTES[kind];
    const ids = typeof data.id === "string" ? [data.id] : undefined;
    route?.resources.forEach((r) => emit(`resources/${r}`, route.type, { ...data, ids }));
    emit(MOSS_CHANNEL, kind, data);
  };

  const connect = () => {
    if (source) return;
    setState("connecting");
    const es = new EventSource(api(`/api/stream?user=${encodeURIComponent(userId)}`));
    source = es;
    es.addEventListener("ready", () => {
      setState("live");
      if (hadError) {
        // We may have missed events while disconnected: refetch everything once.
        hadError = false;
        ALL_RESOURCES.forEach((r) => emit(`resources/${r}`, "updated", {}));
        emit(MOSS_CHANNEL, "resync", {});
      }
    });
    Object.keys(ROUTES).forEach((kind) => es.addEventListener(kind, handle(kind) as EventListener));
    es.onerror = () => {
      // EventSource retries by itself unless the server answered with a non-200 (then it is CLOSED).
      hadError = true;
      if (es.readyState === EventSource.CLOSED) {
        setState("closed");
        if (source === es) source = null;
      } else {
        setState("reconnecting");
      }
    };
  };

  const close = () => {
    source?.close();
    source = null;
    setState("closed");
  };

  return {
    subscribe({ channel, types, callback }) {
      const sub: Subscription = { channel, types, callback };
      subs.add(sub);
      return sub;
    },
    unsubscribe(sub: Subscription) {
      subs.delete(sub);
    },
    publish(event) {
      emit(event.channel, event.type, event.payload);
    },
    connect,
    close,
    getState: () => state,
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
}
