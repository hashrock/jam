import type { Board } from './model'
import { apply, getState, type Op, replaceBoard, setPersist, sizeOf } from './store'
import { HUB_PATH, type ToolName, toolDefs, type WireMessage } from './tools'

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

const handlers: Record<ToolName, (input: never) => Promise<unknown>> = {
  get_board: async () => getBoard(),
  apply: async ({ ops }: { ops: Op[] }) => {
    if (!Array.isArray(ops)) throw new Error('"ops" must be an array')
    return apply(ops)
  },
}

async function call(name: string, input: unknown) {
  const h = handlers[name as ToolName]
  if (!h) throw new Error(`unknown tool "${name}"`)
  return h((input ?? {}) as never)
}

// ---------------------------------------------------------------------------
// 開発サーバーのハブと接続する（MCP ブリッジからの呼び出しの中継と、ファイル保存）

function connectHub() {
  let retry = 1000
  let loaded = false
  let primary = true
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${HUB_PATH}?role=board`)
    const send = (m: WireMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))
    ws.onopen = () => {
      retry = 1000
      setPersist((board) => send({ type: 'save', board }))
    }
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data as string) as WireMessage
      if (m.type === 'load') {
        const same = JSON.stringify(m.board) === JSON.stringify(getState().board)
        if (m.board && !same) replaceBoard(m.board as Board, { initial: !loaded, place: primary })
        // ファイルがまだ無ければ、手元の盤面で作る
        else send({ type: 'save', board: getState().board })
        loaded = true
      } else if (m.type === 'role') {
        primary = m.primary
      } else if (m.type === 'call') {
        try {
          send({ type: 'result', id: m.id, ok: true, result: await call(m.name, m.input) })
        } catch (e) {
          send({ type: 'result', id: m.id, ok: false, error: (e as Error).message })
        }
      }
    }
    ws.onclose = () => {
      setPersist(() => {})
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 10000)
    }
  }
  open()
}

// ---------------------------------------------------------------------------

type ModelContext = {
  registerTool(tool: {
    name: string
    description: string
    inputSchema: object
    execute: (input: unknown) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>
  }): unknown
}

export function installApi() {
  Object.assign(window, { jam: { getBoard, apply, call } })

  if (import.meta.env.DEV) connectHub()

  // ブラウザが WebMCP に対応していれば、ページから直接ツールを公開する
  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  if (!mc) return
  for (const t of toolDefs) {
    mc.registerTool({
      ...t,
      execute: async (input) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await call(t.name, input)) }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true }
        }
      },
    })
  }
}
