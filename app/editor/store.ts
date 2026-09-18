// ブラウザ側の盤面。サーバー（BoardRoom）の正本に、まだ確認されていない自分の操作を重ねて表示する。
import { useSyncExternalStore } from 'react'
import { estimateSize, type Pos, type Size } from '../board/layout'
import { type Board, DEFAULT_WIDTH, type El, emptyBoard, needsPlacement, type Patch } from '../board/model'
import { applyOps, descendants, diff, type Op, patchOp, withIds } from '../board/ops'
import { growSections, placeBoard, placementOp } from '../board/placement'
import type { ClientMessage, ServerMessage } from '../board/protocol'

type Overlay = Partial<{ x: number; y: number; w: number; h: number }>

type State = {
  /** 表示中の盤面 = 正本 + 未確認の自分の操作 */
  board: Board
  /** ドラッグ・リサイズ中の仮の位置と大きさ（確定時に commit する） */
  overlay: ReadonlyMap<string, Overlay>
  selected: ReadonlySet<string>
  editing: string | null
  measured: ReadonlyMap<string, Size>
  connected: boolean
  /** 自動配置を担当するタブか */
  primary: boolean
  /** サーバーとの接続を再開できない理由（ボード削除など） */
  closed: string | null
  /** 最初の盤面が届いたか */
  loaded: boolean
}

const initial = (): State => ({
  board: emptyBoard(),
  overlay: new Map(),
  selected: new Set(),
  editing: null,
  measured: new Map(),
  connected: false,
  primary: false,
  closed: null,
  loaded: false,
})

let state = initial()
const listeners = new Set<() => void>()

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
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
// 同期

type Pending = { batch: number; ops: Op[]; resolve: () => void; reject: (e: Error) => void }
type HistoryEntry = { batch?: number; before: Patch; after: Patch }

let confirmed: Board = emptyBoard()
let pending: Pending[] = []
let seq = 0
let clientId = ''
let socket: WebSocket | null = null
let past: HistoryEntry[] = []
let future: HistoryEntry[] = []
let stopConnection: (() => void) | undefined

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** 正本に未確認の操作を重ね直す。適用できなくなった操作（他の人が消した要素への変更など）は捨てる */
function rebuild() {
  let b = confirmed
  pending = pending.filter((p) => {
    try {
      b = applyOps(b, p.ops).board
      return true
    } catch (e) {
      p.reject(e as Error)
      return false
    }
  })
  emit({ board: b })
  schedulePlacement()
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'hello':
      clientId = msg.client
      emit({ primary: msg.primary })
      // 切断中に溜まった操作を送り直す（適用済みのものはサーバー側で id 重複として弾かれる）
      for (const p of pending) send({ type: 'ops', batch: p.batch, ops: p.ops })
      break
    case 'role':
      emit({ primary: msg.primary })
      schedulePlacement()
      break
    case 'state':
      confirmed = msg.board
      if (msg.ack?.client === clientId) {
        const done = pending.filter((p) => p.batch <= msg.ack!.batch)
        pending = pending.filter((p) => p.batch > msg.ack!.batch)
        done.forEach((p) => p.resolve())
      }
      // エージェントの変更も自分の undo で戻せるようにする
      if (msg.change?.by === 'agent') {
        past.push({ before: msg.change.before, after: msg.change.after })
        future = []
      } else if (msg.change) {
        refreshHistory(msg.change.after)
      }
      if (!state.loaded) emit({ loaded: true })
      rebuild()
      break
    case 'deleted':
      emit({ closed: 'このボードは削除されました' })
      stopConnection?.()
      break
    case 'error': {
      const p = pending.find((x) => x.batch === msg.batch)
      pending = pending.filter((x) => x.batch !== msg.batch)
      past = past.filter((h) => h.batch !== msg.batch)
      p?.reject(new Error(msg.message))
      console.warn('[jam] rejected by server:', msg.message)
      rebuild()
      break
    }
  }
}

/**
 * 自動配置で座標が決まったら、未配置のまま記録された履歴の「変更後」も差し替える。
 * そうしないと redo で未配置に戻り、別の並びに配置し直されてしまう。
 */
function refreshHistory(after: Patch) {
  for (const h of [...past.slice(-10), ...future.slice(-10)]) {
    for (const [id, el] of Object.entries(after.elements)) {
      const rec = h.after.elements[id]
      if (el && rec && (rec.x == null || rec.y == null)) h.after.elements[id] = el
    }
  }
}

