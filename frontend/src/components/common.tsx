import { Avatar, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { AGENT_META, SOURCE_LABEL } from "../agents";
import { useApp } from "../context/AppContext";
import type { Account, AgentId, Source } from "../types";

dayjs.extend(relativeTime);

export const fromNow = (iso: string) => dayjs(iso).fromNow();
export const clock = (iso: string) => dayjs(iso).format("h:mm A");
export const shortDate = (iso: string) => dayjs(iso).format("MMM D");
export const money = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const AgentAvatar = ({ agent, size = 28 }: { agent: AgentId; size?: number }) => {
  const { mode } = useApp();
  const meta = AGENT_META[agent];
  const Icon = meta.icon;
  const color = mode === "grove" ? `color-mix(in srgb, ${meta.color} 55%, white)` : meta.color;
  return (
    <Tooltip title={meta.label}>
      <Avatar
        size={size}
        style={{ background: `${meta.color}${mode === "grove" ? "33" : "1f"}`, color, flexShrink: 0 }}
        icon={<Icon />}
      />
    </Tooltip>
  );
};

export const SourceTag = ({ source }: { source: Source }) => (
  <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
    {SOURCE_LABEL[source]}
  </Tag>
);

const HEALTH: Record<Account["health"], { color: string; label: string }> = {
  healthy: { color: "success", label: "Healthy" },
  watch: { color: "warning", label: "Watch" },
  at_risk: { color: "error", label: "At risk" },
};

export const HealthTag = ({ health }: { health: Account["health"] }) => (
  <Tag color={HEALTH[health].color} bordered={false}>
    {HEALTH[health].label}
  </Tag>
);
