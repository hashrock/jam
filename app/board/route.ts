// 矢印をどの辺からどの辺へ引くか。描画（FloatingEdge）とレイアウトのテストで共有する
export type Rect = { x: number; y: number; w: number; h: number }
export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Anchor = { x: number; y: number; side: Side }

const mid = (r: Rect, side: Side): Anchor => {
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y + r.h / 2, side }
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2, side }
    case 'top':
      return { x: r.x + r.w / 2, y: r.y, side }
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h, side }
  }
}

/**
 * 横に離れていれば左右の辺どうし、そうでなく縦に離れていれば上下の辺どうしを、辺の中点でつなぐ。
 * 依存順レイアウト（左→右）では常に左右でつながるので、縦に並んだ兄弟の箱を斜めに横切らない。
 * 重なっているとき（セクションとその中身など）は中心どうしの向きで決める。
 */
export function anchors(a: Rect, b: Rect): [Anchor, Anchor] {
  const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const yGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  const horizontal = xGap > 0 || (yGap <= 0 && Math.abs(dx) * (a.h + b.h) >= Math.abs(dy) * (a.w + b.w))
  if (horizontal) return dx >= 0 ? [mid(a, 'right'), mid(b, 'left')] : [mid(a, 'left'), mid(b, 'right')]
  return dy >= 0 ? [mid(a, 'bottom'), mid(b, 'top')] : [mid(a, 'top'), mid(b, 'bottom')]
}

// React Flow の getBezierPath と同じ制御点（curvature 0.25）。テストで描かれる曲線をなぞるのに使う
function controlOffset(distance: number) {
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance)
}

function control(p: Anchor, other: Anchor): [number, number] {
  switch (p.side) {
    case 'left':
      return [p.x - controlOffset(p.x - other.x), p.y]
    case 'right':
      return [p.x + controlOffset(other.x - p.x), p.y]
    case 'top':
      return [p.x, p.y - controlOffset(p.y - other.y)]
    case 'bottom':
      return [p.x, p.y + controlOffset(other.y - p.y)]
  }
}

/** 描かれる3次ベジェ曲線上の点（t = 0..1） */
export function bezierAt(s: Anchor, t: Anchor, u: number) {
  const [c1x, c1y] = control(s, t)
  const [c2x, c2y] = control(t, s)
  const v = 1 - u
  return {
    x: v * v * v * s.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * t.x,
    y: v * v * v * s.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * t.y,
  }
}
