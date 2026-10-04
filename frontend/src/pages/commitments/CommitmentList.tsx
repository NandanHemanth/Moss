import { useList, useUpdate } from "@refinedev/core";
import { Card, Checkbox, Flex, Segmented, Table, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { SourceTag, shortDate } from "../../components/common";
import { useApp } from "../../context/AppContext";
import type { Account, Commitment } from "../../types";

type StatusFilter = "open" | "done" | "all";

export const CommitmentList = () => {
  const { role, user } = useApp();
  const { token } = theme.useToken();
  const [status, setStatus] = useState<StatusFilter>("open");

  const { result, query } = useList<Commitment>({
    resource: "commitments",
    pagination: { mode: "off" },
    sorters: [{ field: "due", order: "asc" }],
    filters: [
      ...(status !== "all" ? [{ field: "status", operator: "eq" as const, value: status }] : []),
      ...(role === "employee" ? [{ field: "owner", operator: "eq" as const, value: user.name }] : []),
    ],
  });
  const accounts = useList<Account>({ resource: "accounts", pagination: { mode: "off" } });
  const { mutate } = useUpdate();

  const accountName = (id?: number) => accounts.result.data.find((a) => a.id === id)?.name;

  return (
    <div className="page">
      <Typography.Title level={2} className="page-title">
        {role === "manager" ? "Commitments" : "My commitments"}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Promises extracted from meetings, email and Slack. Ticking one off syncs the linked Jira issue.
      </Typography.Paragraph>
      <Card styles={{ body: { padding: 0 } }}>
        <Flex style={{ padding: 16 }}>
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { label: "Open", value: "open" },
              { label: "Done", value: "done" },
              { label: "All", value: "all" },
            ]}
          />
        </Flex>
        <Table<Commitment>
          rowKey="id"
          loading={query.isLoading}
          dataSource={result.data}
          pagination={false}
          columns={[
            {
              key: "done",
              width: 48,
              render: (_, c) => (
                <Checkbox
                  aria-label={`Mark "${c.title}" ${c.status === "open" ? "done" : "open"}`}
                  checked={c.status === "done"}
                  onChange={(e) =>
                    mutate({ resource: "commitments", id: c.id, values: { status: e.target.checked ? "done" : "open" }, successNotification: false })
                  }
                />
              ),
            },
            {
              title: "Commitment",
              dataIndex: "title",
              render: (t: string, c) => (
                <Typography.Text delete={c.status === "done"} strong={c.status === "open"}>
                  {t}
                </Typography.Text>
              ),
            },
            ...(role === "manager" ? [{ title: "Owner", dataIndex: "owner" }] : []),
            { title: "Account", dataIndex: "accountId", render: (id?: number) => accountName(id) ?? "Internal" },
            {
              title: "From",
              key: "source",
              render: (_, c) => (
                <Flex gap={6} align="center">
                  <SourceTag source={c.source} />
                  <Typography.Text type="secondary">{c.sourceLabel}</Typography.Text>
                </Flex>
              ),
            },
            {
              title: "Due",
              dataIndex: "due",
              render: (d: string, c) =>
                c.status === "open" && dayjs(d).isBefore(dayjs()) ? (
                  <Tag color="error" bordered={false}>
                    Overdue · {shortDate(d)}
                  </Tag>
                ) : (
                  <span style={{ color: token.colorTextSecondary }}>{shortDate(d)}</span>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
};
