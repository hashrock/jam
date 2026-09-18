import type { SessionUser } from "./user";
import type { AuthProvider } from "./auth/provider";
import type { BoardRoom } from "./room";

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser | null;
    auth: AuthProvider;
  }
}

export type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace<BoardRoom>;
  GOOGLE_ID: string;
  GOOGLE_SECRET: string;
  SESSION_SECRET: string;
  DEV_BYPASS_AUTH?: string;
  /** GET /api/stats の Bearer トークン（secret）。未設定なら endpoint は 404 */
  STATS_TOKEN?: string;
};

export type Env = {
  Bindings: Bindings;
  Variables: {
    user: SessionUser | null;
    /** このリクエストの認証プロバイダ（auth/index.ts の selectAuth が env から選ぶ）。 */
    auth: AuthProvider;
  };
};

/** repos.hashrock.info が配るサービス切り替え（root-view.tsx で読み込む） */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hashrock-switcher": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        floating?: boolean;
        theme?: "light" | "dark";
      };
    }
  }
}
