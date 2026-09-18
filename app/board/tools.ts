// エージェント向けのツール定義。ページの WebMCP とサーバーのリモート MCP で共有する
import { COLOR_NAMES } from './model'

export const APPLY_DOC = `Apply a batch of operations to a jam board atomically (one undo step). If any op is invalid, nothing changes and the error names the failing op.

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
- The user also edits the board by hand, often at the same time. Read the board first and do not move existing items unless asked; avoid "layout" on sections the user arranged.
- Group each topic in its own section. For dependency graphs: create items in a section, connect them, then {op:"layout", id:section, mode:"dag"}.
- Keep notes short (a few lines). Prefer several small notes/tasks over one long note.`

const GET_BOARD_DOC =
  'Read the whole board: elements (id, type, parent, x/y relative to parent, w/h in px, content fields) and edges (from -> to).'

const OPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { op: { type: 'string', enum: ['create', 'update', 'delete', 'connect', 'layout'] } },
    required: ['op'],
  },
} as const

/** ボードを開いているページが WebMCP で公開するツール（対象はそのページのボード） */
export const pageTools = [
  {
    name: 'get_board',
    description: GET_BOARD_DOC,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'apply',
    description: APPLY_DOC,
    inputSchema: { type: 'object', properties: { ops: OPS_SCHEMA }, required: ['ops'] },
  },
] as const

const BOARD_ID = { type: 'string', description: 'board id from list_boards or create_board' } as const

/** リモート MCP（/mcp）のツール。ユーザーの全ボードが対象 */
export const serverTools = [
  {
    name: 'list_boards',
    description: "List the user's jam boards (id, title, url, updatedAt), most recently updated first.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_board',
    description:
      'Create a new empty board and return its id and url. Tell the user the url so they can open it; edits appear live in their browser.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'get_board',
    description: GET_BOARD_DOC,
    inputSchema: { type: 'object', properties: { board_id: BOARD_ID }, required: ['board_id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'apply',
    description: APPLY_DOC,
    inputSchema: { type: 'object', properties: { board_id: BOARD_ID, ops: OPS_SCHEMA }, required: ['board_id', 'ops'] },
  },
] as const

export const MCP_INSTRUCTIONS = `jam is a whiteboard (a minimal FigJam) for laying out code summaries, issue/PR links, TODOs with dependencies and design diagrams for the user. The user watches and edits the same board in their browser in real time.
Typical flow: list_boards (or create_board) → get_board → apply. Always read a board before editing it, and prefer adding over rearranging what the user placed by hand.`
