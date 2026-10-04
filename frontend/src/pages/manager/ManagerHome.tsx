import {
  ArrowRightOutlined,
  CheckOutlined,
  EditOutlined,
  MessageOutlined,
  NotificationOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { useCreate, useList, useUpdate } from "@refinedev/core";
import {
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  List,
  Modal,
  Row,
  Skeleton,
  Table,
  Tag,
  Timeline,
  Typography,
  theme,
} from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AGENT_META } from "../../agents";
import { AgentAvatar, HealthTag, clock, fromNow, shortDate } from "../../components/common";
import { useApp } from "../../context/AppContext";
import type { Account, Commitment, Meeting, Proposal, Risk, Update } from "../../types";

const KIND_LABEL: Record<Proposal["kind"], string> = {
  jira_issue: "Create Jira issue",
  slack_message: "Post Slack message",
  calendar_event: "Schedule meeting",
  email: "Send email",
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const Kpi = ({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: string }) => (
  <Card size="small" styles={{ body: { padding: "16px 18px" } }}>
    <Typography.Text type="secondary" className="eyebrow">
      {label}
    </Typography.Text>
    <div className="kpi-value" style={{ color: tone, marginTop: 6 }}>
      {value}
    </div>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {hint}
    </Typography.Text>
  </Card>
);

export const ManagerHome = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { user, speak } = useApp();
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");

  const proposals = useList<Proposal>({
    resource: "proposals",
    filters: [{ field: "status", operator: "eq", value: "pending" }],
    pagination: { mode: "off" },
  });
  const meetings = useList<Meeting>({ resource: "meetings", pagination: { mode: "off" }, sorters: [{ field: "startsAt", order: "asc" }] });
  const updates = useList<Update>({ resource: "updates", pagination: { pageSize: 6 }, sorters: [{ field: "createdAt", order: "desc" }] });
  const accounts = useList<Account>({ resource: "accounts", pagination: { mode: "off" } });
  const commitments = useList<Commitment>({
    resource: "commitments",
    filters: [{ field: "status", operator: "eq", value: "open" }],
    pagination: { mode: "off" },
  });
  const risks = useList<Risk>({ resource: "risks", pagination: { mode: "off" } });

  const { mutate: update } = useUpdate();
  const { mutate: create } = useCreate();

  const pending = proposals.result.data;
  const openCommitments = commitments.result.data;
  const overdue = openCommitments.filter((c) => dayjs(c.due).isBefore(dayjs()));
  const atRisk = accounts.result.data.filter((a) => a.health !== "healthy");
  const today = meetings.result.data.filter((m) => dayjs(m.startsAt).isSame(dayjs(), "day"));
  const captured = today.filter((m) => m.status === "captured");

  const groups = useMemo(() => {
    const fromMeetings = meetings.result.data.map((m) => ({
      key: `meeting-${m.id}`,
      icon: <VideoCameraOutlined style={{ color: token.colorTextSecondary }} />,
      title: m.title,
      meta: `${clock(m.startsAt)} · ${m.durationMin} min`,
      decision: m.decision,
      items: pending.filter((p) => p.meetingId === m.id),
    }));
    const fromChat = {
      key: "chat",
      icon: <MessageOutlined style={{ color: token.colorTextSecondary }} />,
      title: "Drafted in Ask Moss",
      meta: "from your questions",
      decision: undefined,
      items: pending.filter((p) => p.meetingId == null),
    };
    return [...fromMeetings, fromChat].filter((g) => g.items.length > 0);
  }, [meetings.result.data, pending, token.colorTextSecondary]);

  const decide = (items: Proposal[], status: "approved" | "dismissed") => {
    items.forEach((p) =>
      update({ resource: "proposals", id: p.id, values: { status }, successNotification: false }),
    );
    const verb = status === "approved" ? "Approved" : "Dismissed";
    message.success(`${verb} ${items.length === 1 ? KIND_LABEL[items[0].kind].toLowerCase() : `${items.length} actions`}`);
    if (status === "approved") speak(`${verb} ${items.length} action${items.length > 1 ? "s" : ""}. The agents are on it.`);
  };

  const saveEdit = () => {
    if (!editing) return;
    update({ resource: "proposals", id: editing.id, values: { summary: draft }, successNotification: false });
    setEditing(null);
    message.success("Proposal updated");
  };

  const simulateUpdate = () => {
    const text = "The Meetings agent finished the Platform Sync transcript. Three follow-ups are ready for review.";
    create({
      resource: "updates",
      values: { agent: "meetings", text, createdAt: new Date().toISOString() },
      successNotification: false,
    });
    speak(text);
  };

  const commitmentsFor = (accountId: number) => openCommitments.filter((c) => c.accountId === accountId).length;

  return (
    <div className="page">
      <Flex align="flex-end" justify="space-between" wrap gap={16} style={{ marginBottom: 20 }}>
        <div>
          <Typography.Text type="secondary">{dayjs().format("dddd, MMMM D")}</Typography.Text>
          <Typography.Title level={2} className="page-title">
            {greeting()}, {user.name.split(" ")[0]}
          </Typography.Title>
          <Typography.Text type="secondary">
            {captured.length} meetings captured today · {pending.length} actions waiting for your approval
          </Typography.Text>
        </div>
        <Flex gap={8}>
          <Button icon={<NotificationOutlined />} onClick={simulateUpdate}>
            Simulate update
          </Button>
          <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => navigate("/ask")}>
            Ask Moss
          </Button>
        </Flex>
      </Flex>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <Kpi label="Awaiting approval" value={pending.length} hint={`From ${groups.length} meetings`} />
        </Col>
        <Col xs={12} lg={6}>
          <Kpi
            label="Open commitments"
            value={openCommitments.length}
            hint={`${overdue.length} overdue`}
            tone={overdue.length ? token.colorWarning : undefined}
          />
        </Col>
        <Col xs={12} lg={6}>
          <Kpi
            label="Accounts needing attention"
            value={atRisk.length}
            hint={`${accounts.result.data.filter((a) => a.health === "at_risk").length} at risk`}
            tone={atRisk.length ? token.colorError : undefined}
          />
        </Col>
        <Col xs={12} lg={6}>
          <Kpi label="Meetings today" value={today.length} hint={`${captured.length} captured · ${today.length - captured.length} upcoming`} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            title="Needs your approval"
            extra={<Typography.Text type="secondary">Actions proposed by agents from your meetings</Typography.Text>}
            style={{ marginBottom: 16 }}
          >
            {proposals.query.isLoading ? (
              <Skeleton active />
            ) : groups.length === 0 ? (
              <Empty description="You're all caught up" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Flex vertical gap={20}>
                {groups.map(({ key, icon, title, meta, decision, items }) => (
                  <div key={key}>
                    <Flex align="center" gap={10} style={{ marginBottom: 6 }}>
                      {icon}
                      <Typography.Text strong>{title}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {meta}
                      </Typography.Text>
                      <div style={{ flex: 1 }} />
                      <Button size="small" type="link" onClick={() => decide(items, "approved")}>
                        Approve all {items.length}
                      </Button>
                    </Flex>
                    {decision && (
                      <Typography.Paragraph type="secondary" style={{ margin: "0 0 10px 24px", fontSize: 13 }}>
                        <Tag bordered={false} style={{ color: token.colorInfoText, background: token.colorInfoBg }}>
                          Decision
                        </Tag>
                        {decision}
                      </Typography.Paragraph>
                    )}
                    <Flex vertical gap={8} style={{ marginLeft: 24 }}>
                      {items.map((p) => (
                        <div
                          key={p.id}
                          className="proposal"
                          style={{
                            background: token.colorFillQuaternary,
                            borderLeftColor: AGENT_META[p.agent].color,
                          }}
                        >
                          <Flex align="flex-start" gap={12}>
                            <AgentAvatar agent={p.agent} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Flex gap={8} align="center" wrap>
                                <Typography.Text strong>{KIND_LABEL[p.kind]}</Typography.Text>
                                <Tag bordered={false}>{p.target}</Tag>
                              </Flex>
                              <Typography.Text style={{ display: "block", marginTop: 2 }}>{p.summary}</Typography.Text>
                            </div>
                            <Flex gap={6} style={{ flexShrink: 0 }}>
                              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => decide([p], "approved")}>
                                Approve
                              </Button>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                aria-label="Edit proposal"
                                onClick={() => {
                                  setEditing(p);
                                  setDraft(p.summary);
                                }}
                              />
                              <Button size="small" type="text" onClick={() => decide([p], "dismissed")}>
                                Dismiss
                              </Button>
                            </Flex>
                          </Flex>
                        </div>
                      ))}
                    </Flex>
                  </div>
                ))}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Every approval is written to the audit log before the agent acts.
                </Typography.Text>
              </Flex>
            )}
          </Card>

          <Card
            title="Accounts needing attention"
            extra={
              <Button type="link" onClick={() => navigate("/accounts")}>
                All accounts
              </Button>
            }
            styles={{ body: { padding: 0 } }}
          >
            <Table<Account>
              rowKey="id"
              size="middle"
              loading={accounts.query.isLoading}
              dataSource={atRisk}
              pagination={false}
              rowClassName="clickable-row"
              onRow={(a) => ({ onClick: () => navigate(`/accounts/${a.id}`) })}
              columns={[
                {
                  title: "Account",
                  dataIndex: "name",
                  render: (name: string, a) => (
                    <div>
                      <Typography.Text strong>{name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                        {a.segment} · {a.stage}
                      </Typography.Text>
                    </div>
                  ),
                },
                { title: "Health", dataIndex: "health", render: (h: Account["health"]) => <HealthTag health={h} /> },
                { title: "Owner", dataIndex: "owner" },
                { title: "Open commitments", key: "commitments", align: "center", render: (_, a) => commitmentsFor(a.id) },
                { title: "Last contact", dataIndex: "lastContact", render: (d: string) => fromNow(d) },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            title={
              <Flex align="center" gap={8}>
                Live updates <Badge status="processing" />
              </Flex>
            }
            extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>Spoken unless muted</Typography.Text>}
            style={{ marginBottom: 16 }}
          >
            <Timeline
              items={updates.result.data.map((u) => ({
                dot: <AgentAvatar agent={u.agent} size={22} />,
                children: (
                  <div style={{ paddingLeft: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {AGENT_META[u.agent].label} · {fromNow(u.createdAt)}
                    </Typography.Text>
                    <div>{u.text}</div>
                  </div>
                ),
              }))}
            />
          </Card>

          <Card title="Today" style={{ marginBottom: 16 }} styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}>
            <List
              dataSource={today}
              renderItem={(m) => (
                <List.Item
                  extra={
                    m.status === "captured" ? (
                      <Tag color="success" bordered={false}>
                        Notes ready
                      </Tag>
                    ) : (
                      <Tag bordered={false}>{dayjs(m.startsAt).isAfter(dayjs()) ? "Upcoming" : "Transcribing"}</Tag>
                    )
                  }
                >
                  <List.Item.Meta
                    title={m.title}
                    description={`${clock(m.startsAt)} · ${m.durationMin} min · ${m.attendees.length} attendees`}
                  />
                </List.Item>
              )}
            />
          </Card>

          <Card title="Risks the orchestrator noticed" styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}>
            <List
              dataSource={risks.result.data}
              renderItem={(r) => (
                <List.Item>
                  <Flex gap={10} align="flex-start">
                    <Tag color={r.severity === "high" ? "error" : "warning"} bordered={false} style={{ marginTop: 2 }}>
                      {r.severity === "high" ? "High" : "Medium"}
                    </Tag>
                    <div>
                      <div>{r.title}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.evidence}
                      </Typography.Text>
                    </div>
                  </Flex>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title={editing ? `Edit: ${KIND_LABEL[editing.kind]}` : ""}
        open={!!editing}
        onOk={saveEdit}
        okText="Save"
        onCancel={() => setEditing(null)}
      >
        {editing && (
          <>
            <Typography.Text type="secondary">
              {AGENT_META[editing.agent].label} · {editing.target} · proposed {shortDate(new Date().toISOString())}
            </Typography.Text>
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoSize={{ minRows: 3 }}
              style={{ marginTop: 12 }}
            />
          </>
        )}
      </Modal>
    </div>
  );
};
