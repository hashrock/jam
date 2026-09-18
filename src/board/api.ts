import { COLOR_NAMES } from './model'
import { apply, getState, type Op, sizeOf } from './store'

/** エージェント向けの盤面スナップショット。座標は親からの相対値、w/h は実寸 */
export function getBoard() {
  const { elements, edges } = getState().board
  return {
    elements: elements.map((e) => {
      const { width, height } = sizeOf(e)
      const { w: _w, h: _h, ...rest } = e as typeof e & { h?: number }
      return { ...rest, x: Math.round(e.x ?? 0), y: Math.round(e.y ?? 0), w: Math.round(width), h: Math.round(height) }
    }),
    edges,
  }
}

const OPS_DOC = `Apply a batch of operations to the board atomically (one undo step). If any op is invalid, nothing changes and an error names the failing op.

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
- The user also edits the board by hand. Read the board first and do not move existing items unless asked; avoid "layout" on sections the user arranged.
- For dependency graphs: create items in a section, connect them, then {op:"layout", id:section, mode:"dag"}.`

export const tools = [
  {
    name: 'get_board',
    description:
      'Read the whole board: elements (id, type, parent, x/y relative to parent, w/h in px, content fields) and edges (from -> to).',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getBoard(),
  },
  {
    name: 'apply',
    description: OPS_DOC,
    inputSchema: {
      type: 'object',
      properties: { ops: { type: 'array', items: { type: 'object' } } },
      required: ['ops'],
    },
    execute: async ({ ops }: { ops: Op[] }) => apply(ops),
  },
]

type ModelContext = {
  registerTool(tool: {
    name: string
    description: string
    inputSchema: object
    execute: (input: never) => Promise<{ content: { type: 'text'; text: string }[] }>
  }): unknown
}

export function installApi() {
  const jam = { getBoard, apply, tools }
  Object.assign(window, { jam })

  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  if (!mc) return
  for (const t of tools) {
    mc.registerTool({
      ...t,
      execute: async (input: never) => {
        try {
          const result = await t.execute(input)
          return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true } as never
        }
      },
    })
  }
}
