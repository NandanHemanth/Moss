// Hosted-demo access code. GET /api/health says whether the API is locked; when it is, nothing else
// is mounted until a code has been entered and accepted. When the API is not locked this renders its children as is.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isAccessCodeError, request } from "../providers/http";
import { accessStore, useAccess } from "../session";

export function AccessGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  // null = still asking /api/health. If health cannot be reached the app mounts and shows its own error.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    request<{ ok: boolean; locked?: boolean }>("/api/health", { quiet: true })
      .then((h) => alive && setLocked(Boolean(h?.locked)))
      .catch(() => alive && setLocked(false));
    return () => {
      alive = false;
    };
  }, []);

  if (locked === null) return <div className="gate" aria-busy="true" />;
  const needsCode = access.required || (locked && !access.code);
  if (!needsCode) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Any gated call tells us whether the code is right; /api/me is the cheapest.
      await request("/api/me", { headers: { "X-Moss-Code": code }, quiet: true });
      accessStore.accept(code);
      setValue("");
    } catch (err) {
      if (isAccessCodeError(err)) {
        setError("That code is not right. Check it and try again.");
      } else if ((err as { statusCode?: number }).statusCode === 0) {
        setError("Moss cannot reach its server. Try again in a moment.");
      } else {
        // The code got through the gate; the failure is something else (e.g. an unknown saved user) that the app handles.
        accessStore.accept(code);
        setValue("");
      }
    } finally {
      setBusy(false);
    }
  };

  const hint = error ?? (access.rejected ? "The saved code is no longer accepted. Enter the current one." : null);
  return (
    <main className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="logo">
          <i aria-hidden="true" />
          Moss
        </div>
        <label htmlFor="moss-code">Access code</label>
        <input
          id="moss-code"
          className="field"
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={hint ? true : undefined}
          aria-describedby={hint ? "moss-code-hint" : undefined}
        />
        {hint ? (
          <div id="moss-code-hint" className="gate-error" role="alert">
            {hint}
          </div>
        ) : null}
        <button className="btn p big" type="submit" disabled={busy || !value.trim()}>
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
