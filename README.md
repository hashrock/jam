# jam

Claude Code や Codex から操作できる、FigJam の簡易版。コードの要約、issue / PR のリンク集、TODO と依存関係、設計図などをエージェントに並べさせ、人は同じ画面を手で直せる。

## 起動

```sh
pnpm install
pnpm dev        # http://localhost:5199
```

ブラウザで開いておくと、盤面は `board.jam.json` に保存される。別の場所に保存するなら `JAM_FILE=/path/to/repo/design.jam.json pnpm dev`。
ファイルをエディタや git で書き換えると、開いているタブに反映される（座標を省いた要素は自動配置される）。

## エージェントから使う（MCP）

`mcp/server.ts` は stdio の MCP サーバーで、開発サーバー経由でブラウザのボードを操作する。Node 22.18 以上が必要（TypeScript をそのまま実行する）。

Claude Code:

```sh
claude mcp add jam -- node /path/to/jam/mcp/server.ts
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.jam]
command = "node"
args = ["/path/to/jam/mcp/server.ts"]
```

接続先を変えるときは環境変数 `JAM_URL`（既定 `http://localhost:5199`）。
ブラウザが WebMCP（`navigator.modelContext`）に対応していれば、同じツールをページから直接公開する。

### ツール

- `get_board` — 全要素（id, type, parent, 親からの相対 x/y, 実寸 w/h, 内容）と矢印を返す
- `apply` — 操作の配列をまとめて適用する。1回が1つの undo 単位で、1つでも不正なら何も変更しない

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

## 手での操作

- 余白をダブルクリックでメモ、ツールバーから各要素を追加（セクション選択中ならその中に追加）
- ダブルクリックまたは Enter で編集、Esc / ⌘Enter / 枠外クリックで確定
- ドラッグで移動。セクションに落とすと中に入る
- ハンドルから相手のノードへドラッグして矢印を引く。矢印のダブルクリックでラベル編集
- ⌘Z / ⇧⌘Z で undo / redo（エージェントの変更も同じ履歴）

## 構成

```
src/board/model.ts      要素の型と色
src/board/store.ts      盤面の状態・apply・自動配置・undo
src/board/layout.ts     grid / dag（elkjs）配置
src/board/tools.ts      ツール定義（ブラウザとブリッジで共有）
src/board/api.ts        ツールの実装・ハブ接続・WebMCP 登録
server/hub.ts           Vite プラグイン。タブとブリッジの中継、ファイル保存
mcp/server.ts           MCP stdio ブリッジ
```

同じボードを複数のタブで開いた場合、最後に開いたタブがエージェントの操作を受け、変更は保存を通じて他のタブにも配られる。
