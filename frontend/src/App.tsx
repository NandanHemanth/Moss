import { Refine } from "@refinedev/core";
import { useNotificationProvider } from "@refinedev/antd";
import routerProvider, { DocumentTitleHandler } from "@refinedev/react-router";
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { AppProvider, useApp } from "./context/AppContext";
import { mockDataProvider } from "./data/mockDataProvider";
import { restDataProvider } from "./data/restDataProvider";
import { AccountList } from "./pages/accounts/AccountList";
import { AccountShow } from "./pages/accounts/AccountShow";
import { AgentsPage } from "./pages/agents/AgentsPage";
import { AskPage } from "./pages/ask/AskPage";
import { CommitmentList } from "./pages/commitments/CommitmentList";
import { EmployeeHome } from "./pages/employee/EmployeeHome";
import { ManagerHome } from "./pages/manager/ManagerHome";
import { groveTheme, lightTheme } from "./theme";

const RESOURCES = [
  { name: "accounts", list: "/accounts", show: "/accounts/:id" },
  { name: "commitments", list: "/commitments" },
  { name: "proposals" },
  { name: "meetings" },
  { name: "interactions" },
  { name: "updates" },
  { name: "risks" },
  { name: "agents", list: "/agents" },
];

const dataProvider = import.meta.env.VITE_MOSS_DATA === "mock" ? mockDataProvider : restDataProvider;

const ThemedApp = () => {
  const { mode, role } = useApp();
  const manager = role === "manager";

  return (
    <ConfigProvider theme={mode === "grove" ? groveTheme : lightTheme}>
      <AntdApp>
        <Refine
          dataProvider={dataProvider}
          routerProvider={routerProvider}
          notificationProvider={useNotificationProvider}
          resources={RESOURCES}
          options={{ syncWithLocation: false, disableTelemetry: true, warnWhenUnsavedChanges: false }}
        >
          <Routes>
            <Route element={<Shell />}>
              <Route index element={manager ? <ManagerHome /> : <EmployeeHome />} />
              <Route path="/commitments" element={<CommitmentList />} />
              <Route path="/ask" element={<AskPage />} />
              {manager && (
                <>
                  <Route path="/accounts" element={<AccountList />} />
                  <Route path="/accounts/:id" element={<AccountShow />} />
                  <Route path="/agents" element={<AgentsPage />} />
                </>
              )}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          <DocumentTitleHandler handler={() => "Moss"} />
        </Refine>
      </AntdApp>
    </ConfigProvider>
  );
};

export const App = () => (
  <BrowserRouter>
    <AppProvider>
      <ThemedApp />
    </AppProvider>
  </BrowserRouter>
);
