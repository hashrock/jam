// WebMCP: ボードを開いているページが、そのボードを操作するツールを公開する
// https://developer.chrome.com/docs/ai/webmcp/imperative-api
import { useSyncExternalStore } from 'react'
import { DEFAULT_WIDTH, type El } from '../board/model'
import type { Op } from '../board/ops'
import { pageTools } from '../board/tools'
import { commit, getState, settled, sizeOf } from './store'

/** エージェント向けの盤面。座標は親からの相対値、w/h は実寸 */
export function getBoard() {
  const { elements, edges } = getState().board
  return {
    elements: elements.map((e) => {
      const { width, height } = e.type === 'section' ? { width: e.w ?? DEFAULT_WIDTH.section, height: e.h ?? 400 } : sizeOf(e)
      const { w: _w, h: _h, ...rest } = e as El & { h?: number }
      return { ...rest, x: Math.round(e.x ?? 0), y: Math.round(e.y ?? 0), w: Math.round(width), h: Math.round(height) }
    }),
    edges,
  }
}

async function call(name: string, input: unknown) {
  if (name === 'get_board') return getBoard()
  if (name === 'apply') {
    const ops = (input as { ops?: Op[] } | undefined)?.ops
    if (!Array.isArray(ops)) throw new Error('"ops" must be an array')
    const { ids, done } = commit(ops)
    await done
    await settled()
    return { ids }
  }
  throw new Error(`unknown tool "${name}"`)
}

type ModelContext = {
  registerTool(
    tool: {
      name: string
      description: string
      inputSchema: object
      annotations?: { readOnlyHint?: boolean }
      execute: (input: unknown) => Promise<string>
    },
    opts?: { signal?: AbortSignal },
  ): unknown
}

/** 仕様では document.modelContext。古い Chrome（〜149）は navigator.modelContext */
function findModelContext(): ModelContext | undefined {
  return (
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  )
}

let available = false
const listeners = new Set<() => void>()

/** ツールを登録する。戻り値で登録を解除する */
export function registerWebMcp(): () => void {
  const mc = findModelContext()
  if (!mc) return () => {}
  const abort = new AbortController()
  const setAvailable = (v: boolean) => {
    available = v
    listeners.forEach((l) => l())
  }
  void (async () => {
    try {
      for (const t of pageTools) {
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
      if (!abort.signal.aborted) setAvailable(true)
    } catch (e) {
      console.warn('[jam] WebMCP registration failed', e)
    }
  })()
  return () => {
    abort.abort()
    setAvailable(false)
  }
}

export function useWebMcpAvailable() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => available,
  )
}
