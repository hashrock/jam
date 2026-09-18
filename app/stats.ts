/**
 * GET /api/stats — repos.hashrock.info の管理画面が集めるサインアップ数。
 *
 * 認証は `Authorization: Bearer <STATS_TOKEN>` だけ（セッション・Cookie・AuthProvider には依存しない）。
 * server.ts で認証ミドルウェアより前に mount する。STATS_TOKEN 未設定なら 404（endpoint ごと無効）。
 */
import { Hono } from "hono";
import type { Env } from "./global.d";
import { countUsers } from "./db/stats.ts";

export function statsApp(now: () => Date = () => new Date()) {
  return new Hono<Env>().get("/", async (c) => {
    const expected = c.env.STATS_TOKEN;
    if (!expected) return c.notFound();
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!(await tokenMatches(token, expected))) return c.json({ error: "Unauthorized" }, 401);

    const at = now();
    const users = await countUsers(c.env.DB, at);
    c.header("Cache-Control", "no-store");
    return c.json({ service: "jam", generated_at: at.toISOString(), users });
  });
}

/** 長さに依らない定数時間比較（両方を SHA-256 にしてから全バイトを見る）。 */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
