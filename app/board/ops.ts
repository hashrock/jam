// 盤面への操作の適用。ブラウザ（楽観的更新）とサーバー（正本）の両方で同じ関数を使う。
import {
  type Board,
  type Color,
  COLOR_NAMES,
  type Edge,
  type El,
  type ElType,
  type LayoutMode,
  type Patch,
} from './model'

export type Op =
  | ({ op: 'create'; type: ElType; id?: string } & Record<string, unknown>)
  | ({ op: 'update'; id: string } & Record<string, unknown>)
  | { op: 'delete'; id: string }
  | { op: 'connect'; id?: string; from: string; to: string; label?: string; dashed?: boolean }
  | { op: 'layout'; id?: string; mode: LayoutMode }
  /**
   * 要素・矢印を丸ごと置き換える（null で削除）。undo/redo に使う。
   * coords は自動配置の結果で、座標と大きさだけを上書きする（消えた要素は無視）
   */
  | {
      op: 'patch'
      elements?: Patch['elements']
      edges?: Patch['edges']
      coords?: Record<string, Coords>
      clearLayouts?: boolean
    }

export type Coords = { x?: number; y?: number; w?: number; h?: number }

const CREATE_FIELDS: Record<ElType, string[]> = {
  section: ['title', 'h'],
  note: ['text'],
  task: ['text', 'done'],
  link: ['url', 'title'],
  box: ['text', 'shape'],
  code: ['code', 'lang'],
  text: ['text', 'size'],
}
const COMMON_FIELDS = ['parent', 'x', 'y', 'w', 'color']
const EDGE_FIELDS = ['from', 'to', 'label', 'dashed']

function pick(src: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in src) out[k] = src[k]
  return out
}

export function descendants(id: string, els: El[]): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of els) {
      if (e.parent && out.has(e.parent) && !out.has(e.id)) {
        out.add(e.id)
        grew = true
      }
    }
  }
  return out
}

