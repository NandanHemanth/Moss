import {
  ApartmentOutlined,
  CheckSquareOutlined,
  HomeOutlined,
  MessageOutlined,
  MoonOutlined,
  ShopOutlined,
  SoundOutlined,
  SunOutlined,
  MutedOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Flex, Input, Layout, Menu, Segmented, Tooltip, Typography, theme } from "antd";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useApp } from "../context/AppContext";
import type { Role } from "../types";
import { GroveBackdrop } from "./GroveBackdrop";

const MENU: Record<Role, { key: string; label: string; icon: React.ReactNode }[]> = {
  manager: [
    { key: "/", label: "Home", icon: <HomeOutlined /> },
    { key: "/accounts", label: "Accounts", icon: <ShopOutlined /> },
    { key: "/commitments", label: "Commitments", icon: <CheckSquareOutlined /> },
    { key: "/ask", label: "Ask Moss", icon: <MessageOutlined /> },
    { key: "/agents", label: "Agents", icon: <ApartmentOutlined /> },
  ],
  employee: [
    { key: "/", label: "Home", icon: <HomeOutlined /> },
    { key: "/commitments", label: "My commitments", icon: <CheckSquareOutlined /> },
    { key: "/ask", label: "Ask an agent", icon: <MessageOutlined /> },
  ],
};

export const Shell = () => {
  const { role, setRole, mode, toggleMode, muted, toggleMuted, user } = useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selected =
    MENU[role]
      .map((m) => m.key)
      .filter((k) => (k === "/" ? location.pathname === "/" : location.pathname.startsWith(k)))
      .pop() ?? "/";

  const switchRole = (next: Role) => {
    setRole(next);
    navigate("/");
  };

  const ask = () => {
    const q = query.trim();
    if (!q) return;
    setQuery("");
    navigate(`/ask?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <GroveBackdrop />
      <Layout className="moss-shell" style={{ minHeight: "100vh" }}>
        <Layout.Sider
          width={232}
          breakpoint="lg"
          collapsedWidth={0}
          style={{
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            position: "sticky",
            top: 0,
            height: "100vh",
          }}
        >
          <Flex vertical style={{ height: "100%" }}>
            <div className="brand">
              <div className="brand-mark">M</div>
              <div>
                <div className="brand-name">Moss</div>
                <Typography.Text type="secondary" className="eyebrow" style={{ fontSize: 10 }}>
                  {role === "manager" ? "Manager workspace" : "Employee workspace"}
                </Typography.Text>
              </div>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selected]}
              items={MENU[role]}
              onClick={({ key }) => navigate(key)}
              style={{ borderInlineEnd: "none", padding: "0 8px", background: "transparent" }}
            />
            <div style={{ flex: 1 }} />
            <Flex gap={10} align="center" style={{ padding: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <Avatar style={{ background: token.colorPrimary, color: token.colorTextLightSolid }}>
                {user.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </Avatar>
              <div style={{ lineHeight: 1.3, minWidth: 0 }}>
                <Typography.Text strong ellipsis style={{ display: "block" }}>
                  {user.name}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
                  {user.title}
                </Typography.Text>
              </div>
            </Flex>
          </Flex>
        </Layout.Sider>

        <Layout>
          <Layout.Header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              padding: "0 28px",
              height: 60,
              lineHeight: "60px",
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flex align="center" gap={12} style={{ height: "100%" }}>
              <Input
                ref={(el) => {
                  searchRef.current = el?.input ?? null;
                }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onPressEnter={ask}
                prefix={<MessageOutlined style={{ color: token.colorTextTertiary }} />}
                suffix={<kbd>Ctrl K</kbd>}
                placeholder={
                  role === "manager"
                    ? "Ask Moss anything: “What did we discuss with Acme last month?”"
                    : "Search meetings, threads, tickets and docs"
                }
                style={{ maxWidth: 560 }}
                aria-label="Ask Moss"
              />
              <div style={{ flex: 1 }} />
              <Segmented<Role>
                value={role}
                onChange={switchRole}
                options={[
                  { label: "Manager", value: "manager" },
                  { label: "Employee", value: "employee" },
                ]}
              />
              <Tooltip title={muted ? "Unmute voice updates" : "Mute voice updates"}>
                <Button
                  type="text"
                  aria-label={muted ? "Unmute voice updates" : "Mute voice updates"}
                  icon={muted ? <MutedOutlined /> : <SoundOutlined />}
                  onClick={toggleMuted}
                />
              </Tooltip>
              <Tooltip title={mode === "light" ? "Switch to Enchanted Grove" : "Switch to light mode"}>
                <Button
                  type="text"
                  aria-label="Toggle theme"
                  icon={mode === "light" ? <MoonOutlined /> : <SunOutlined />}
                  onClick={toggleMode}
                />
              </Tooltip>
            </Flex>
          </Layout.Header>
          <Layout.Content>
            <Outlet />
          </Layout.Content>
        </Layout>
      </Layout>
    </>
  );
};
