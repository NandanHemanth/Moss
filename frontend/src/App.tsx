// refine setup: data, auth, access control and live (SSE) providers, resources and routes.
import { useEffect, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Refine, type ResourceProps } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { keepPreviousData, QueryClient } from "@tanstack/react-query";
import { LiveContext, Shell } from "./components/Shell";
import { AskPage } from "./pages/Ask";
import { ClearingPage } from "./pages/Clearing";
import { GraphPage } from "./pages/Graph";
import { MemoryPage } from "./pages/Memory";
import { TimelinePage } from "./pages/Timeline";
import { accessControlProvider } from "./providers/accessControlProvider";
import { authProvider } from "./providers/authProvider";
import { dataProvider } from "./providers/dataProvider";
import { createLiveProvider } from "./providers/liveProvider";
import { useUserId } from "./session";

const resources: ResourceProps[] = [
  { name: "proposals", list: "/", meta: { label: "Clearing" } },
  { name: "commitments" },
  { name: "notifications" },
  { name: "timeline", list: "/timeline" },
  // read-only lookups
  { name: "agents" },
  { name: "accounts" },
  { name: "users" },
];

/** Everything below is keyed by the selected demo user: switching users rebuilds the query cache,
 *  identity, permissions and the SSE connection from scratch, so nothing leaks between roles. */
function MossForUser({ userId }: { userId: string }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 2_000, placeholderData: keepPreviousData },
        },
      }),
    [userId],
  );
  const liveProvider = useMemo(() => createLiveProvider(userId), [userId]);

  useEffect(() => {
    liveProvider.connect();
    return () => liveProvider.close();
  }, [liveProvider]);

  return (
    <LiveContext.Provider value={liveProvider}>
      <Refine
        dataProvider={dataProvider}
        authProvider={authProvider}
        accessControlProvider={accessControlProvider}
        liveProvider={liveProvider}
        routerProvider={routerProvider}
        resources={resources}
        options={{
          liveMode: "auto",
          syncWithLocation: false,
          warnWhenUnsavedChanges: false,
          disableTelemetry: true,
          reactQuery: { clientConfig: queryClient },
        }}
      >
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<ClearingPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Refine>
    </LiveContext.Provider>
  );
}

export default function App() {
  const userId = useUserId();
  return (
    <BrowserRouter>
      <MossForUser key={userId} userId={userId} />
    </BrowserRouter>
  );
}
