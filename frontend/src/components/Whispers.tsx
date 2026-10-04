// "Whispers": the manager's notification feed, newest first, live over SSE (refine liveMode "auto").
import { useEffect, useRef, useState } from "react";
import { useMossList } from "../hooks/useMoss";
import { useVoice } from "../hooks/voice";
import { relativeTime } from "../lib/format";
import type { Whisper } from "../types";
import { AgentAvatar, useAgentDirectory } from "./AgentAvatar";
import { VoiceToggle } from "./Shell";
import { Empty, ErrorNote, Loading } from "./States";

/** Re-render every 30 s so "2 min ago" stays honest. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Whispers() {
  const { data, isLoading, error, refetch } = useMossList<Whisper>("notifications", { limit: 20 });
  const { nameOf } = useAgentDirectory();
  const { enabled, speakingId } = useVoice();
  const now = useNow();

  // Ids present on first load are "old"; anything that shows up later animates in.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && !isLoading) seen.current = new Set(data.map((n) => n.id));

  // The API already sorts newest first; sort again so the order never depends on it.
  const items = [...data].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  return (
    <>
      <div className="voice">
        <h3>Whispers</h3>
        <VoiceToggle compact />
      </div>
      <div className="small">{enabled ? "Short status updates, read aloud" : "Short status updates from the agents"}</div>
      {isLoading ? (
        <Loading label="Listening…" />
      ) : error ? (
        <ErrorNote error={error} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <Empty title="All quiet">Updates appear here when an agent has something to tell you.</Empty>
      ) : (
        <div aria-live="polite" data-section="whispers">
          {items.map((n) => (
            <div key={n.id} className={`wh ${seen.current && !seen.current.has(n.id) ? "fresh" : ""} ${speakingId === n.id ? "speaking" : ""}`} data-whisper={n.id}>
              <div className="row top">
                <AgentAvatar id={n.agent_id} />
                <div className="grow">
                  {n.text}
                  <time dateTime={n.created_at}>
                    {n.agent_name || nameOf(n.agent_id)} · {relativeTime(n.created_at, now)}
                    {speakingId === n.id ? " · speaking…" : ""}
                  </time>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
