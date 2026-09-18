import { useSyncExternalStore } from 'react'
import {
  type Board,
  type Color,
  COLOR_NAMES,
  DEFAULT_WIDTH,
  type Edge,
  type El,
  type ElType,
  emptyBoard,
} from './model'
import { dag, estimateSize, flow, GAP, type Pos, SECTION_HEADER, SECTION_PAD, type Size } from './layout'

// ---------------------------------------------------------------------------
// state

type State = {
  board: Board
  selected: ReadonlySet<string>
  editing: string | null
  measured: ReadonlyMap<string, Size>
}

const STORAGE_KEY = 'jam:board'

function load(): Board {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Board
  } catch {
    // 壊れていたら空から始める
  }
  return emptyBoard()
}

let state: State = { board: load(), selected: new Set(), editing: null, measured: new Map() }
let past: Board[] = []
let future: Board[] = []
const listeners = new Set<() => void>()

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

let saveTimer: number | undefined
function setBoard(board: Board) {
  emit({ board })
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(board)), 300)
}

export const getState = () => state
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useBoardState<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

// ---------------------------------------------------------------------------
// history

/** 現在の盤面を undo 履歴に積む。一連の変更の直前に1回だけ呼ぶ */
export function checkpoint() {
  past.push(state.board)
  if (past.length > 200) past.shift()
  future = []
}

export function undo() {
  const prev = past.pop()
  if (!prev) return
  future.push(state.board)
  setBoard(prev)
}

export function redo() {
  const next = future.pop()
  if (!next) return
  past.push(state.board)
  setBoard(next)
}

// ---------------------------------------------------------------------------
// helpers

export const byId = (b: Board) => new Map(b.elements.map((e) => [e.id, e]))

export function sizeOf(el: El): Size {
  if (el.type === 'section') return { width: el.w ?? DEFAULT_WIDTH.section, height: el.h ?? 400 }
  return state.measured.get(el.id) ?? estimateSize(el, el.w ?? DEFAULT_WIDTH[el.type])
}

export function absPos(id: string, els: Map<string, El>): Pos {
  const el = els.get(id)
  if (!el) return { x: 0, y: 0 }
  const p = el.parent ? absPos(el.parent, els) : { x: 0, y: 0 }
  return { x: p.x + (el.x ?? 0), y: p.y + (el.y ?? 0) }
}

