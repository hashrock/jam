import type { El } from './model'

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
  const layers: string[][] = []
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id)

  // 交差を減らすため、隣の層の平均位置で並べ替える（前向き・後ろ向きを2往復）
  const index = () => new Map(layers.flatMap((l) => l.map((id, i) => [id, i] as const)))
  const sweep = (order: number[], neighbors: Map<string, string[]>) => {
    for (const li of order) {
      const pos = index()
      const bary = (id: string) => {
        const ns = neighbors.get(id)!.filter((n) => pos.has(n))
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!
      }
      layers[li] = [...layers[li]].sort((a, b) => bary(a) - bary(b))
    }
  }
  const down = layers.map((_, i) => i).slice(1)
  const up = layers.map((_, i) => i).reverse().slice(1)
  for (let k = 0; k < 2; k++) {
    sweep(down, preds)
    sweep(up, succs)
  }

  // 座標: 層ごとに列を作り、列の中は上下中央揃え
  const heights = layers.map((l) => l.reduce((h, id) => h + size.get(id)!.height, 0) + (l.length - 1) * GAP)
  const tallest = Math.max(0, ...heights)
  const result = new Map<string, Pos>()
  let x = origin.x
  layers.forEach((l, li) => {
    let y = origin.y + (tallest - heights[li]) / 2
    for (const id of l) {
      result.set(id, { x, y: Math.round(y) })
      y += size.get(id)!.height + GAP
    }
    x += Math.max(...l.map((id) => size.get(id)!.width)) + LAYER_GAP
  })
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
