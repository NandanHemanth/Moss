import {
  ApartmentOutlined,
  BookOutlined,
  BugOutlined,
  MailOutlined,
  MessageOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { ComponentType } from "react";
import type { AgentId, Source } from "./types";

export const AGENT_META: Record<AgentId, { label: string; icon: ComponentType; color: string }> = {
  orchestrator: { label: "Orchestrator", icon: ApartmentOutlined, color: "#3f7d4e" },
  mail: { label: "Mail & Calendar agent", icon: MailOutlined, color: "#c2702d" },
  slack: { label: "Slack agent", icon: MessageOutlined, color: "#8a4fa3" },
  jira: { label: "Jira agent", icon: BugOutlined, color: "#2f63b5" },
  meetings: { label: "Meetings agent", icon: VideoCameraOutlined, color: "#1f8a8a" },
  confluence: { label: "Confluence agent", icon: BookOutlined, color: "#5b6b7a" },
};

export const SOURCE_LABEL: Record<Source, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  slack: "Slack",
  jira: "Jira",
  zoom: "Zoom",
  confluence: "Confluence",
};

export const SOURCE_AGENT: Record<Source, AgentId> = {
  gmail: "mail",
  calendar: "mail",
  slack: "slack",
  jira: "jira",
  zoom: "meetings",
  confluence: "confluence",
};
