import { SearchOutlined } from "@ant-design/icons";
import { useList } from "@refinedev/core";
import { Card, Flex, Input, Segmented, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";
import { HealthTag, fromNow, money } from "../../components/common";
import type { Account } from "../../types";

type HealthFilter = "all" | Account["health"];

export const AccountList = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<HealthFilter>("all");

  const { result, query } = useList<Account>({
    resource: "accounts",
    pagination: { mode: "off" },
    sorters: [{ field: "arr", order: "desc" }],
    filters: [
      ...(search ? [{ field: "name", operator: "contains" as const, value: search }] : []),
      ...(health !== "all" ? [{ field: "health", operator: "eq" as const, value: health }] : []),
    ],
  });

  return (
    <div className="page">
      <Typography.Title level={2} className="page-title">
        Accounts
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Every customer, with context unified from email, meetings, Slack, Jira and Confluence.
      </Typography.Paragraph>

      <Card styles={{ body: { padding: 0 } }}>
        <Flex gap={12} wrap style={{ padding: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <Segmented<HealthFilter>
            value={health}
            onChange={setHealth}
            options={[
              { label: "All", value: "all" },
              { label: "At risk", value: "at_risk" },
              { label: "Watch", value: "watch" },
              { label: "Healthy", value: "healthy" },
            ]}
          />
        </Flex>
        <Table<Account>
          rowKey="id"
          loading={query.isLoading}
          dataSource={result.data}
          pagination={false}
          rowClassName="clickable-row"
          onRow={(a) => ({ onClick: () => navigate(`/accounts/${a.id}`) })}
          columns={[
            {
              title: "Account",
              dataIndex: "name",
              width: 200,
              render: (name: string, a) => (
                <div>
                  <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                    {name}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                    {a.segment}
                  </Typography.Text>
                </div>
              ),
            },
            { title: "Stage", dataIndex: "stage", width: 120 },
            { title: "Health", dataIndex: "health", width: 100, render: (h: Account["health"]) => <HealthTag health={h} /> },
            { title: "ARR", dataIndex: "arr", align: "right", width: 110, render: money },
            { title: "Owner", dataIndex: "owner", width: 130, ellipsis: true },
            {
              title: "Topics",
              dataIndex: "topics",
              render: (topics: string[]) => (
                <Flex gap={4} wrap>
                  {topics.map((t) => (
                    <Tag key={t} bordered={false}>
                      {t}
                    </Tag>
                  ))}
                </Flex>
              ),
            },
            { title: "30-day touchpoints", dataIndex: "touchpoints30d", align: "center", width: 130 },
            { title: "Last contact", dataIndex: "lastContact", width: 130, render: fromNow },
          ]}
        />
      </Card>
    </div>
  );
};
