import type { BaseRecord, CrudFilter, DataProvider } from "@refinedev/core";
import * as seed from "./seed";

type Row = BaseRecord & { id: number | string };

const tables: Record<string, Row[]> = {
  accounts: structuredClone(seed.accounts),
  interactions: structuredClone(seed.interactions),
  commitments: structuredClone(seed.commitments),
  meetings: structuredClone(seed.meetings),
  proposals: structuredClone(seed.proposals),
  updates: structuredClone(seed.updates),
  risks: structuredClone(seed.risks),
  agents: structuredClone(seed.agents),
};

const table = (resource: string) => {
  const rows = tables[resource];
  if (!rows) throw new Error(`Unknown resource: ${resource}`);
  return rows;
};

const matches = (row: Row, filter: CrudFilter): boolean => {
  if (!("field" in filter)) {
    const results = filter.value.map((f) => matches(row, f));
    return filter.operator === "or" ? results.some(Boolean) : results.every(Boolean);
  }
  const value = row[filter.field];
  switch (filter.operator) {
    case "eq":
      return value === filter.value;
    case "ne":
      return value !== filter.value;
    case "in":
      return (filter.value as unknown[]).includes(value);
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(filter.value).toLowerCase());
    case "gte":
      return value >= filter.value;
    case "lte":
      return value <= filter.value;
    default:
      return true;
  }
};

const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));

// In-memory provider with the same contract as the future REST provider for the FastAPI backend.
export const mockDataProvider: DataProvider = {
  getApiUrl: () => "/api",

  getList: async ({ resource, filters = [], sorters = [], pagination }) => {
    let rows = table(resource).filter((row) => filters.every((f) => matches(row, f)));
    for (const { field, order } of [...sorters].reverse()) {
      rows = [...rows].sort((a, b) => {
        const cmp = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
        return order === "asc" ? cmp : -cmp;
      });
    }
    const total = rows.length;
    if (pagination?.mode !== "off") {
      const current = pagination?.currentPage ?? 1;
      const size = pagination?.pageSize ?? 10;
      rows = rows.slice((current - 1) * size, current * size);
    }
    return delay({ data: structuredClone(rows) as never[], total });
  },

  getOne: async ({ resource, id }) => {
    const row = table(resource).find((r) => String(r.id) === String(id));
    if (!row) throw { message: `${resource} ${id} not found`, statusCode: 404 };
    return delay({ data: structuredClone(row) as never });
  },

  create: async ({ resource, variables }) => {
    const rows = table(resource);
    const id = Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
    const row = { ...(variables as object), id } as Row;
    rows.unshift(row);
    return delay({ data: structuredClone(row) as never });
  },

  update: async ({ resource, id, variables }) => {
    const row = table(resource).find((r) => String(r.id) === String(id));
    if (!row) throw { message: `${resource} ${id} not found`, statusCode: 404 };
    Object.assign(row, variables);
    return delay({ data: structuredClone(row) as never });
  },

  deleteOne: async ({ resource, id }) => {
    const rows = table(resource);
    const index = rows.findIndex((r) => String(r.id) === String(id));
    const [removed] = rows.splice(index, 1);
    return delay({ data: removed as never });
  },
};
