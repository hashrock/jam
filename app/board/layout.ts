import type { El } from './model'
import { anchors, bezierAt, type Rect } from './route.ts'

export type Size = { width: number; height: number }
export type Pos = { x: number; y: number }

export const SECTION_PAD = 40
export const SECTION_HEADER = 64
export const GAP = 40

/** 左上から横に並べ、maxWidth を超えたら折り返す */
export function flow(
  items: { id: string; size: Size }[],
  origin: Pos,
  maxWidth: number,
  gap = GAP,
): Map<string, Pos> {
  const out = new Map<string, Pos>()
  let x = origin.x
  let y = origin.y
  let rowH = 0
  for (const { id, size } of items) {
    if (x > origin.x && x + size.width > origin.x + maxWidth) {
      x = origin.x
      y += rowH + gap
      rowH = 0
    }
    out.set(id, { x, y })
    x += size.width + gap
    rowH = Math.max(rowH, size.height)
  }
  return out
}

const LAYER_GAP = 80
/** 層を飛ばす矢印のために空けておく高さ（ラベル1行分） */
const LANE = 36
/** 通り道どうしの間隔 */
const LANE_GAP = 8
/** 矢印と箱のあいだに空ける距離 */
const CLEAR = 12

/**
 * 依存グラフとして左→右に配置する（層状レイアウト）。
 * 層 = 入ってくる矢印をたどった最長の長さ。層の中の順番は、隣の層でつながる相手の平均位置で揃える。
 */
export function dag(
  items: { id: string; size: Size }[],
  edges: { from: string; to: string }[],
  origin: Pos,
): Map<string, Pos> {
  const ids = items.map((i) => i.id)
  const size = new Map(items.map((i) => [i.id, i.size]))
  const inside = edges.filter((e) => size.has(e.from) && size.has(e.to) && e.from !== e.to)

  // 循環は深さ優先探索で見つけた逆向きの辺を無視して断ち切る
  const out = new Map(ids.map((id) => [id, [] as string[]]))
  for (const e of inside) out.get(e.from)!.push(e.to)
  const state = new Map<string, 1 | 2>()
  const forward: { from: string; to: string }[] = []
  const visit = (id: string) => {
    state.set(id, 1)
    for (const to of out.get(id)!) {
      if (state.get(to) === 1) continue
      forward.push({ from: id, to })
      if (!state.has(to)) visit(to)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!state.has(id)) visit(id)

  // 最長路で層を決める（トポロジカル順に緩和）
  const preds = new Map(ids.map((id) => [id, [] as string[]]))
  const succs = new Map(ids.map((id) => [id, [] as string[]]))
  for (const e of forward) {
    preds.get(e.to)!.push(e.from)
    succs.get(e.from)!.push(e.to)
  }
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]))
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const layer = new Map(ids.map((id) => [id, 0]))
  while (queue.length) {
    const id = queue.shift()!
    for (const to of succs.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1))
      indeg.set(to, indeg.get(to)! - 1)
      if (indeg.get(to) === 0) queue.push(to)
    }
  }
  // 層を飛ばす矢印は、間の層に見えない「通り道」（ダミー）を置いてつなぎ直す。
  // 通り道も並べ替えと座標決めに参加するので、矢印が途中の箱を突き抜けなくなる
  const nodeSize = new Map(size)
  const up = new Map(ids.map((id) => [id, [] as string[]]))
  const down = new Map(ids.map((id) => [id, [] as string[]]))
  const link = (a: string, b: string) => {
    down.get(a)!.push(b)
    up.get(b)!.push(a)
  }
  let dummies = 0
  for (const e of forward) {
    let prev = e.from
    for (let l = layer.get(e.from)! + 1; l < layer.get(e.to)!; l++) {
      const d = `\0lane${dummies++}`
      nodeSize.set(d, { width: 0, height: LANE })
      layer.set(d, l)
      up.set(d, [])
      down.set(d, [])
      link(prev, d)
      prev = d
    }
    link(prev, e.to)
  }
  const layers: string[][] = []
  for (const [id, l] of layer) (layers[l] ??= []).push(id)

  // 交差を減らすため、隣の層の平均位置で並べ替える（前向き・後ろ向きを2往復）
  const index = () => new Map(layers.flatMap((l) => l.map((id, i) => [id, i] as const)))
  const sweep = (order: number[], neighbors: Map<string, string[]>) => {
    for (const li of order) {
      const pos = index()
      const bary = (id: string) => {
        const ns = neighbors.get(id)!.filter((n) => pos.has(n))
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!
      }
      // 同じ位置を取り合ったら通り道を先にする（矢印はまっすぐ抜け、箱のほうがよける）
      const key = (id: string) => bary(id) - (nodeSize.get(id)!.width === 0 ? 0.001 : 0)
      layers[li] = [...layers[li]].sort((a, b) => key(a) - key(b))
    }
  }
  const forwardOrder = layers.map((_, i) => i).slice(1)
  const backwardOrder = layers.map((_, i) => i).reverse().slice(1)
  for (let k = 0; k < 2; k++) {
    sweep(forwardOrder, up)
    sweep(backwardOrder, down)
  }

  // 縦位置: 左の層でつながっている相手に合わせ、重なる分だけ下へずらす。
  // 層を飛ばす矢印（通り道）を受ける箱は、その通り道にそろえて矢印をまっすぐ通す。
  // 通り道どうしは間隔を詰めて束ねる
  const isLane = (id: string) => !size.has(id)
  const center = new Map<string, number>()
  const top = new Map<string, number>()
  for (const l of layers) {
    // 行きたい中心の高さを先に決め、その順に並べ直す（同じなら通り道を先にして矢印をまっすぐ通す）
    const want = new Map<string, number | undefined>()
    for (const id of l) {
      const ps = up.get(id)!.filter((p) => center.has(p))
      const lanes = ps.filter(isLane)
      const refs = lanes.length ? lanes : ps
      want.set(id, refs.length ? refs.reduce((s, p) => s + center.get(p)!, 0) / refs.length : undefined)
    }
    const order = l
      .map((id, i) => ({ id, i, w: want.get(id) }))
      .sort((a, b) => {
        if (a.w === undefined || b.w === undefined) return a.i - b.i
        return a.w - b.w || Number(isLane(b.id)) - Number(isLane(a.id)) || a.i - b.i
      })
      .map((x) => x.id)
    let bottom = -Infinity
    let prevLane = false
    for (const id of order) {
      const h = nodeSize.get(id)!.height
      const gap = prevLane && isLane(id) ? LANE_GAP : GAP
      const next = bottom === -Infinity ? -Infinity : bottom + gap
      const w = want.get(id)
      const y = Math.max(w === undefined ? (next === -Infinity ? 0 : next) : w - h / 2, next)
      top.set(id, y)
      center.set(id, y + h / 2)
      bottom = y + h
      prevLane = isLane(id)
    }
  }
  // 仕上げ: 実際に描かれる矢印（route.ts と同じ辺・曲線）が途中の箱を横切っていたら、
  // その箱と同じ層でその下にある箱をまとめて下へずらす。動かした箱の矢印も変わるので収まるまで繰り返す
  const xs = new Map<string, number>()
  {
    let x = origin.x
    for (const l of layers) {
      for (const id of l) xs.set(id, x)
      x += Math.max(0, ...l.map((id) => nodeSize.get(id)!.width)) + LAYER_GAP
    }
  }
  const rect = (id: string): Rect => ({ x: xs.get(id)!, y: top.get(id)!, w: size.get(id)!.width, h: size.get(id)!.height })
  const pushed = new Map<string, number>()
  for (let iter = 0; iter < 50; iter++) {
    let moved = false
    for (const e of inside) {
      const [a, b] = anchors(rect(e.from), rect(e.to))
      for (const id of ids) {
        // 矢印が飛び越える層の箱だけを見る（端の層の兄弟は左右の辺でつなぐので横切らない）
        const l = layer.get(id)!
        if (l <= layer.get(e.from)! || l >= layer.get(e.to)!) continue
        const r = rect(id)
        let hit = -Infinity
        for (let u = 0; u <= 1; u += 0.02) {
          const p = bezierAt(a, b, u)
          if (p.x > r.x - CLEAR && p.x < r.x + r.w + CLEAR && p.y > r.y - CLEAR && p.y < r.y + r.h + CLEAR) hit = Math.max(hit, p.y)
        }
        if (hit === -Infinity) continue
        const delta = hit + CLEAR - r.y
        // 大きく動かさないと避けられないときは諦める（全体が縦に伸びるよりは交差のほうがまし）
        if ((pushed.get(id) ?? 0) + delta > r.h * 2) continue
        for (const o of layers[layer.get(id)!]) {
          if (top.get(o)! < r.y) continue
          top.set(o, top.get(o)! + delta)
          pushed.set(o, (pushed.get(o) ?? 0) + delta)
        }
        moved = true
      }
    }
    if (!moved) break
  }

  const minTop = Math.min(...ids.map((id) => top.get(id)!))
  const result = new Map<string, Pos>()
  for (const id of ids) result.set(id, { x: xs.get(id)!, y: Math.round(origin.y + top.get(id)! - minTop) })
  return result
}

