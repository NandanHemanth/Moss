import type { DataProvider } from "@refinedev/core";

const API = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.detail ?? res.statusText, res.status);
  return body as T;
};

// Talks to the FastAPI backend; filters and sorters travel as JSON in the query string.
export const restDataProvider: DataProvider = {
  getApiUrl: () => API,

  getList: async ({ resource, filters = [], sorters = [], pagination }) => {
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      sorters: JSON.stringify(sorters),
      page: String(pagination?.currentPage ?? 1),
      pageSize: pagination?.mode === "off" ? "0" : String(pagination?.pageSize ?? 10),
    });
    return request(`/${resource}?${params}`);
  },

  getOne: async ({ resource, id }) => ({ data: await request(`/${resource}/${id}`) }),

  create: async ({ resource, variables }) => ({
    data: await request(`/${resource}`, { method: "POST", body: JSON.stringify(variables) }),
  }),

  update: async ({ resource, id, variables }) => ({
    data: await request(`/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(variables) }),
  }),

  deleteOne: async ({ resource, id }) => ({ data: await request(`/${resource}/${id}`, { method: "DELETE" }) }),
};