/** ボードを開く。戻り値で接続を閉じる */
export function connect(boardId: string) {
  state = initial()
  confirmed = emptyBoard()
  pending = []
  past = []
  future = []
  listeners.forEach((l) => l())

  let retry = 1000
  let stopped = false
  let timer: number | undefined
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/boards/${boardId}/ws`)
    socket = ws
    ws.onopen = () => {
      retry = 1000
      emit({ connected: true })
    }
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data as string) as ServerMessage)
    ws.onclose = async (ev) => {
      if (socket === ws) socket = null
      emit({ connected: false, primary: false })
      if (ev.code === 4404) return emit({ closed: 'このボードは削除されました' })
      if (stopped) return
      // つながらない理由がボードの削除やログアウトなら、再接続しても無駄なので止める
      const status = await fetch(`/api/boards/${boardId}/ws`).then((r) => r.status).catch(() => 0)
      if (status === 404) return emit({ closed: 'このボードは見つかりません（削除された可能性があります）' })
      if (status === 401) return emit({ closed: 'ログインが切れました。ページを再読み込みしてください' })
      if (stopped) return
      timer = window.setTimeout(open, retry)
      retry = Math.min(retry * 2, 10000)
    }
  }
  open()
  stopConnection = () => {
    stopped = true
    clearTimeout(timer)
    socket?.close()
    socket = null
  }
  return stopConnection
}

// ---------------------------------------------------------------------------
// 操作

/**
 * 操作をまとめて適用する（楽観的に表示へ反映し、サーバーへ送る）。
 * 不正なら例外。戻り値の done はサーバーが受け付けたら resolve する。
 */
export function commit(ops: Op[], opts: { record?: boolean } = {}): { ids: string[]; done: Promise<void> } {
  const full = withIds(state.board, ops)
  const before = state.board
  const { board, ids } = applyOps(before, full)
  const batch = ++seq
  const change = diff(before, board)
  if (opts.record !== false && change) {
    past.push({ batch, ...change })
    if (past.length > 200) past.shift()
    future = []
  }
  let resolve!: () => void
  let reject!: (e: Error) => void
  const done = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  done.catch(() => {}) // 呼び出し側が待たなくても未処理にしない
  pending.push({ batch, ops: full, resolve, reject })
  send({ type: 'ops', batch, ops: full })
  emit({ board })
  schedulePlacement()
  return { ids, done }
}

/** UI から使う: 失敗してもコンソールに出すだけ */
export function tryCommit(ops: Op[], opts?: { record?: boolean }) {
  try {
    return commit(ops, opts).ids
  } catch (e) {
    console.warn('[jam]', (e as Error).message)
    return []
  }
}

export function undo() {
  const h = past.pop()
  if (!h) return
  try {
    commit([patchOp(h.before)], { record: false })
    future.push(h)
  } catch (e) {
    console.warn('[jam] undo failed:', (e as Error).message)
  }
}

export function redo() {
  const h = future.pop()
  if (!h) return
  try {
    commit([patchOp(h.after)], { record: false })
    past.push(h)
  } catch (e) {
    console.warn('[jam] redo failed:', (e as Error).message)
  }
}

// ---------------------------------------------------------------------------
// 寸法と自動配置（primary のタブだけが行う。結果は座標だけの上書きとして送る）

export function sizeOf(el: El): Size {
  if (el.type === 'section') return { width: el.w ?? DEFAULT_WIDTH.section, height: el.h ?? 400 }
  return state.measured.get(el.id) ?? estimateSize(el, el.w ?? DEFAULT_WIDTH[el.type])
}

let placeTimer: number | undefined
let placeDeadline = 0
let placing = false

function schedulePlacement() {
  if (!state.primary || !state.connected || !needsPlacement(state.board)) {
    placeDeadline = 0
    return
  }
  if (!placeDeadline) placeDeadline = Date.now() + 500
  clearTimeout(placeTimer)
  placeTimer = window.setTimeout(place, 16)
}

async function place() {
  if (placing) return schedulePlacement()
  const board = state.board
  if (!state.primary || !needsPlacement(board)) return
  const unmeasured = board.elements.some((e) => (e.x == null || e.y == null) && e.type !== 'section' && !state.measured.has(e.id))
  // 測れない（バックグラウンドタブなど）ときは概算サイズで進める
  if (unmeasured && Date.now() < placeDeadline) return schedulePlacement()
  placeDeadline = 0
  placing = true
  try {
    const placed = await placeBoard(board, sizeOf)
    tryCommit([placementOp(board, placed)], { record: false })
  } finally {
    placing = false
  }
}

let sizesTimer: number | undefined
let unsentSizes: Record<string, [number, number]> = {}

export function setMeasured(updates: [string, Size][]) {
  const m = new Map(state.measured)
  for (const [id, s] of updates) {
    m.set(id, s)
    unsentSizes[id] = [Math.round(s.width), Math.round(s.height)]
  }
  emit({ measured: m })
  schedulePlacement()
  // サーバー側の概算配置に実寸を使ってもらう
  clearTimeout(sizesTimer)
  sizesTimer = window.setTimeout(() => {
    if (!state.primary) return
    send({ type: 'sizes', sizes: unsentSizes })
    unsentSizes = {}
  }, 1000)
}

/** エージェント向け: 自動配置まで終わるのを待つ */
export async function settled(timeout = 4000) {
  const end = Date.now() + timeout
  while (needsPlacement(state.board) && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
}

// ---------------------------------------------------------------------------
// UI 専用の状態

export function setSelected(ids: Iterable<string>) {
  emit({ selected: new Set(ids) })
}

export function setEditing(id: string | null) {
  emit({ editing: id })
}

export function setOverlay(updates: Map<string, Overlay>) {
  const next = new Map(state.overlay)
  for (const [id, o] of updates) next.set(id, { ...next.get(id), ...o })
  emit({ overlay: next })
}

/** 仮の位置・大きさを確定させる */
export function commitOverlay() {
  const ops: Op[] = [...state.overlay].map(([id, o]) => ({ op: 'update' as const, id, ...o }))
  emit({ overlay: new Map() })
  if (ops.length) tryCommit(ops)
}

export const byId = (b: Board) => new Map(b.elements.map((e) => [e.id, e]))

export function absPos(id: string, els: Map<string, El>): Pos {
  const el = els.get(id)
  if (!el) return { x: 0, y: 0 }
  const p = el.parent ? absPos(el.parent, els) : { x: 0, y: 0 }
  return { x: p.x + (el.x ?? 0), y: p.y + (el.y ?? 0) }
}

/** ドラッグの確定。落とした位置に応じて所属セクションも変える */
export function dropElements(ids: string[]) {
  // 仮の位置を反映した盤面で判定する
  const els = state.board.elements.map((e) => ({ ...e, ...state.overlay.get(e.id) }) as El)
  emit({ overlay: new Map() })
  const map = new Map(els.map((e) => [e.id, e]))
  const moved = new Map<string, El>()
  for (const id of ids) {
    const el = map.get(id)
    if (!el) continue
    const abs = absPos(id, map)
    const size = sizeOf(el)
    const cx = abs.x + size.width / 2
    const cy = abs.y + size.height / 2
    const excluded = descendants(id, els)
    let target: El | undefined
    // 一緒に動かした親の子は、親についていく
    if (!(el.parent && ids.includes(el.parent))) {
      for (const s of els) {
        if (s.type !== 'section' || excluded.has(s.id) || ids.includes(s.id)) continue
        const p = absPos(s.id, map)
        const ss = sizeOf(s)
        if (cx >= p.x && cx <= p.x + ss.width && cy >= p.y && cy <= p.y + ss.height) target = s // 後ろほど深い
      }
    } else {
      target = map.get(el.parent)
    }
    const origin = target ? absPos(target.id, map) : { x: 0, y: 0 }
    const next = { ...el, x: Math.round(abs.x - origin.x), y: Math.round(abs.y - origin.y) } as El
    if (target) next.parent = target.id
    else delete next.parent
    moved.set(id, next)
  }
  // 動かした結果、親セクションからはみ出した分は広げる
  const after = growSections(
    els.map((e) => moved.get(e.id) ?? e),
    sizeOf,
  )
  const ops: Op[] = []
  const prev = byId(state.board)
  for (const e of after) {
    const p = prev.get(e.id)
    if (!p) continue
    const changed = moved.has(e.id) || JSON.stringify(p) !== JSON.stringify(e)
    if (!changed) continue
    const { id, type: _t, ...fields } = e as El & Record<string, unknown>
    ops.push({ op: 'update', id, ...fields, parent: e.parent ?? null })
  }
  if (ops.length) tryCommit(ops)
}
