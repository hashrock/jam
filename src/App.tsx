import {
  Background,
  ConnectionMode,
  Controls,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type MouseEvent, useCallback, useEffect, useMemo } from 'react'
import { FloatingEdge, type JamEdge } from './board/FloatingEdge'
import { COLOR_NAMES, COLORS, DEFAULT_WIDTH, type El, type ElType } from './board/model'
import { type ElNode, nodeTypes } from './board/nodes'
import {
  apply,
  checkpoint,
  dropElements,
  getState,
  layout,
  movePositions,
  redo,
  setEditing,
  setMeasured,
  setSelected,
  undo,
  useBoardState,
} from './board/store'

const edgeTypes = { floating: FloatingEdge }

const TOOLS: { type: ElType; label: string; fields: Record<string, unknown> }[] = [
  { type: 'note', label: 'メモ', fields: { text: '' } },
  { type: 'task', label: 'タスク', fields: { text: '' } },
  { type: 'link', label: 'リンク', fields: { url: '', title: '' } },
  { type: 'box', label: '図形', fields: { text: '' } },
  { type: 'code', label: 'コード', fields: { code: '', lang: 'ts' } },
  { type: 'text', label: 'テキスト', fields: { text: '見出し', size: 'lg' } },
  { type: 'section', label: 'セクション', fields: { title: 'セクション', w: 640, h: 400 } },
]

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

function Toolbar() {
  const { screenToFlowPosition } = useReactFlow()
  const board = useBoardState((s) => s.board)
  const selected = useBoardState((s) => s.selected)
  const selEls = board.elements.filter((e) => selected.has(e.id))
  const single = selEls.length === 1 ? selEls[0] : undefined
  const section = single?.type === 'section' ? single : undefined

  const create = async (type: ElType, fields: Record<string, unknown>) => {
    // セクションを選択中ならその中に自動配置、そうでなければ画面中央に置く
    let pos: Record<string, unknown> = {}
    if (!section || type === 'section') {
      const c = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const w = type === 'section' ? 640 : DEFAULT_WIDTH[type] || 120
      pos = { x: Math.round(c.x - w / 2), y: Math.round(c.y - 40) }
    }
    const { ids } = await apply([{ op: 'create', type, parent: type === 'section' ? undefined : section?.id, ...pos, ...fields }])
    setSelected(ids)
    setEditing(ids[0])
  }

  const patchSelected = (patch: Record<string, unknown>) =>
    void apply(selEls.map((e) => ({ op: 'update' as const, id: e.id, ...patch })))

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.type} onClick={() => void create(t.type, t.fields)}>
          {t.label}
        </button>
      ))}
      <span className="sep" />
      <button onClick={() => void layout(section?.id, 'grid')} title="選択中のセクション（なければ全体）を整列">
        整列
      </button>
      <button onClick={() => void layout(section?.id, 'dag')} title="矢印の依存関係で左→右に並べる">
        依存順
      </button>
      {selEls.length > 0 && (
        <>
          <span className="sep" />
          {COLOR_NAMES.map((c) => (
            <button
              key={c}
              className="swatch"
              title={c}
              style={{ background: COLORS[c].bg }}
              onClick={() => patchSelected({ color: c })}
            />
          ))}
        </>
      )}
      {single?.type === 'box' && (
        <select value={single.shape ?? 'round'} onChange={(e) => patchSelected({ shape: e.target.value })}>
          {['rect', 'round', 'ellipse', 'diamond', 'db'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {single?.type === 'text' && (
        <select value={single.size ?? 'md'} onChange={(e) => patchSelected({ size: e.target.value })}>
          {['sm', 'md', 'lg', 'xl'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <span className="sep" />
      <button onClick={undo}>↶</button>
      <button onClick={redo}>↷</button>
    </div>
  )
}

function toNode(el: El, selected: boolean, measured: { width: number; height: number } | undefined): ElNode {
  const width = el.w ?? DEFAULT_WIDTH[el.type]
  const unplaced = el.x == null || el.y == null
  return {
    id: el.id,
    type: el.type,
    position: { x: el.x ?? 0, y: el.y ?? 0 },
    parentId: el.parent,
    data: { el },
    selected,
    measured,
    ...(el.type === 'section'
      ? { width, height: el.h ?? 400 }
      : { style: { width: width || undefined, visibility: unplaced ? 'hidden' : undefined } }),
  }
}

function Canvas() {
  const board = useBoardState((s) => s.board)
  const selected = useBoardState((s) => s.selected)
  const measured = useBoardState((s) => s.measured)
  const { screenToFlowPosition } = useReactFlow()

  const nodes = useMemo(
    () => board.elements.map((el) => toNode(el, selected.has(el.id), measured.get(el.id))),
    [board.elements, selected, measured],
  )
  const edges = useMemo<JamEdge[]>(
    () =>
      board.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'floating',
        selected: selected.has(e.id),
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        data: { label: e.label, dashed: e.dashed },
      })),
    [board.edges, selected],
  )

  const onSelect = (changes: { id: string; selected: boolean }[]) => {
    if (!changes.length) return
    const next = new Set(getState().selected)
    for (const c of changes) {
      if (c.selected) next.add(c.id)
      else next.delete(c.id)
    }
    setSelected(next)
  }

  const onNodesChange = useCallback((changes: NodeChange<ElNode>[]) => {
    onSelect(changes.flatMap((c) => (c.type === 'select' ? [c] : [])))
    const moves = new Map<string, { x: number; y: number }>()
    const sizes: [string, { width: number; height: number }][] = []
    for (const c of changes) {
      if (c.type === 'position' && c.position && c.dragging)
        moves.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) })
      if (c.type === 'dimensions' && c.dimensions && !c.resizing) sizes.push([c.id, c.dimensions])
    }
    if (moves.size) movePositions(moves)
    if (sizes.length) setMeasured(sizes)
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<JamEdge>[]) => {
    onSelect(changes.flatMap((c) => (c.type === 'select' ? [c] : [])))
  }, [])

  const onPaneDoubleClick = async (e: MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const { ids } = await apply([{ op: 'create', type: 'note', text: '', x: Math.round(p.x - 120), y: Math.round(p.y - 30) }])
    setSelected(ids)
    setEditing(ids[0])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Enter' && getState().selected.size === 1) {
        e.preventDefault()
        setEditing([...getState().selected][0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="canvas" onDoubleClick={onPaneDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => checkpoint()}
        onNodeDragStop={(_, __, dragged) => dropElements(dragged.map((n) => n.id))}
        onNodeDoubleClick={(_, n) => setEditing(n.id)}
        onEdgeDoubleClick={(_, e) => setEditing(e.id)}
        onConnect={(c) => void apply([{ op: 'connect', from: c.source, to: c.target }])}
        onConnectEnd={(e, conn) => {
          // ハンドルではなくノード本体の上で離しても接続する
          if (conn.isValid || !conn.fromNode) return
          const { clientX, clientY } = 'changedTouches' in e ? e.changedTouches[0] : e
          const to = document.elementFromPoint(clientX, clientY)?.closest('.react-flow__node')?.getAttribute('data-id')
          if (to && to !== conn.fromNode.id) void apply([{ op: 'connect', from: conn.fromNode.id, to }])
        }}
        onDelete={({ nodes, edges }) => void apply([...nodes, ...edges].map((n) => ({ op: 'delete' as const, id: n.id })))}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Shift']}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        fitView
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <Toolbar />
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
