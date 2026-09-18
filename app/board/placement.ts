// 未配置の要素に座標を与え、保留中のレイアウト要求を実行する。
// 寸法の測り方だけを外から渡す: ブラウザは実寸、サーバーは概算（estimateSize）。
import { dag, flow, GAP, type Pos, SECTION_HEADER, SECTION_PAD, type Size } from './layout'
import { type Board, DEFAULT_WIDTH, type El, type LayoutRequest } from './model'
import { type Coords, normalize, type Op } from './ops'

export type SizeOf = (el: El) => Size

/** セクションの寸法は要素自身が持つ。それ以外は計測/概算に任せる */
export function withSectionSize(sizeOf: SizeOf): SizeOf {
  return (el) =>
    el.type === 'section' ? { width: el.w ?? DEFAULT_WIDTH.section, height: el.h ?? 400 } : sizeOf(el)
}

/** セクションを子要素が収まるまで広げる（縮めない）。祖先にも伝播する */
export function growSections(els: El[], sizeOf: SizeOf): El[] {
  const size = withSectionSize(sizeOf)
  const map = new Map(els.map((e) => [e.id, { ...e }]))
  const sections = normalize([...map.values()]).filter((e) => e.type === 'section').reverse()
  for (const s of sections) {
    if (s.type !== 'section') continue
    let right = 0
    let bottom = 0
    for (const c of map.values()) {
      if (c.parent !== s.id || c.x == null || c.y == null) continue
      const sz = size(c)
      right = Math.max(right, c.x + sz.width)
      bottom = Math.max(bottom, c.y + sz.height)
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

function placeAtDepth(els: El[], atDepth: number, depth: (id: string) => number, sizeOf: SizeOf): El[] {
  const size = withSectionSize(sizeOf)
  const map = new Map(els.map((e) => [e.id, e]))
  const groups = new Map<string | undefined, El[]>()
  for (const e of els)
    if ((e.x == null || e.y == null) && depth(e.id) === atDepth) groups.set(e.parent, [...(groups.get(e.parent) ?? []), e])

  const positions = new Map<string, Pos>()
  for (const [parent, items] of groups) {
    const siblings = els.filter((e) => e.parent === parent && e.x != null && e.y != null)
    const rects = siblings.map((e) => ({ x: e.x!, y: e.y!, ...size(e) }))
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
    for (const [id, p] of flow(items.map((e) => ({ id: e.id, size: size(e) })), origin, maxWidth)) positions.set(id, p)
  }
  return els.map((e) => (positions.has(e.id) ? { ...e, ...positions.get(e.id) } : e))
}

async function runLayout(els: El[], board: Board, req: LayoutRequest, sizeOf: SizeOf): Promise<El[]> {
  const size = withSectionSize(sizeOf)
  const children = els
    .filter((e) => e.parent === req.id)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
  const items = children.map((e) => ({ id: e.id, size: size(e) }))
  const section = req.id ? els.find((e) => e.id === req.id) : undefined
  if (req.id && !section) return els
  const origin = section ? { x: SECTION_PAD, y: SECTION_HEADER } : { x: 0, y: 0 }
  const positions =
    req.mode === 'dag'
      ? dag(items, board.edges, origin)
      : flow(items, origin, section ? (section.w ?? DEFAULT_WIDTH.section) - SECTION_PAD * 2 : 2400)
  let next = els.map((e) => (positions.has(e.id) ? { ...e, ...positions.get(e.id) } : e))
  // 並べ直した後はぴったり包むように縮めてから広げる
  if (section) next = next.map((e) => (e.id === req.id ? ({ ...e, w: SECTION_PAD * 2, h: 0 } as El) : e))
  return growSections(next, sizeOf)
}

/**
 * 深い階層から順に「子を配置 → そのセクションのレイアウト → セクションを広げる」を行い、
 * 大きさが確定してから親の中に配置する。戻り値の layouts は空になる。
 */
export async function placeBoard(board: Board, sizeOf: SizeOf): Promise<Board> {
  const layouts = board.layouts ?? []
  const map = new Map(board.elements.map((e) => [e.id, e]))
  const depth = (id: string | undefined, seen = 0): number => {
    const p = id ? map.get(id)?.parent : undefined
    return id && seen < 32 ? 1 + depth(p, seen + 1) : -1
  }
  const maxDepth = Math.max(0, ...board.elements.map((e) => depth(e.id)))
  let els = board.elements
  for (let d = maxDepth; d >= 0; d--) {
    els = growSections(placeAtDepth(els, d, depth, sizeOf), sizeOf)
    for (const l of layouts.filter((l) => depth(l.id) === d - 1)) els = await runLayout(els, board, l, sizeOf)
  }
  const { layouts: _, ...rest } = board
  return { ...rest, elements: els }
}

/**
 * 配置結果を「座標と大きさだけの上書き」にする。
 * 配置を計算している間に中身が編集されても、それを上書きしないため。
 */
export function placementOp(before: Board, after: Board): Op {
  const prev = new Map(before.elements.map((e) => [e.id, e as El & { h?: number }]))
  const coords: Record<string, Coords> = {}
  for (const e of after.elements as (El & { h?: number })[]) {
    const p = prev.get(e.id)
    if (!p) continue
    const c: Coords = {}
    for (const k of ['x', 'y', 'w', 'h'] as const) if (e[k] != null && e[k] !== p[k]) c[k] = e[k]
    if (Object.keys(c).length) coords[e.id] = c
  }
  return { op: 'patch', coords, clearLayouts: true }
}
