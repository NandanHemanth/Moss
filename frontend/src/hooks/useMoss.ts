// Thin typed wrappers around refine's data/auth hooks for the Moss API.
import { useMemo } from "react";
import {
  useCan,
  useCustom,
  useGetIdentity,
  useList,
  usePermissions,
  type BaseRecord,
  type CrudFilter,
  type HttpError,
} from "@refinedev/core";
import { api } from "../config";
import type { Agent, Role, User } from "../types";

/** Query-key prefix of every non-resource query (status, graph, demo queue). Invalidated on live events. */
export const MOSS_QUERY_KEY = "moss";

const EMPTY: never[] = [];

export const useIdentity = () => useGetIdentity<User>();

export function useRole(): Role | undefined {
  const { data } = usePermissions<Role>({});
  return data;
}

type Params = Record<string, string | number | undefined | null>;

/** `useList` for an API list endpoint: GET /api/<resource>?<params>. Refetches on SSE events (liveMode "auto"). */
export function useMossList<T extends BaseRecord>(resource: string, params: Params = {}, options: { enabled?: boolean } = {}) {
  const key = JSON.stringify(params);
  const filters = useMemo<CrudFilter[]>(
    () =>
      Object.entries(JSON.parse(key) as Params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([field, value]) => ({ field, operator: "eq" as const, value })),
    [key],
  );
  const { query, result } = useList<T, HttpError>({
    resource,
    filters,
    pagination: { mode: "off" },
    queryOptions: { enabled: options.enabled ?? true },
  });
  return {
    data: ((options.enabled ?? true) ? (result.data as T[] | undefined) : undefined) ?? (EMPTY as T[]),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as HttpError | null,
    refetch: query.refetch,
  };
}

/** `useCustom` GET for the endpoints that are not lists (status, graph, demo queue). */
export function useMossQuery<T>(key: string, path: string, options: { enabled?: boolean } = {}) {
  const { query } = useCustom<BaseRecord, HttpError>({
    url: api(path),
    method: "get",
    queryOptions: { queryKey: [MOSS_QUERY_KEY, key], enabled: options.enabled ?? true },
  });
  return {
    data: query.data?.data as T | undefined,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as HttpError | null,
    refetch: query.refetch,
  };
}

/** Agents from GET /api/agents (names, tools, modes, and whether the current user may call them). */
export function useAgents() {
  const { data, isLoading, error } = useMossList<Agent>("agents");
  const byId = useMemo(() => new Map(data.map((a) => [a.id, a])), [data]);
  return { agents: data, byId, isLoading, error };
}

/** Access check through the accessControlProvider. `false` while the answer is loading. */
export function useAllowed(resource: string, action: string, params?: Record<string, unknown>): boolean {
  const { data } = useCan({ resource, action, params });
  return data?.can === true;
}
