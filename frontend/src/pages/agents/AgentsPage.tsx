import { DatabaseOutlined, NodeIndexOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Badge, Card, Col, Flex, Row, Tag, Typography } from "antd";
import { AgentAvatar, fromNow } from "../../components/common";
import type { Agent } from "../../types";

const STATUS: Record<Agent["status"], "success" | "processing" | "default"> = {
  live: "success",
  syncing: "processing",
  idle: "default",
};

const MEMORY = [
  { icon: <ThunderboltOutlined />, name: "Cache", role: "Short-lived answers and API responses, expired on a TTL." },
  { icon: <NodeIndexOutlined />, name: "Knowledge graph", role: "Links people, accounts, topics and decisions across every tool." },
  { icon: <DatabaseOutlined />, name: "Database", role: "Durable records: accounts, commitments, approvals and the audit log." },
];

export const AgentsPage = () => {
  const { result } = useList<Agent>({ resource: "agents", pagination: { mode: "off" } });

  return (
    <div className="page">
      <Typography.Title level={2} className="page-title">
        Agents
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        One orchestrator delegates to specialised agents. Each agent can only reach its own tool.
      </Typography.Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {result.data.map((a) => (
          <Col key={a.id} xs={24} md={12} xl={8}>
            <Card style={{ height: "100%" }}>
              <Flex gap={12} align="flex-start">
                <AgentAvatar agent={a.id} size={40} />
                <div style={{ flex: 1 }}>
                  <Flex align="center" gap={8}>
                    <Typography.Text strong>{a.name}</Typography.Text>
                    {a.managerOnly && <Tag bordered={false}>Managers only</Tag>}
                  </Flex>
                  <Typography.Text type="secondary" style={{ display: "block" }}>
                    {a.scope}
                  </Typography.Text>
                  <Flex align="center" gap={8} style={{ marginTop: 10 }}>
                    <Badge status={STATUS[a.status]} text={a.activity} />
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}>
                      {fromNow(a.updatedAt)}
                    </Typography.Text>
                  </Flex>
                </div>
              </Flex>
            </Card>
          </Col>
        ))}
      </Row>

      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Memory layers
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {MEMORY.map((m) => (
          <Col key={m.name} xs={24} md={8}>
            <Card>
              <Flex gap={12} align="flex-start">
                <span style={{ fontSize: 20 }}>{m.icon}</span>
                <div>
                  <Typography.Text strong>{m.name}</Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                    {m.role}
                  </Typography.Paragraph>
                </div>
              </Flex>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};
