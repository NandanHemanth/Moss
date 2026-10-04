import {
  CloudServerOutlined,
  DatabaseOutlined,
  LockOutlined,
  NodeIndexOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Flex, Input, Row, Tag, Typography, theme } from "antd";
import { useInvalidate } from "@refinedev/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { AGENT_META } from "../../agents";
import { AgentAvatar } from "../../components/common";
import { useApp } from "../../context/AppContext";
import type { PlanStep } from "../../data/demoAnswers";
import { ApiError, request } from "../../data/restDataProvider";
import type { AgentId, Proposal } from "../../types";

interface AskResponse {
  answer: string;
  plan: PlanStep[];
  citations: string[];
  proposals: Proposal[];
  agent: AgentId;
  sessionId: string;
  cached: boolean;
}

interface Message {
  id: number;
  from: "user" | "assistant";
  text: string;
  plan?: PlanStep[];
  citations?: string[];
  proposals?: Proposal[];
  agent?: AgentId;
  error?: boolean;
}

const MEMORY_ICON: Record<string, ReactNode> = {
  cache: <ThunderboltOutlined />,
  graph: <NodeIndexOutlined />,
  database: <DatabaseOutlined />,
};

const SUGGESTIONS = [
  "What did we discuss with Acme last month?",
  "Show me all customers interested in payroll integration.",
  "What are the open commitments and next steps for Globex?",
];

const EMPLOYEE_AGENTS: AgentId[] = ["mail", "slack", "jira", "meetings", "confluence"];

export const AskPage = () => {
  const { role, user } = useApp();
  const { token } = theme.useToken();
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [agent, setAgent] = useState<AgentId>(role === "manager" ? "orchestrator" : "meetings");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const sessions = useRef<Partial<Record<AgentId, string>>>({});

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId.current++, from: "user", text: q }]);
    setThinking(true);
    try {
      const res = await request<AskResponse>("/ask", {
        method: "POST",
        body: JSON.stringify({ question: q, role, agent, user: user.name, sessionId: sessions.current[agent] }),
      });
      sessions.current[agent] = res.sessionId;
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          from: "assistant",
          agent: res.agent,
          text: res.answer,
          plan: res.plan,
          citations: res.citations,
          proposals: res.proposals,
        },
      ]);
      if (res.proposals.length) invalidate({ resource: "proposals", invalidates: ["list"] });
    } catch (e) {
      const text =
        e instanceof ApiError && e.statusCode === 429
          ? "The model's free-tier quota is used up for now. Try again later."
          : e instanceof Error
            ? e.message
            : "Something went wrong reaching the agents.";
      setMessages((m) => [...m, { id: nextId.current++, from: "assistant", agent, text, error: true }]);
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    const q = params.get("q");
    if (q) {
      setParams({}, { replace: true });
      send(q);
    }
  }, [params]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, thinking]);

  const lastPlan = [...messages].reverse().find((m) => m.plan)?.plan ?? [];
  const agentChoices: AgentId[] = role === "manager" ? ["orchestrator", ...EMPLOYEE_AGENTS] : EMPLOYEE_AGENTS;

  return (
    <div className="page">
      <Typography.Title level={2} className="page-title">
        {role === "manager" ? "Ask Moss" : "Ask an agent"}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {role === "manager"
          ? "The orchestrator plans the question, delegates to the right agents and cites every source."
          : "Pick an agent for your question. Cross-team orchestration is available to managers."}
      </Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        icon={<CloudServerOutlined />}
        message="Agents answer from seeded demo data for Gmail, Calendar, Slack, Jira, Zoom and Confluence. Write actions are drafted for approval, never sent."
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card styles={{ body: { display: "flex", flexDirection: "column", height: "calc(100vh - 300px)", minHeight: 460 } }}>
            <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
              {messages.length === 0 ? (
                <Flex vertical align="center" justify="center" gap={12} style={{ height: "100%" }}>
                  <Typography.Text type="secondary">Try one of these</Typography.Text>
                  {SUGGESTIONS.map((s) => (
                    <Button key={s} onClick={() => send(s)}>
                      {s}
                    </Button>
                  ))}
                </Flex>
              ) : (
                <Flex vertical gap={14}>
                  {messages.map((m) =>
                    m.from === "user" ? (
                      <div
                        key={m.id}
                        className="chat-bubble"
                        style={{ marginLeft: "auto", background: token.colorPrimary, color: token.colorTextLightSolid }}
                      >
                        {m.text}
                      </div>
                    ) : (
                      <Flex key={m.id} gap={10} align="flex-start">
                        <AgentAvatar agent={m.agent ?? "orchestrator"} />
                        <div
                          className="chat-bubble"
                          style={{
                            background: m.error ? token.colorErrorBg : token.colorFillTertiary,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {m.text.replace(/\*\*(.+?)\*\*/g, "$1")}
                          {!!m.proposals?.length && (
                            <Flex vertical gap={6} style={{ marginTop: 10 }}>
                              {m.proposals.map((p) => (
                                <Alert
                                  key={p.id}
                                  type="warning"
                                  showIcon
                                  message={`Drafted for approval · ${p.target}`}
                                  description={p.summary}
                                />
                              ))}
                            </Flex>
                          )}
                          {!!m.citations?.length && (
                            <Flex gap={4} wrap style={{ marginTop: 10 }}>
                              {m.citations.map((c) => (
                                <Tag
                                  key={c}
                                  bordered={false}
                                  style={{ color: token.colorInfoText, background: token.colorInfoBg }}
                                >
                                  {c}
                                </Tag>
                              ))}
                            </Flex>
                          )}
                        </div>
                      </Flex>
                    ),
                  )}
                  {thinking && (
                    <Flex gap={10} align="center">
                      <AgentAvatar agent={agent} />
                      <Typography.Text type="secondary">{AGENT_META[agent].label} is working…</Typography.Text>
                    </Flex>
                  )}
                  <div ref={endRef} />
                </Flex>
              )}
            </div>

            <Flex gap={6} wrap style={{ margin: "12px 0 8px" }}>
              {agentChoices.map((a) => (
                <Tag.CheckableTag key={a} checked={agent === a} onChange={() => setAgent(a)}>
                  {AGENT_META[a].label}
                </Tag.CheckableTag>
              ))}
              {role === "employee" && (
                <Tag icon={<LockOutlined />} bordered={false}>
                  Orchestrator · managers only
                </Tag>
              )}
            </Flex>
            <Flex gap={8}>
              <Input
                size="large"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={() => send(input)}
                placeholder={`Message the ${AGENT_META[agent].label}`}
                aria-label="Message"
              />
              <Button size="large" type="primary" icon={<SendOutlined />} aria-label="Send" onClick={() => send(input)} />
            </Flex>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title="How this answer was built">
            {lastPlan.length === 0 ? (
              <Typography.Text type="secondary">
                Ask a question to see which agents and memory layers were used.
              </Typography.Text>
            ) : (
              <Flex vertical gap={12}>
                {lastPlan.map((s, i) => (
                  <Flex key={i} gap={10} align="center">
                    {s.agent in AGENT_META ? (
                      <AgentAvatar agent={s.agent as AgentId} size={26} />
                    ) : (
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          display: "grid",
                          placeItems: "center",
                          background: token.colorFillSecondary,
                          flexShrink: 0,
                        }}
                      >
                        {MEMORY_ICON[s.agent]}
                      </span>
                    )}
                    <Typography.Text>{s.text}</Typography.Text>
                  </Flex>
                ))}
              </Flex>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};
