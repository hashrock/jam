/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dag, type Size } from './layout.ts'
import { anchors, bezierAt, type Rect } from './route.ts'

function place(nodes: Record<string, Size>, edges: [string, string][]) {
  const pos = dag(
    Object.entries(nodes).map(([id, size]) => ({ id, size })),
    edges.map(([from, to]) => ({ from, to })),
    { x: 0, y: 0 },
  )
  const rects = new Map<string, Rect>()
  for (const [id, p] of pos) rects.set(id, { ...p, w: nodes[id].width, h: nodes[id].height })
  return rects
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 画面に描かれる矢印（FloatingEdge と同じ辺の選び方とベジェ曲線）が長方形の中を通るか */
function crosses(from: Rect, to: Rect, r: Rect) {
  const [s, t] = anchors(from, to)
  for (let u = 0; u <= 1; u += 0.01) {
    const { x, y } = bezierAt(s, t, u)
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true
  }
  return false
}

function assertClean(rects: Map<string, Rect>, edges: [string, string][]) {
  const ids = [...rects.keys()]
  for (const a of ids) for (const b of ids) if (a < b) assert.ok(!overlaps(rects.get(a)!, rects.get(b)!), `${a} overlaps ${b}`)
  for (const [from, to] of edges) {
    for (const id of ids) {
      if (id === from || id === to) continue
      assert.ok(!crosses(rects.get(from)!, rects.get(to)!, rects.get(id)!), `edge ${from}->${to} crosses ${id}`)
    }
  }
}

const box = { width: 160, height: 80 }

test('層を飛ばす矢印が途中の箱を突き抜けない（設計ボードのアーキテクチャ図）', () => {
  const nodes = { agent: box, tab: box, worker: box, room: box, d1: { width: 200, height: 100 }, google: box }
  const edges: [string, string][] = [
    ['agent', 'worker'],
    ['tab', 'worker'],
    ['agent', 'tab'],
    ['worker', 'room'],
    ['worker', 'd1'],
    ['worker', 'google'],
  ]
  assertClean(place(nodes, edges), edges)
})

test('タスクの依存関係に近道の矢印があっても横切らない', () => {
  const nodes = { design: box, api: box, ui: box, integrate: box, release: box, docs: box }
  const edges: [string, string][] = [
    ['design', 'api'],
    ['design', 'ui'],
    ['api', 'integrate'],
    ['ui', 'integrate'],
    ['design', 'integrate'],
    ['integrate', 'release'],
    ['design', 'docs'],
    ['docs', 'release'],
  ]
  assertClean(place(nodes, edges), edges)
})

test('層を飛ばす矢印が込み入っても、縦に大きく伸びない', () => {
  const nodes = { a: box, b: box, c: box, d: box, e: box }
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['d', 'e'],
    ['a', 'c'],
    ['a', 'e'],
    ['b', 'e'],
  ]
  const rects = [...place(nodes, edges).values()]
  for (const a of rects) for (const b of rects) if (a !== b) assert.ok(!overlaps(a, b))
  const height = Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y))
  assert.ok(height <= 5 * box.height + 4 * 40, `too tall: ${height}`)
})

test('つながりの無い箱や循環があっても全部に座標が付く', () => {
  const nodes = { a: box, b: box, c: box, lonely: box }
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
  ]
  const rects = place(nodes, edges)
  assert.deepEqual([...rects.keys()].sort(), ['a', 'b', 'c', 'lonely'])
  for (const a of rects.values()) for (const b of rects.values()) if (a !== b) assert.ok(!overlaps(a, b))
})
