import { ArrowLeftOutlined, BulbOutlined, MessageOutlined } from "@ant-design/icons";
import { useList, useOne } from "@refinedev/core";
import {
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  List,
  Row,
  Skeleton,
  Tabs,
  Tag,
  Timeline,
  Typography,
  theme,
} from "antd";
import { useNavigate, useParams } from "react-router";
import { SOURCE_AGENT } from "../../agents";
import { AgentAvatar, HealthTag, SourceTag, fromNow, money, shortDate } from "../../components/common";
import { useApp } from "../../context/AppContext";
import type { Account, Commitment, Interaction } from "../../types";

const ConnectionMap = ({ account }: { account: Account }) => {
  const { token } = theme.useToken();
  const nodes = [
    { label: account.owner, x: 90, y: 60 },
    ...account.topics.map((t, i) => ({ label: t, x: [400, 420, 120][i % 3], y: [50, 200, 200][i % 3] })),
  ];
  return (
    <svg viewBox="0 0 520 250" style={{ width: "100%", height: 230 }} role="img" aria-label="Knowledge graph connections">
      {nodes.map((n) => (
        <line key={`l-${n.label}`} x1={260} y1={125} x2={n.x} y2={n.y} stroke={token.colorBorder} strokeWidth={1.5} />
      ))}
      <g>
        <rect x={190} y={107} width={140} height={36} rx={18} fill={token.colorPrimary} />
        <text x={260} y={130} textAnchor="middle" fontSize={13} fontWeight={600} fill={token.colorTextLightSolid}>
          {account.name}
        </text>
      </g>
      {nodes.map((n) => {
        const w = Math.max(90, n.label.length * 7.4 + 24);
        return (
          <g key={n.label}>
            <rect
              x={n.x - w / 2}
              y={n.y - 15}
              width={w}
              height={30}
              rx={15}
              fill={token.colorBgContainer}
              stroke={token.colorBorder}
            />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={12} fill={token.colorText}>
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const AccountShow = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { speak } = useApp();
  const { token } = theme.useToken();

  const { result: account, query } = useOne<Account>({ resource: "accounts", id: id ?? "" });
  const interactions = useList<Interaction>({
    resource: "interactions",
    filters: [{ field: "accountId", operator: "eq", value: Number(id) }],
    sorters: [{ field: "occurredAt", order: "desc" }],
    pagination: { mode: "off" },
  });
  const commitments = useList<Commitment>({
    resource: "commitments",
    filters: [{ field: "accountId", operator: "eq", value: Number(id) }],
    pagination: { mode: "off" },
  });

  if (query.isLoading || !account) {
    return (
      <div className="page">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const open = commitments.result.data.filter((c) => c.status === "open");

  return (
    <div className="page">
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <a onClick={() => navigate("/accounts")}>Accounts</a> }, { title: account.name }]}
      />
      <Flex align="flex-start" justify="space-between" wrap gap={16} style={{ marginBottom: 16 }}>
        <div>
          <Flex align="center" gap={10}>
            <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={() => navigate(-1)} />
            <Typography.Title level={2} className="page-title">
              {account.name}
            </Typography.Title>
            <HealthTag health={account.health} />
          </Flex>
          <Typography.Text type="secondary" style={{ marginLeft: 42 }}>
            {account.segment} · {account.stage} · owner {account.owner} · {account.touchpoints30d} touchpoints in 30 days
          </Typography.Text>
        </div>
        <Flex gap={8}>
          <Button icon={<BulbOutlined />} onClick={() => speak(account.summary)}>
            Brief me
          </Button>
          <Button
            type="primary"
            icon={<MessageOutlined />}
            onClick={() => navigate(`/ask?q=${encodeURIComponent(`What are the open commitments and next steps for ${account.name}?`)}`)}
          >
            Ask about this account
          </Button>
        </Flex>
      </Flex>

      <Card style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary" className="eyebrow">
          What we know · synthesised by the orchestrator
        </Typography.Text>
        <Typography.Paragraph style={{ fontSize: 15, margin: "8px 0 12px" }}>{account.summary}</Typography.Paragraph>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, md: 4, lg: 4, xl: 4, xxl: 4 }}
          items={[
            { key: "arr", label: "ARR", children: money(account.arr) },
            { key: "stage", label: "Stage", children: account.stage },
            { key: "last", label: "Last contact", children: fromNow(account.lastContact) },
            { key: "open", label: "Open commitments", children: open.length },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card styles={{ body: { paddingTop: 4 } }}>
            <Tabs
              items={[
                {
                  key: "timeline",
                  label: "Timeline",
                  children: (
                    <Timeline
                      style={{ marginTop: 8 }}
                      items={interactions.result.data.map((i) => ({
                        dot: <AgentAvatar agent={SOURCE_AGENT[i.source]} size={22} />,
                        children: (
                          <div style={{ paddingLeft: 4 }}>
                            <Flex gap={8} align="center" wrap>
                              <Typography.Text strong>{i.title}</Typography.Text>
                              {i.flag && (
                                <Tag color={i.flag === "needs reply" ? "warning" : "default"} bordered={false}>
                                  {i.flag}
                                </Tag>
                              )}
                            </Flex>
                            <div>{i.detail}</div>
                            <Flex gap={6} align="center" style={{ marginTop: 2 }}>
                              <SourceTag source={i.source} />
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {shortDate(i.occurredAt)}
                              </Typography.Text>
                            </Flex>
                          </div>
                        ),
                      }))}
                    />
                  ),
                },
                {
                  key: "commitments",
                  label: `Commitments (${commitments.result.data.length})`,
                  children: (
                    <List
                      dataSource={commitments.result.data}
                      locale={{ emptyText: <Empty description="No commitments" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(c) => (
                        <List.Item extra={<Tag bordered={false}>{c.status === "open" ? `Due ${shortDate(c.due)}` : "Done"}</Tag>}>
                          <List.Item.Meta title={c.title} description={`${c.owner} · from ${c.sourceLabel}`} />
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="Connections" extra={<Typography.Text type="secondary">Knowledge graph</Typography.Text>} style={{ marginBottom: 16 }}>
            <ConnectionMap account={account} />
          </Card>
          <Card title="Suggested next steps" styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}>
            <List
              dataSource={open}
              locale={{ emptyText: "Nothing outstanding" }}
              renderItem={(c) => (
                <List.Item
                  actions={[
                    <Button key="draft" size="small" type="primary" ghost>
                      Draft
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<AgentAvatar agent={SOURCE_AGENT[c.source]} />}
                    title={c.title}
                    description={
                      <span style={{ color: new Date(c.due) < new Date() ? token.colorError : undefined }}>
                        {c.owner} · due {shortDate(c.due)}
                      </span>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};
