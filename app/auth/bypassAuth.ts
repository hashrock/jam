/**
 * 開発用の認証バイパス（DEV_BYPASS_AUTH が有効なときだけ selectAuth が選ぶ）。
 * 常に Dev User としてログインしている扱いにする。Bearer トークンは本番と同じく効く
 * （ローカルでリモート MCP を試すため）。
 */
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../global.d";
import type { SessionUser } from "../user";
import type { AuthProvider } from "./provider";
import { getUserByToken } from "../utils/apiToken";
import { findUserById, insertUser } from "../utils/userRepository";

export const DEV_USER: SessionUser = {
  id: "dev-user",
  email: "dev@localhost",
  name: "Dev User",
  avatarUrl: "",
};

/** Dev User の行を保証して返す。 */
async function ensureDevUser(c: Context<Env>): Promise<SessionUser> {
  const db = drizzle(c.env.DB);
  if (!(await findUserById(db, DEV_USER.id))) await insertUser(db, DEV_USER);
  return DEV_USER;
}

export const bypassAuth: AuthProvider = {
  kind: "bypass",
  async resolve(c) {
    // トークンを付けてきたら本番と同じく検証する（間違ったトークンで Dev User にならない）
    if (c.req.header("Authorization")) return getUserByToken(c);
    return ensureDevUser(c);
  },
  async signIn() {},
  async signOut() {},
};
