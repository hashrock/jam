// ブラウザと MCP ブリッジ（Node）の両方から読むので DOM に依存しないこと
import { COLOR_NAMES } from './model.ts'

const APPLY_DOC = `Apply a batch of operations to the jam board atomically (one undo step). If any op is invalid, nothing changes and the error names the failing op.

Ops:
- {op:"create", type, id?, parent?, x?, y?, w?, color?, ...fields}
- {op:"update", id, ...fields}   (element or edge; set a field to null to clear it)
- {op:"delete", id}              (element with all its children and edges, or an edge)
- {op:"connect", from, to, id?, label?, dashed?}   (arrow from -> to)
- {op:"layout", id?, mode:"grid"|"dag"}   (re-arrange children of section id, or top level if omitted; dag = left-to-right dependency graph using edges)

Element types and fields:
- section {title}         container; put related items inside via parent
- note    {text}          markdown-lite: "# heading", "- bullet", **bold**, \`code\`, URLs
- task    {text, done}    TODO item with checkbox
- link    {url, title}    issue / PR / doc link
- box     {text, shape}   diagram node; shape: rect | round | ellipse | diamond | db
- code    {code, lang}
- text    {text, size}    heading/label without background; size: sm | md | lg | xl

colors: ${COLOR_NAMES.join(', ')}

Guidance:
- Pick your own short readable ids (e.g. "api", "t1") so later ops in the same batch can reference them.
- Omit x/y: new items are auto-placed (appended into the parent section, or to the right of existing top-level content). Sections grow to fit.
- The user also edits the board by hand. Call get_board first and do not move existing items unless asked; avoid "layout" on sections the user arranged.
- Group each topic in its own section. For dependency graphs: create items in a section, connect them, then {op:"layout", id:section, mode:"dag"}.
- Keep notes short (a few lines). Prefer several small notes/tasks over one long note.`

export const toolDefs = [
  {
    name: 'get_board',
    description:
      'Read the whole jam board: elements (id, type, parent, x/y relative to parent, w/h in px, content fields) and edges (from -> to).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'apply',
    description: APPLY_DOC,
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: ['create', 'update', 'delete', 'connect', 'layout'] } },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
] as const

export type ToolName = (typeof toolDefs)[number]['name']

/** ハブ ⇔ ブラウザ ⇔ ブリッジの WebSocket メッセージ */
export type WireMessage =
  | { type: 'call'; id: string; name: string; input: unknown }
  | { type: 'result'; id: string; ok: true; result: unknown }
  | { type: 'result'; id: string; ok: false; error: string }
  | { type: 'load'; board: unknown }
  | { type: 'save'; board: unknown }
  /** 最後に開いたタブが primary。エージェントの操作とファイル由来の自動配置を担当する */
  | { type: 'role'; primary: boolean }

export const HUB_PATH = '/__jam/ws'
