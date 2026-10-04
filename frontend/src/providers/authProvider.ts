// refine auth provider. There is no real login in the demo: the "identity" is whichever
// demo user is selected in the user switcher. The backend still enforces roles on every call.
import type { AuthProvider } from "@refinedev/core";
import { DEFAULT_USER } from "../config";
import { userStore } from "../session";
import type { Role, User } from "../types";
import { isAccessCodeError, request } from "./http";

const identityCache = new Map<string, Promise<User>>();

/** GET /api/me for a user id, cached per id (role and name do not change during a session). */
export function fetchIdentity(userId: string = userStore.get()): Promise<User> {
  let p = identityCache.get(userId);
  if (!p) {
    p = request<User>("/api/me", { userId });
    identityCache.set(userId, p);
    p.catch(() => identityCache.delete(userId));
  }
  return p;
}

export const authProvider: AuthProvider = {
  // "Logging in" = picking a demo user. Used by the user switcher.
  async login({ userId }: { userId?: string }) {
    if (!userId) return { success: false, error: { name: "Login", message: "No user selected." } };
    try {
      await fetchIdentity(userId);
    } catch (e) {
      return { success: false, error: { name: "Login", message: (e as { message?: string }).message || "Unknown user." } };
    }
    userStore.set(userId);
    return { success: true };
  },

  async logout() {
    userStore.set(DEFAULT_USER);
    return { success: true };
  },

  async check() {
    return { authenticated: Boolean(userStore.get()) };
  },

  async onError(error) {
    // 401 = the stored user id is unknown to this backend (e.g. the database was re-seeded differently).
    if (error?.statusCode === 401 && !isAccessCodeError(error) && userStore.get() !== DEFAULT_USER) {
      userStore.set(DEFAULT_USER);
    }
    return {};
  },

  async getIdentity(): Promise<User> {
    return fetchIdentity();
  },

  async getPermissions(): Promise<Role> {
    return (await fetchIdentity()).role;
  },
};
