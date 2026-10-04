import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "../types";

type Mode = "light" | "grove";

interface AppState {
  role: Role;
  setRole: (role: Role) => void;
  mode: Mode;
  toggleMode: () => void;
  muted: boolean;
  toggleMuted: () => void;
  speak: (text: string) => void;
  user: { name: string; title: string };
}

const AppContext = createContext<AppState | null>(null);

const USERS: Record<Role, { name: string; title: string }> = {
  manager: { name: "Dana Kim", title: "Head of Customer Success" },
  employee: { name: "Priya Shah", title: "Backend Engineer" },
};

const stored = <T extends string>(key: string, fallback: T): T =>
  (localStorage.getItem(key) as T | null) ?? fallback;

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [role, setRoleState] = useState<Role>(() => stored("moss-role", "manager"));
  const [mode, setMode] = useState<Mode>(() => stored("moss-mode", "light"));
  const [muted, setMuted] = useState(() => localStorage.getItem("moss-muted") === "1");

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    localStorage.setItem("moss-mode", mode);
  }, [mode]);

  const setRole = useCallback((next: Role) => {
    localStorage.setItem("moss-role", next);
    setRoleState(next);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      localStorage.setItem("moss-muted", m ? "0" : "1");
      if (!m) window.speechSynthesis?.cancel();
      return !m;
    });
  }, []);

  // Stand-in for ElevenLabs streaming audio until the backend voice endpoint exists.
  const speak = useCallback(
    (text: string) => {
      if (muted || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    },
    [muted],
  );

  const value = useMemo<AppState>(
    () => ({
      role,
      setRole,
      mode,
      toggleMode: () => setMode((m) => (m === "light" ? "grove" : "light")),
      muted,
      toggleMuted,
      speak,
      user: USERS[role],
    }),
    [role, setRole, mode, muted, toggleMuted, speak],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
};
