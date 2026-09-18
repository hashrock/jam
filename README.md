# jam

Claude Code や Codex から操作できる、FigJam の簡易版。コードの要約、issue / PR のリンク集、TODO と依存関係、設計図などをエージェントに並べさせ、人は同じ画面を手で直せる。

Hono + Inertia.js + React 構成で、単一の Cloudflare Worker がサーバーとクライアントの両方を配信する（構成は edane に倣っている）。

## 構成

- 一覧・ユーザー・API トークンは **D1**、ボードの中身は **Durable Object（BoardRoom）** が1ボード1インスタンスで持つ
- ブラウザのタブは WebSocket で BoardRoom につながり、手での編集も、エージェントの変更も、同じ順序で適用されて全タブに配られる
- エージェントは **リモート MCP**（`/mcp`、API トークン）で直接つなぐ。ボードを開いたページは **WebMCP** でもツールを公開する
- 座標を省いた要素は、開いているタブが実寸で自動配置する。タブが無ければサーバーが概算の寸法で配置する

```
app/
  server.ts            Hono アプリ（ページ、認証、API、/mcp）。BoardRoom を export する
  room.ts              BoardRoom（Durable Object）: 盤面の正本、WebSocket、自動配置の予備
  mcp.ts               リモート MCP（Streamable HTTP, ステートレス）
  boards.ts            D1 のボード一覧と BoardRoom をまたぐ操作
  board/               ブラウザとサーバーで共有する純粋なロジック
    model.ts           要素の型と色
    ops.ts             操作の適用（applyOps）と差分
    placement.ts       自動配置とレイアウト（寸法の測り方は外から渡す）
    layout.ts          grid / dag（層状レイアウト）と寸法の概算
    tools.ts           エージェント向けツールの定義と説明
    protocol.ts        タブ ⇔ BoardRoom のメッセージ
  editor/              キャンバス（React Flow）、同期ストア、WebMCP
  pages/               Inertia ページ（Home, Boards/Index, Boards/Show, Settings）
  auth/ utils/ db/     認証（Google OAuth / 開発用バイパス）、セッション、トークン、Drizzle スキーマ
migrations/            D1 マイグレーション
```

## 開発

```sh
pnpm install
cp .dev.vars.example .dev.vars   # DEV_BYPASS_AUTH=1 で Dev User として自動ログイン
pnpm migrate                     # ローカル D1 にマイグレーション適用（初回のみ）
pnpm dev                         # http://localhost:5173
```

## デプロイ

```sh
wrangler d1 create jam-db          # 出力された database_id を wrangler.jsonc に書く
pnpm migrate:remote
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_ID      # Google OAuth クライアント。リダイレクト URI は https://jam.hashrock.info/auth/google
wrangler secret put GOOGLE_SECRET
pnpm run deploy
```

### サインアップ数（`GET /api/stats`）

`Authorization: Bearer <STATS_TOKEN>` で `{ service, generated_at, users: { total, new_7d, new_30d } }` を返す（`scenario-` ユーザーは除外、`Cache-Control: no-store`）。
`STATS_TOKEN` は secret（`wrangler secret put STATS_TOKEN`）で、未設定なら 404、不一致なら 401。セッションとは無関係。
repos.hashrock.info の管理画面がこれを集めて表示・日次記録する。

## エージェントから使う

### リモート MCP（おすすめ）

設定画面（`/settings`）で API トークンを発行し、登録する。コマンドは設定画面にもそのまま出る。

```sh
claude mcp add --transport http jam https://jam.hashrock.info/mcp --header "Authorization: Bearer jam_..."
```

Codex（`~/.codex/config.toml`）:

```toml
[mcp_servers.jam]
url = "https://jam.hashrock.info/mcp"
bearer_token_env_var = "JAM_TOKEN"
```

ツール: `list_boards` / `create_board` / `get_board(board_id)` / `apply(board_id, ops)`

### WebMCP

ボードを開いたページが `document.modelContext` に `get_board` / `apply`（そのボードが対象）を登録する。
Chrome で `chrome://flags/#enable-webmcp-testing` を有効にし、Chrome DevTools MCP を WebMCP 付きで登録すると使える。

```sh
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --categoryExperimentalWebmcp=true --autoConnect
```

### apply の操作

```jsonc
{ "ops": [
  { "op": "create", "type": "section", "id": "todo", "title": "TODO" },
  { "op": "create", "type": "task", "id": "t1", "parent": "todo", "text": "データモデル" },
  { "op": "create", "type": "task", "id": "t2", "parent": "todo", "text": "UI" },
  { "op": "connect", "from": "t1", "to": "t2" },
  { "op": "layout", "id": "todo", "mode": "dag" }
] }
```

| op | 内容 |
| --- | --- |
| `create` | `type`, `id?`, `parent?`, `x?`, `y?`, `w?`, `color?` と種類ごとのフィールド。座標を省くと自動配置 |
| `update` | 要素または矢印のフィールドを変更。`null` で削除 |
| `delete` | 要素（子と矢印ごと）または矢印を削除 |
| `connect` | `from` → `to` の矢印。`label?`, `dashed?` |
| `layout` | セクション（省略時は全体）の子を `grid` または `dag`（矢印に沿って左→右）で並べ直す |

| type | フィールド |
| --- | --- |
| `section` | `title` |
| `note` | `text`（`# 見出し` `- 箇条書き` `**太字**` `` `code` `` URL） |
| `task` | `text`, `done` |
| `link` | `url`, `title` |
| `box` | `text`, `shape`: rect / round / ellipse / diamond / db |
| `code` | `code`, `lang` |
| `text` | `text`, `size`: sm / md / lg / xl |

色: white, gray, yellow, orange, red, pink, violet, blue, teal, green

1回の `apply` が1つの undo 単位。1つでも不正な操作があれば何も変更せず、どの操作が何故だめかを返す。

## 手での操作

- 余白をダブルクリックでメモ、ツールバーから各要素を追加（セクション選択中ならその中に追加）
- ダブルクリックまたは Enter で編集、Esc / ⌘Enter / 枠外クリックで確定
- ドラッグで移動。セクションに落とすと中に入る
- ハンドルから相手のノードへドラッグして矢印を引く。矢印のダブルクリックでラベル編集
- ⌘Z / ⇧⌘Z で undo / redo。エージェントの変更も戻せる。他のタブでの変更は巻き戻さない（履歴は変更した要素の差分だけを持つ）

## ライセンス

MIT