// ---------------------------------------------------------------------------
// 寸法の概算。サーバー側の自動配置と、描画前の仮置きに使う（editor.css の値に合わせてある）

const FONT = 14
const LINE = 21

/** 全角文字は約1em、半角は約0.55em として1行の幅を見積もる */
function textWidth(line: string, fontSize = FONT) {
  let w = 0
  for (const ch of line) w += /[\u1100-\uffff]/.test(ch) ? fontSize : fontSize * 0.55
  return w
}

function lineCount(text: string, avail: number, fontSize = FONT) {
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(textWidth(l, fontSize) / Math.max(avail, 1))), 0)
}

export function estimateSize(el: El, width: number): Size {
  switch (el.type) {
    case 'section':
      return { width, height: el.h ?? 400 }
    case 'text': {
      const fs = { sm: 16, md: 24, lg: 40, xl: 64 }[el.size ?? 'md']
      const lines = el.text.split('\n')
      return { width: el.w ?? Math.max(...lines.map((l) => textWidth(l, fs))), height: lines.length * fs * 1.3 }
    }
    case 'code':
      return { width, height: 44 + el.code.split('\n').length * 18 }
    case 'link':
      return { width, height: 20 + LINE + 18 }
    case 'box':
      return { width, height: Math.max(80, 36 + lineCount(el.text, width - 36) * LINE) }
    case 'task':
      return { width, height: 22 + lineCount(el.text, width - 46) * LINE }
    case 'note':
      return { width, height: Math.max(80, 32 + lineCount(el.text, width - 32) * LINE) }
  }
}
