import ELK from 'elkjs/lib/elk.bundled.js'
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

const elk = new ELK()

/** 依存グラフとして左→右に配置する */
export async function dag(
  items: { id: string; size: Size }[],
  edges: { from: string; to: string }[],
  origin: Pos,
): Promise<Map<string, Pos>> {
  const ids = new Set(items.map((i) => i.id))
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.componentComponent': '60',
    },
    children: items.map((i) => ({ id: i.id, width: i.size.width, height: i.size.height })),
    edges: edges
      .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .map((e, n) => ({ id: `e${n}`, sources: [e.from], targets: [e.to] })),
  })
  const out = new Map<string, Pos>()
  for (const c of graph.children ?? []) {
    out.set(c.id, { x: origin.x + (c.x ?? 0), y: origin.y + (c.y ?? 0) })
  }
  return out
}

/** ブラウザが寸法を測れないとき（バックグラウンドタブなど）の概算 */
export function estimateSize(el: El, width: number): Size {
  const lines = (text: string, cpl: number) =>
    text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0)
  switch (el.type) {
    case 'section':
      return { width, height: el.h ?? 400 }
    case 'text': {
      const fs = { sm: 16, md: 24, lg: 40, xl: 64 }[el.size ?? 'md']
      const longest = Math.max(...el.text.split('\n').map((l) => l.length))
      return { width: el.w ?? longest * fs * 0.9, height: el.text.split('\n').length * fs * 1.3 }
    }
    case 'code':
      return { width, height: 44 + el.code.split('\n').length * 18 }
    case 'link':
      return { width, height: 64 }
    case 'box':
      return { width, height: Math.max(80, 32 + lines(el.text, width / 9) * 20) }
    default:
      return { width, height: 32 + lines(el.text, width / 9) * 20 }
  }
}
