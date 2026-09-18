/**
 * 認証プロバイダ：「誰としてログインしているか」を決める唯一の口。
 *
 * - `sessionAuth`（本番）: 署名付きセッション Cookie + Bearer トークン（リモート MCP）。
 * - `bypassAuth`（DEV_BYPASS_AUTH 有効時のみ）: Bearer トークンがあればその持ち主、無ければ Dev User。
 *
 * 選択は `selectAuth(env)`（auth/index.ts）の 1 箇所。ミドルウェアは
 * `c.set("user", await auth.resolve(c))` するだけ。
 * Google OAuth の callback とログアウトは `signIn` / `signOut` を通り、ログイン手順はプロバイダの中にしか無い。
 */
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../global.d";
import type { SessionUser } from "../user";

export interface AuthProvider {
  /**
   * `"bypass"` は開発用。使い捨てユーザーで `signIn` してよいのはこのときだけ
   * （本番で任意のユーザーとしてログインできてはいけない）。
   */
  readonly kind: "session" | "bypass";
  /** 毎リクエスト、ミドルウェアが呼ぶ。null = 未ログイン。 */
  resolve(c: Context<Env>): Promise<SessionUser | null>;
  /** 以後のリクエストで `resolve` が `user` を返すようにする（ブラウザは複数リクエストをまたぐ）。 */
  signIn(c: Context<Env>, user: SessionUser): Promise<void>;
  signOut(c: Context<Env>): Promise<void>;
}

/**
 * `select` は env からプロバイダを選ぶ（Workers では env がリクエスト毎にしか
 * 手に入らないので、構築時ではなくここで選ぶ）。テストは固定ユーザーを返す
 * モックを渡せば DB なしでハンドラを叩ける。
 */
export function authMiddleware(select: (env: Env["Bindings"]) => AuthProvider): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = select(c.env);
    c.set("auth", auth);
    c.set("user", await auth.resolve(c));
    await next();
  };
}
