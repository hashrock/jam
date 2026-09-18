import { useSyncExternalStore } from 'react'
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
      setStatus({ hub: true })
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
      setStatus({ hub: false })
      setPersist(() => {})
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 10000)
    }
  }
  open()
}

// ---------------------------------------------------------------------------
// WebMCP: ブラウザ（またはブリッジ拡張）がページのツールを直接エージェントに渡す経路
// https://developer.chrome.com/docs/ai/webmcp/imperative-api

type ModelContext = {
  registerTool(
    tool: {
      name: string
      description: string
      inputSchema: object
      annotations?: { readOnlyHint?: boolean }
      execute: (input: unknown, opts?: { signal?: AbortSignal }) => Promise<string>
    },
    opts?: { signal?: AbortSignal },
  ): unknown
}

/** 仕様では document.modelContext。古い Chrome（〜149）や拡張は navigator.modelContext */
function findModelContext(): ModelContext | undefined {
  return (
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  )
}

let webMcpAbort: AbortController | undefined

export async function registerWebMcp(mc = findModelContext()) {
  if (!mc) return false
  webMcpAbort?.abort()
  const abort = (webMcpAbort = new AbortController())
  for (const t of toolDefs) {
    const execute = async (input: unknown) => {
      // throw すると Chrome は理由を捨てて「invocation failed」だけを返すので、文字列で返す
      try {
        return JSON.stringify(await call(t.name, input))
      } catch (e) {
        return `error: ${(e as Error).message}`
      }
    }
    await mc.registerTool({ ...t, execute }, { signal: abort.signal })
  }
  setStatus({ webmcp: true })
  return true
}

// ---------------------------------------------------------------------------
// 接続状態（画面の隅に表示する）

type Status = { hub: boolean; webmcp: boolean }
let status: Status = { hub: false, webmcp: false }
const statusListeners = new Set<() => void>()

function setStatus(next: Partial<Status>) {
  status = { ...status, ...next }
  statusListeners.forEach((l) => l())
}

export function useApiStatus() {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    },
    () => status,
  )
}

export function installApi() {
  Object.assign(window, { jam: { getBoard, apply, call } })
  if (import.meta.env.DEV) connectHub()
  registerWebMcp().catch((e) => console.warn('[jam] WebMCP registration failed', e))
}
