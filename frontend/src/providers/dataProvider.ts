// refine data provider for the Moss REST API.
// Lists are plain arrays (no server pagination); `eq` filters become query-string params.
import type { BaseRecord, CrudFilter, DataProvider } from "@refinedev/core";
import { API_URL } from "../config";
import { request, type Query } from "./http";

function filtersToQuery(filters?: CrudFilter[]): Query {
  const q: Query = {};
  for (const f of filters ?? []) {
    if ("field" in f && f.operator === "eq" && f.value !== undefined && f.value !== null && f.value !== "") {
      q[f.field] = f.value as string | number | boolean;
    }
  }
  return q;
}

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  async getList({ resource, filters, meta }) {
    const query = { ...filtersToQuery(filters), ...((meta?.query as Query | undefined) ?? {}) };
    const data = await request<BaseRecord[]>(`/api/${resource}`, { query, signal: meta?.signal });
    const rows = Array.isArray(data) ? data : [];
    return { data: rows as never[], total: rows.length };
  },

  async getOne({ resource, id, meta }) {
    const data = await request<BaseRecord>(`/api/${resource}/${encodeURIComponent(String(id))}`, { signal: meta?.signal });
    return { data: data as never };
  },

  async create({ resource, variables }) {
    const data = await request<BaseRecord>(`/api/${resource}`, { method: "POST", body: variables });
    return { data: data as never };
  },

  // PATCH /api/commitments/{id} is the only update the API has.
  async update({ resource, id, variables }) {
    const data = await request<BaseRecord>(`/api/${resource}/${encodeURIComponent(String(id))}`, { method: "PATCH", body: variables });
    return { data: data as never };
  },

  async deleteOne({ resource, id }) {
    const data = await request<BaseRecord>(`/api/${resource}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    return { data: data as never };
  },

  // Everything that is not CRUD: /api/ask, /api/actions/{id}/decide, /api/status, /api/graph, …
  async custom({ url, method, payload, query, headers, meta }) {
    const data = await request<BaseRecord>(url, {
      method,
      body: method === "get" || method === "head" ? undefined : (payload ?? {}),
      query: query as Query | undefined,
      headers: headers as Record<string, string> | undefined,
      signal: meta?.signal,
    });
    return { data: data as never };
  },
};
