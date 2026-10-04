// refine access control: what each role may do in the UI.
// This only hides/disables controls; the backend returns 403 regardless of what the UI shows.
import type { AccessControlProvider, CanParams } from "@refinedev/core";
import type { Role } from "../types";
import { authProvider } from "./authProvider";

const MANAGER_ONLY = "Managers only.";

/** Pure rule table, exported so it can be reasoned about (and tested) without React. */
export function canRole(role: Role, { resource, action, params }: CanParams): { can: boolean; reason?: string } {
  if (role === "manager") return { can: true };

  switch (resource) {
    // The orchestrator answers to managers only; every other agent can be asked directly.
    case "agents":
      if (action === "ask" && params?.manager_only) return { can: false, reason: "This agent answers to managers only." };
      return { can: true };
    // Employees see proposals from their own meetings, read-only.
    case "proposals":
      return action === "list" || action === "show" ? { can: true } : { can: false, reason: MANAGER_ONLY };
    // Employees see and update their own commitments (the API filters and checks ownership).
    case "commitments":
      return action === "list" || action === "show" || action === "edit" ? { can: true } : { can: false, reason: MANAGER_ONLY };
    case "timeline":
    case "accounts":
    case "graph":
    case "users":
    case "status":
      return { can: true };
    // Notifications feed, spoken updates, demo triggers and connector sync are manager tools.
    case "notifications":
    case "voice":
    case "demo":
    case "sync":
      return { can: false, reason: MANAGER_ONLY };
    default:
      return { can: false, reason: MANAGER_ONLY };
  }
}

export const accessControlProvider: AccessControlProvider = {
  async can(params) {
    let role: Role;
    try {
      role = (await authProvider.getPermissions!()) as Role;
    } catch {
      return { can: false, reason: "Could not load your role." };
    }
    return canRole(role, params);
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true } },
};
