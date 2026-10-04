import { LockOutlined, SearchOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { useList, useUpdate } from "@refinedev/core";
import { Button, Card, Checkbox, Col, Flex, Input, List, Row, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router";
import { AgentAvatar, clock, shortDate } from "../../components/common";
import { useApp } from "../../context/AppContext";
import type { Agent, Commitment, Meeting } from "../../types";

const QUICK = ["My open action items", "Summarise today's Platform Sync", "Who owns PLAT-204?"];

export const EmployeeHome = () => {
  const { user } = useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const commitments = useList<Commitment>({
    resource: "commitments",
    filters: [{ field: "owner", operator: "eq", value: user.name }],
    sorters: [{ field: "due", order: "asc" }],
    pagination: { mode: "off" },
  });
  const meetings = useList<Meeting>({ resource: "meetings", pagination: { mode: "off" }, sorters: [{ field: "startsAt", order: "asc" }] });
  const agents = useList<Agent>({ resource: "agents", pagination: { mode: "off" } });
  const { mutate } = useUpdate();

  const mine = meetings.result.data.filter(
    (m) => dayjs(m.startsAt).isSame(dayjs(), "day") && m.attendees.includes(user.name),
  );
  const open = commitments.result.data.filter((c) => c.status === "open");

  const search = (q: string) => {
    if (q.trim()) navigate(`/ask?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="page">
      <Flex vertical align="center" style={{ padding: "28px 0 32px", textAlign: "center" }}>
        <Typography.Text type="secondary">{dayjs().format("dddd, MMMM D")}</Typography.Text>
        <Typography.Title level={1} className="page-title" style={{ fontSize: 36 }}>
          What do you need to know, {user.name.split(" ")[0]}?
        </Typography.Title>
        <Typography.Text type="secondary" style={{ marginTop: 6 }}>
          Search every meeting, thread, ticket and doc you have access to.
        </Typography.Text>
        <Input.Search
          size="large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={search}
          enterButton={<SearchOutlined />}
          placeholder="e.g. Where's the spec for the payroll sync API?"
          style={{ maxWidth: 680, marginTop: 20 }}
          aria-label="Search"
        />
        <Flex gap={8} wrap justify="center" style={{ marginTop: 12 }}>
          {QUICK.map((q) => (
            <Button key={q} size="small" shape="round" onClick={() => search(q)}>
              {q}
            </Button>
          ))}
        </Flex>
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title="Things you said you'd do"
            extra={
              <Button type="link" onClick={() => navigate("/commitments")}>
                View all
              </Button>
            }
            styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}
          >
            <List
              dataSource={commitments.result.data}
              renderItem={(c) => {
                const overdue = c.status === "open" && dayjs(c.due).isBefore(dayjs());
                return (
                  <List.Item>
                    <Flex gap={12} align="flex-start" style={{ width: "100%" }}>
                      <Checkbox
                        style={{ marginTop: 3 }}
                        checked={c.status === "done"}
                        aria-label={`Mark "${c.title}" done`}
                        onChange={(e) =>
                          mutate({
                            resource: "commitments",
                            id: c.id,
                            values: { status: e.target.checked ? "done" : "open" },
                            successNotification: false,
                          })
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <Typography.Text delete={c.status === "done"} strong={c.status === "open"}>
                          {c.title}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                          From {c.sourceLabel} · due {shortDate(c.due)}
                        </Typography.Text>
                      </div>
                      {overdue && (
                        <Tag color="error" bordered={false}>
                          Overdue
                        </Tag>
                      )}
                    </Flex>
                  </List.Item>
                );
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", padding: "8px 0" }}>
              {open.length} open · ticking one off updates the linked Jira issue
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Your day" styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}>
            <List
              dataSource={mine}
              locale={{ emptyText: "No meetings today" }}
              renderItem={(m) => (
                <List.Item
                  extra={
                    m.status === "captured" ? (
                      <Tag color="success" bordered={false}>
                        Notes ready
                      </Tag>
                    ) : null
                  }
                >
                  <List.Item.Meta
                    avatar={<VideoCameraOutlined style={{ color: token.colorTextSecondary, marginTop: 4 }} />}
                    title={m.title}
                    description={`${clock(m.startsAt)} · ${m.durationMin} min${m.status === "upcoming" && dayjs(m.startsAt).isAfter(dayjs()) ? " · notes will be taken automatically" : ""}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Typography.Title level={5} style={{ margin: "28px 0 12px" }}>
        Your agents
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {agents.result.data.map((a) => (
          <Col key={a.id} xs={12} md={8} xl={4}>
            <Card
              size="small"
              hoverable={!a.managerOnly}
              onClick={a.managerOnly ? undefined : () => navigate("/ask")}
              style={{ height: "100%", opacity: a.managerOnly ? 0.55 : 1 }}
            >
              <Flex vertical gap={6}>
                {a.managerOnly ? <LockOutlined style={{ fontSize: 22 }} /> : <AgentAvatar agent={a.id} size={30} />}
                <Typography.Text strong>{a.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {a.managerOnly ? "Available to managers" : a.scope}
                </Typography.Text>
              </Flex>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};
