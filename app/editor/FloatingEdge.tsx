import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge as RFEdge,
  type EdgeProps,
  getBezierPath,
  type InternalNode,
  Position,
  useInternalNode,
} from '@xyflow/react'
import { useState } from 'react'
import { setEditing, tryCommit, useBoardState } from './store'

export type JamEdge = RFEdge<{ label?: string; dashed?: boolean }>

/** 中心同士を結ぶ線とノード外周の交点と、その辺 */
function border(node: InternalNode, toward: { x: number; y: number }) {
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  const cx = node.internals.positionAbsolute.x + w / 2
  const cy = node.internals.positionAbsolute.y + h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy, pos: Position.Right }
  const scale = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)))
  const x = cx + dx * scale
  const y = cy + dy * scale
  const pos =
    Math.abs(dx) * h > Math.abs(dy) * w
      ? dx > 0
        ? Position.Right
        : Position.Left
      : dy > 0
        ? Position.Bottom
        : Position.Top
  return { x, y, pos }
}

const center = (n: InternalNode) => ({
  x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2,
  y: n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2,
})

function LabelEditor({ id, value }: { id: string; value: string }) {
  const [v, setV] = useState(value)
  const done = () => {
    setEditing(null)
    if (v !== value) tryCommit([{ op: 'update', id, label: v }])
  }
  return (
    <input
      className="edge-label-input nodrag"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && done()}
    />
  )
}

export function FloatingEdge({ id, source, target, markerEnd, selected, data }: EdgeProps<JamEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  const editing = useBoardState((st) => st.editing === id)
  if (!s || !t) return null
  const a = border(s, center(t))
  const b = border(t, center(s))
  const [path, lx, ly] = getBezierPath({
    sourceX: a.x,
    sourceY: a.y,
    sourcePosition: a.pos,
    targetX: b.x,
    targetY: b.y,
    targetPosition: b.pos,
  })
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: data?.dashed ? '6 4' : undefined }}
      />
      {(data?.label || editing) && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {editing ? <LabelEditor id={id} value={data?.label ?? ''} /> : data?.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