function descendants(id: string, els: El[]): Set<string> {
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
function normalize(els: El[]): El[] {
  const map = new Map(els.map((e) => [e.id, e]))
  const depth = (e: El): number => (e.parent && map.has(e.parent) ? 1 + depth(map.get(e.parent)!) : 0)
  return els
    .map((e, i) => ({ e, i, d: depth(e) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.e)
}

function newId(type: string, taken: Set<string>): string {
  for (;;) {
    const id = `${type[0]}${Math.random().toString(36).slice(2, 6)}`
    if (!taken.has(id)) return id
  }
}

/** セクションを子要素が収まるまで広げる（縮めない）。祖先にも伝播する */
function growSections(els: El[]): El[] {
  const map = new Map(els.map((e) => [e.id, { ...e }]))
  const sections = normalize([...map.values()]).filter((e) => e.type === 'section').reverse()
  for (const s of sections) {
    if (s.type !== 'section') continue
    let right = 0
    let bottom = 0
    for (const c of map.values()) {
      if (c.parent !== s.id || c.x == null || c.y == null) continue
      const size = sizeOf(c)
      right = Math.max(right, c.x + size.width)
      bottom = Math.max(bottom, c.y + size.height)
    }
    const w = Math.max(s.w ?? DEFAULT_WIDTH.section, right + SECTION_PAD)
    const h = Math.max(s.h ?? 0, bottom + SECTION_PAD, SECTION_HEADER + 80)
    if (w !== s.w || h !== s.h) map.set(s.id, { ...s, w, h })
  }
  return els.map((e) => {
    const n = map.get(e.id)!
    return n.type === 'section' && e.type === 'section' && (n.w !== e.w || n.h !== e.h) ? n : e
  })
}

// ---------------------------------------------------------------------------
// operations (エージェントと UI の共通入口)

export type Op =
  | ({ op: 'create'; type: ElType; id?: string } & Record<string, unknown>)
  | ({ op: 'update'; id: string } & Record<string, unknown>)
  | { op: 'delete'; id: string }
  | { op: 'connect'; id?: string; from: string; to: string; label?: string; dashed?: boolean }
  | { op: 'layout'; id?: string; mode: 'grid' | 'dag' }

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

function validate(el: El, map: Map<string, El>, all: El[]) {
  if (el.color && !COLOR_NAMES.includes(el.color as Color))
    throw new Error(`unknown color "${el.color}". use one of: ${COLOR_NAMES.join(', ')}`)
  if (el.parent != null) {
    const p = map.get(el.parent)
    if (!p || p.type !== 'section') throw new Error(`parent "${el.parent}" is not a section`)
    if (descendants(el.id, all).has(el.parent)) throw new Error(`parent "${el.parent}" would create a cycle`)
  }
}

type Pending = { layouts: { id?: string; mode: 'grid' | 'dag' }[]; waiters: (() => void)[] }
const pending: Pending = { layouts: [], waiters: [] }

/**
 * 操作をまとめて適用する。1回の呼び出しが1つの undo 単位になる。
 * どれか1つでも不正なら何も変更せずに例外を投げる。
 * 座標なしで作った要素の配置が終わってから resolve する。
 */
export function apply(ops: Op[], opts: { record?: boolean } = {}): Promise<{ ids: string[] }> {
  let els = [...state.board.elements]
  let edges = [...state.board.edges]
  const ids: string[] = []
  const layouts: Pending['layouts'] = []
  const taken = () => new Set([...els.map((e) => e.id), ...edges.map((e) => e.id)])

  ops.forEach((op, i) => {
    try {
      const map = new Map(els.map((e) => [e.id, e]))
      switch (op.op) {
        case 'create': {
          if (!(op.type in CREATE_FIELDS)) throw new Error(`unknown type "${op.type}"`)
          const t = taken()
          if (op.id && t.has(op.id)) throw new Error(`id "${op.id}" already exists`)
          const id = op.id ?? newId(op.type, t)
          const el = {
            ...pick(op, [...COMMON_FIELDS, ...CREATE_FIELDS[op.type]]),
            id,
            type: op.type,
          } as El
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
            if (!map.has(next.from) || !map.has(next.to)) throw new Error(`edge endpoints must be elements`)
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
          if (map.has(op.id)) {
            const gone = descendants(op.id, els)
            els = els.filter((e) => !gone.has(e.id))
            edges = edges.filter((e) => !gone.has(e.from) && !gone.has(e.to))
          } else {
            // 存在しない id は無視する（親と子、ノードと接続エッジを同時に消すケース）
            edges = edges.filter((e) => e.id !== op.id)
          }
          ids.push(op.id)
          break
        }
        case 'connect': {
          if (!map.has(op.from)) throw new Error(`no element "${op.from}"`)
          if (!map.has(op.to)) throw new Error(`no element "${op.to}"`)
          const existing = op.id ? edges.find((e) => e.id === op.id) : undefined
          const edge = { ...existing, ...pick(op, EDGE_FIELDS), id: op.id ?? newId('edge', taken()) } as Edge
          edges = existing ? edges.map((e) => (e.id === edge.id ? edge : e)) : [...edges, edge]
          ids.push(edge.id)
          break
        }
        case 'layout': {
          if (op.id && map.get(op.id)?.type !== 'section') throw new Error(`"${op.id}" is not a section`)
          layouts.push({ id: op.id, mode: op.mode })
          ids.push(op.id ?? '')
          break
        }
        default:
          throw new Error(`unknown op "${(op as { op: string }).op}"`)
      }
    } catch (e) {
      throw new Error(`ops[${i}]: ${(e as Error).message}`, { cause: e })
    }
  })

  if (opts.record !== false) checkpoint()
  setBoard({ elements: normalize(els), edges })
  pending.layouts.push(...layouts)
  return new Promise((resolve) => {
    pending.waiters.push(() => resolve({ ids }))
    scheduleFlush()
  })
}

// ---------------------------------------------------------------------------
// 自動配置: 寸法が測れてから座標を決める

let flushTimer: number | undefined
let flushDeadline = 0
let flushing = false

function scheduleFlush() {
  if (!flushDeadline) flushDeadline = Date.now() + 500
  clearTimeout(flushTimer)
  flushTimer = window.setTimeout(flush, 16)
}

async function flush() {
  if (flushing) return scheduleFlush()
  const unplaced = state.board.elements.filter((e) => e.x == null || e.y == null)
  const unmeasured = unplaced.some((e) => e.type !== 'section' && !state.measured.has(e.id))
  // 測れない（バックグラウンドタブなど）ときは概算サイズで進める
  if (unmeasured && Date.now() < flushDeadline) return scheduleFlush()
  flushDeadline = 0
  flushing = true
  try {
    // 深い階層から順に「子を配置 → そのセクションのレイアウト → セクションを広げる」を行い、
    // 大きさが確定してから親の中に配置する
    const layouts = pending.layouts.splice(0)
    const map = byId(state.board)
    const depth = (id: string | undefined): number => {
      const p = id ? map.get(id)?.parent : undefined
      return id ? 1 + depth(p) : -1
    }
    const maxDepth = Math.max(0, ...state.board.elements.map((e) => depth(e.id)))
    for (let d = maxDepth; d >= 0; d--) {
      setBoard({ ...state.board, elements: growSections(place(state.board.elements, d, depth)) })
      for (const l of layouts.filter((l) => depth(l.id) === d - 1)) await runLayout(l.id, l.mode)
    }
  } finally {
    flushing = false
  }
  pending.waiters.splice(0).forEach((w) => w())
}

function place(els: El[], atDepth: number, depth: (id: string) => number): El[] {
  const map = new Map(els.map((e) => [e.id, e]))
  const groups = new Map<string | undefined, El[]>()
  for (const e of els)
    if ((e.x == null || e.y == null) && depth(e.id) === atDepth) groups.set(e.parent, [...(groups.get(e.parent) ?? []), e])

  const positions = new Map<string, Pos>()
  for (const [parent, items] of groups) {
    const siblings = els.filter((e) => e.parent === parent && e.x != null && e.y != null)
    const rects = siblings.map((e) => ({ x: e.x!, y: e.y!, ...sizeOf(e) }))
    let origin: Pos
    let maxWidth: number
    if (parent) {
      const s = map.get(parent)!
      maxWidth = (s.w ?? DEFAULT_WIDTH.section) - SECTION_PAD * 2
      const bottom = Math.max(SECTION_HEADER - GAP, ...rects.map((r) => r.y + r.height))
      origin = { x: SECTION_PAD, y: bottom + GAP }
    } else if (rects.length) {
      // トップレベルは既存の内容の右側に並べる
      origin = { x: Math.max(...rects.map((r) => r.x + r.width)) + 120, y: Math.min(...rects.map((r) => r.y)) }
      maxWidth = 2400
    } else {
      origin = { x: 0, y: 0 }
      maxWidth = 2400
    }
    const sized = items.map((e) => ({ id: e.id, size: sizeOf(e) }))
    for (const [id, p] of flow(sized, origin, maxWidth)) positions.set(id, p)
  }
  return els.map((e) => (positions.has(e.id) ? { ...e, ...positions.get(e.id) } : e))
}

async function runLayout(id: string | undefined, mode: 'grid' | 'dag') {
  const els = state.board.elements
  const children = els
    .filter((e) => e.parent === id)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
  const items = children.map((e) => ({ id: e.id, size: sizeOf(e) }))
  const section = id ? els.find((e) => e.id === id) : undefined
  const origin = section ? { x: SECTION_PAD, y: SECTION_HEADER } : { x: 0, y: 0 }
  const positions =
    mode === 'dag'
      ? await dag(items, state.board.edges, origin)
      : flow(items, origin, section ? (section.w ?? DEFAULT_WIDTH.section) - SECTION_PAD * 2 : 2400)
  let next = state.board.elements.map((e) => (positions.has(e.id) ? { ...e, ...positions.get(e.id) } : e))
  // 並べ直した後はぴったり包むように縮めてから広げる
  if (section?.type === 'section')
    next = next.map((e) => (e.id === id ? ({ ...e, w: SECTION_PAD * 2, h: 0 } as El) : e))
  setBoard({ ...state.board, elements: growSections(next) })
}

/** UI からのレイアウト実行（undo 可能） */
export function layout(id: string | undefined, mode: 'grid' | 'dag') {
  return apply([{ op: 'layout', id, mode }])
}

// ---------------------------------------------------------------------------
// UI 専用の更新

export function setSelected(ids: Iterable<string>) {
  emit({ selected: new Set(ids) })
}

export function setEditing(id: string | null) {
  emit({ editing: id })
}

export function setMeasured(updates: [string, Size][]) {
  const m = new Map(state.measured)
  for (const [id, s] of updates) m.set(id, s)
  emit({ measured: m })
  if (state.board.elements.some((e) => e.x == null || e.y == null)) scheduleFlush()
}

/** ドラッグ中の位置更新（履歴には積まない。ドラッグ開始時に checkpoint 済み） */
export function movePositions(moves: Map<string, Pos>) {
  setBoard({
    ...state.board,
    elements: state.board.elements.map((e) => (moves.has(e.id) ? { ...e, ...moves.get(e.id) } : e)),
  })
}

/** 幅や高さの変更（リサイズ中。開始時に checkpoint 済み） */
export function resizeElement(id: string, size: { x?: number; y?: number; w?: number; h?: number }) {
  setBoard({
    ...state.board,
    elements: state.board.elements.map((e) => (e.id === id ? ({ ...e, ...size } as El) : e)),
  })
}

/** ドロップ位置に応じて所属セクションを変える */
export function dropElements(ids: string[]) {
  let els = state.board.elements
  for (const id of ids) {
    const map = new Map(els.map((e) => [e.id, e]))
    const el = map.get(id)
    if (!el) continue
    // 一緒に動いた親の子はそのまま
    if (el.parent && ids.includes(el.parent)) continue
    const abs = absPos(id, map)
    const size = sizeOf(el)
    const cx = abs.x + size.width / 2
    const cy = abs.y + size.height / 2
    const excluded = descendants(id, els)
    let target: El | undefined
    for (const s of els) {
      if (s.type !== 'section' || excluded.has(s.id)) continue
      const p = absPos(s.id, map)
      const ss = sizeOf(s)
      if (cx >= p.x && cx <= p.x + ss.width && cy >= p.y && cy <= p.y + ss.height) target = s // 後ろほど深い
    }
    if (target?.id === el.parent) continue
    const origin = target ? absPos(target.id, map) : { x: 0, y: 0 }
    const moved = { ...el, parent: target?.id, x: abs.x - origin.x, y: abs.y - origin.y } as El
    if (!target) delete moved.parent
    els = els.map((e) => (e.id === id ? moved : e))
  }
  setBoard({ ...state.board, elements: growSections(normalize(els)) })
}
