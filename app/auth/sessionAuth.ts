/**
 * 本番の認証：セッション Cookie、次に Bearer トークン（リモート MCP）。
 */
import type { AuthProvider } from "./provider";
import { getSession, setSession, clearSession } from "../utils/session";
import { getUserByToken } from "../utils/apiToken";

export const sessionAuth: AuthProvider = {
  kind: "session",
  async resolve(c) {
    return (await getSession(c)) || (await getUserByToken(c));
  },
  async signIn(c, user) {
    await setSession(c, user);
  },
  async signOut(c) {
    clearSession(c);
  },
};
