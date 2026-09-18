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
import { anchors } from '../board/route'
import { setEditing, tryCommit, useBoardState } from './store'

export type JamEdge = RFEdge<{ label?: string; dashed?: boolean }>

const SIDE = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom } as const

const rectOf = (n: InternalNode) => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? 0,
  h: n.measured.height ?? 0,
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
  const [a, b] = anchors(rectOf(s), rectOf(t))
  const [path, lx, ly] = getBezierPath({
    sourceX: a.x,
    sourceY: a.y,
    sourcePosition: SIDE[a.side],
    targetX: b.x,
    targetY: b.y,
    targetPosition: SIDE[b.side],
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
