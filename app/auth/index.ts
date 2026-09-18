/**
 * env → AuthProvider の選択。アプリ全体でここだけが「バイパスか本番か」を判断する。
 */
import type { Env } from "../global.d";
import type { AuthProvider } from "./provider";
import { sessionAuth } from "./sessionAuth";
import { bypassAuth } from "./bypassAuth";

export function selectAuth(env: Pick<Env["Bindings"], "DEV_BYPASS_AUTH">): AuthProvider {
  return env.DEV_BYPASS_AUTH ? bypassAuth : sessionAuth;
}

export { authMiddleware, type AuthProvider } from "./provider";