/** 親が子より前に来るよう並べ直す（元の順序はなるべく保つ） */
export function normalize(els: El[]): El[] {
  const map = new Map(els.map((e) => [e.id, e]))
  const depth = (e: El, seen = 0): number =>
    e.parent && map.has(e.parent) && seen < 32 ? 1 + depth(map.get(e.parent)!, seen + 1) : 0
  return els
    .map((e, i) => ({ e, i, d: depth(e) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.e)
}

/** 同時編集で壊れた参照を直す（消えた親を外す、端点の消えた矢印を消す） */
function sanitize(board: Board): Board {
  const map = new Map(board.elements.map((e) => [e.id, e]))
  const elements = board.elements.map((e) => {
    if (!e.parent || map.get(e.parent)?.type === 'section') return e
    const { parent: _, ...rest } = e
    return rest as El
  })
  const edges = board.edges.filter((e) => map.has(e.from) && map.has(e.to))
  return { ...board, elements: normalize(elements), edges }
}

export function newId(prefix: string, taken: Set<string>): string {
  for (;;) {
    const id = `${prefix[0]}${Math.random().toString(36).slice(2, 7)}`
    if (!taken.has(id)) return id
  }
}

/** id を省いた create / connect に id を振る。送る前に確定させておけば、どこで適用しても同じ結果になる */
export function withIds(board: Board, ops: Op[]): Op[] {
  const taken = new Set([...board.elements.map((e) => e.id), ...board.edges.map((e) => e.id)])
  return ops.map((op) => {
    if ((op.op === 'create' || op.op === 'connect') && !op.id) {
      const id = newId(op.op === 'create' ? op.type : 'edge', taken)
      taken.add(id)
      return { ...op, id }
    }
    return op
  })
}

/** リンクとして開いてよい URL か（javascript: などを入れさせない） */
export const isWebUrl = (url: string) => /^https?:\/\//i.test(url)

function validate(el: El, map: Map<string, El>, all: El[]) {
  if (el.color && !COLOR_NAMES.includes(el.color as Color))
    throw new Error(`unknown color "${el.color}". use one of: ${COLOR_NAMES.join(', ')}`)
  if (el.type === 'link' && el.url && !isWebUrl(el.url))
    throw new Error(`url must start with http:// or https:// (got "${el.url}")`)
  if (el.parent != null) {
    const p = map.get(el.parent)
    if (!p || p.type !== 'section') throw new Error(`parent "${el.parent}" is not a section`)
    if (descendants(el.id, all).has(el.parent)) throw new Error(`parent "${el.parent}" would create a cycle`)
  }
}

/**
 * 操作をまとめて適用する。どれか1つでも不正なら例外を投げ、盤面は変えない。
 * 座標を省いた要素は未配置のまま残る（自動配置は placement.ts）。
 */
export function applyOps(board: Board, input: Op[]): { board: Board; ids: string[] } {
  const ops = withIds(board, input)
  let els = [...board.elements]
  let edges = [...board.edges]
  let layouts = [...(board.layouts ?? [])]
  const ids: string[] = []

  ops.forEach((op, i) => {
    try {
      const map = new Map(els.map((e) => [e.id, e]))
      const edgeIds = new Set(edges.map((e) => e.id))
      switch (op.op) {
        case 'create': {
          if (!Object.hasOwn(CREATE_FIELDS, op.type)) throw new Error(`unknown type "${op.type}"`)
          const id = op.id!
          if (map.has(id) || edgeIds.has(id)) throw new Error(`id "${id}" already exists`)
          const el = { ...pick(op, [...COMMON_FIELDS, ...CREATE_FIELDS[op.type]]), id, type: op.type } as El
          if (el.type === 'section') el.title ??= ''
          else if (el.type === 'code') el.code ??= ''
          else if (el.type === 'link') el.url ??= ''
          else el.text ??= ''
          validate(el, new Map([...map, [id, el]]), [...els, el])
          els.push(el)
          ids.push(id)
          break
        }
        case 'update': {
          const edge = edges.find((e) => e.id === op.id)
          if (edge) {
            const next = { ...edge, ...pick(op, EDGE_FIELDS) } as Edge
            for (const [k, v] of Object.entries(next)) if (v === null) delete (next as Record<string, unknown>)[k]
            if (!map.has(next.from) || !map.has(next.to)) throw new Error('edge endpoints must be elements')
            edges = edges.map((e) => (e.id === op.id ? next : e))
            ids.push(op.id)
            break
          }
          const cur = map.get(op.id)
          if (!cur) throw new Error(`no element or edge "${op.id}"`)
          const patch = pick(op, [...COMMON_FIELDS, ...CREATE_FIELDS[cur.type]])
          const next = { ...cur, ...patch } as El
          for (const [k, v] of Object.entries(patch)) if (v === null) delete (next as Record<string, unknown>)[k]
          // 親を変えて座標を指定しなかったら、新しい親の中で自動配置する
          if ('parent' in patch && patch.parent !== cur.parent && !('x' in patch || 'y' in patch)) {
            delete next.x
            delete next.y
          }
          validate(next, map, els)
          els = els.map((e) => (e.id === op.id ? next : e))
          ids.push(op.id)
          break
        }
        case 'delete': {
          // 存在しない id は無視する（親と子、ノードと接続エッジを同時に消すケース）
          const gone = map.has(op.id) ? descendants(op.id, els) : new Set([op.id])
          els = els.filter((e) => !gone.has(e.id))
          edges = edges.filter((e) => !gone.has(e.id) && !gone.has(e.from) && !gone.has(e.to))
          ids.push(op.id)
          break
        }
        case 'connect': {
          if (!map.has(op.from)) throw new Error(`no element "${op.from}"`)
          if (!map.has(op.to)) throw new Error(`no element "${op.to}"`)
          if (map.has(op.id!)) throw new Error(`id "${op.id}" is an element`)
          const existing = edges.find((e) => e.id === op.id)
          const edge = { ...existing, ...pick(op, EDGE_FIELDS), id: op.id } as Edge
          edges = existing ? edges.map((e) => (e.id === edge.id ? edge : e)) : [...edges, edge]
          ids.push(edge.id)
          break
        }
        case 'layout': {
          if (op.id && map.get(op.id)?.type !== 'section') throw new Error(`"${op.id}" is not a section`)
          if (op.mode !== 'grid' && op.mode !== 'dag') throw new Error('mode must be "grid" or "dag"')
          layouts.push(op.id ? { id: op.id, mode: op.mode } : { mode: op.mode })
          ids.push(op.id ?? '')
          break
        }
        case 'patch': {
          for (const [id, el] of Object.entries(op.elements ?? {})) {
            if (el && el.id !== id) throw new Error(`patch key "${id}" does not match element id`)
            const exists = els.some((e) => e.id === id)
            if (!el) els = els.filter((e) => e.id !== id)
            else els = exists ? els.map((e) => (e.id === id ? el : e)) : [...els, el]
          }
          for (const [id, edge] of Object.entries(op.edges ?? {})) {
            const exists = edges.some((e) => e.id === id)
            if (!edge) edges = edges.filter((e) => e.id !== id)
            else edges = exists ? edges.map((e) => (e.id === id ? edge : e)) : [...edges, edge]
          }
          if (op.coords) {
            els = els.map((e) => {
              const c = op.coords![e.id]
              if (!c) return e
              const next = { ...e } as El & { h?: number }
              for (const k of ['x', 'y', 'w', 'h'] as const) {
                if (typeof c[k] !== 'number') continue
                if (k === 'h' && e.type !== 'section') continue
                next[k] = c[k]
              }
              return next
            })
          }
          if (op.clearLayouts) layouts = []
          break
        }
        default:
          throw new Error(`unknown op "${(op as { op: string }).op}"`)
      }
    } catch (e) {
      throw new Error(`ops[${i}]: ${(e as Error).message}`, { cause: e })
    }
  })

  const next: Board = { elements: els, edges }
  if (layouts.length) next.layouts = layouts
  return { board: sanitize(next), ids }
}

// ---------------------------------------------------------------------------
// 差分

/** before → after で変わった要素・矢印。before 側を適用すれば元に戻る */
export function diff(before: Board, after: Board): { before: Patch; after: Patch } | null {
  const out = { before: { elements: {}, edges: {} } as Patch, after: { elements: {}, edges: {} } as Patch }
  let changed = false
  const walk = <T extends { id: string }>(a: T[], b: T[], key: 'elements' | 'edges') => {
    const am = new Map(a.map((x) => [x.id, x]))
    const bm = new Map(b.map((x) => [x.id, x]))
    for (const id of new Set([...am.keys(), ...bm.keys()])) {
      const x = am.get(id)
      const y = bm.get(id)
      if (x === y || JSON.stringify(x) === JSON.stringify(y)) continue
      ;(out.before[key] as Record<string, T | null>)[id] = x ?? null
      ;(out.after[key] as Record<string, T | null>)[id] = y ?? null
      changed = true
    }
  }
  walk(before.elements, after.elements, 'elements')
  walk(before.edges, after.edges, 'edges')
  return changed ? out : null
}

export const patchOp = (p: Patch, clearLayouts?: boolean): Op => ({ op: 'patch', ...p, ...(clearLayouts && { clearLayouts }) })
