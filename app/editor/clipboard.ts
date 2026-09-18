// コピー＆ペースト。クリップボードには jam 同士で読める JSON をテキストとして載せる
import type { Pos } from '../board/layout'
import type { Board, Edge, El } from '../board/model'
import { descendants, newId, type Op } from '../board/ops'
import { absPos } from './store'

const MARK = 'jam/clipboard@1'

type Payload = { kind: typeof MARK; elements: El[]; edges: Edge[] }

/** 選択した要素（セクションなら中身ごと）と、その間の矢印を書き出す */
export function serialize(board: Board, selected: Iterable<string>): string | null {
  const map = new Map(board.elements.map((e) => [e.id, e]))
  const ids = new Set<string>()
  for (const id of selected) if (map.has(id)) for (const d of descendants(id, board.elements)) ids.add(d)
  if (!ids.size) return null
  // 親がコピーに含まれない要素は、トップレベルの絶対座標にしておく
  const elements = board.elements
    .filter((e) => ids.has(e.id))
    .map((e) => {
      if (!e.parent || ids.has(e.parent)) return e
      const { parent: _, ...rest } = e
      return { ...rest, ...absPos(e.id, map) } as El
    })
  const edges = board.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  return JSON.stringify({ kind: MARK, elements, edges } satisfies Payload)
}

function parse(text: string): Payload | null {
  try {
    const p = JSON.parse(text) as Payload
    return p?.kind === MARK && Array.isArray(p.elements) ? p : null
  } catch {
    return null
  }
}

/**
 * 貼り付ける操作を作る。id を振り直し、トップレベルの左上が `at` に来るよう平行移動する。
 * jam 以外のテキストはメモ（URL だけならリンク）にする。
 */
export function pasteOps(text: string, board: Board, at: Pos): { ops: Op[]; roots: string[] } {
  const taken = new Set([...board.elements.map((e) => e.id), ...board.edges.map((e) => e.id)])
  const fresh = (prefix: string) => {
    const id = newId(prefix, taken)
    taken.add(id)
    return id
  }

  const payload = parse(text)
  if (!payload) {
    const t = text.trim()
    if (!t) return { ops: [], roots: [] }
    const id = fresh('n')
    const op: Op = /^https?:\/\/\S+$/.test(t)
      ? { op: 'create', type: 'link', id, url: t, title: '', x: Math.round(at.x), y: Math.round(at.y) }
      : { op: 'create', type: 'note', id, text: t, x: Math.round(at.x), y: Math.round(at.y) }
    return { ops: [op], roots: [id] }
  }

  const rename = new Map(payload.elements.map((e) => [e.id, fresh(e.type)]))
  const roots = payload.elements.filter((e) => !e.parent)
  const minX = Math.min(...roots.map((e) => e.x ?? 0))
  const minY = Math.min(...roots.map((e) => e.y ?? 0))
  const ops: Op[] = payload.elements.map((e) => {
    const { id, type, parent, x, y, ...fields } = e
    const top = !parent
    return {
      op: 'create',
      type,
      id: rename.get(id)!,
      ...fields,
      ...(parent && { parent: rename.get(parent) }),
      ...(x != null && { x: Math.round(top ? x - minX + at.x : x) }),
      ...(y != null && { y: Math.round(top ? y - minY + at.y : y) }),
    }
  })
  for (const e of payload.edges) {
    const { id: _, from, to, ...fields } = e
    ops.push({ op: 'connect', id: fresh('edge'), from: rename.get(from)!, to: rename.get(to)!, ...fields })
  }
  return { ops, roots: roots.map((e) => rename.get(e.id)!) }
}
