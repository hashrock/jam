import {
  Background,
  ConnectionMode,
  Controls,
  type EdgeChange,
  MarkerType,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type DragEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef } from 'react'
import { DEFAULT_WIDTH, type El, type ElType } from '../board/model'
import type { SessionUser } from '../user'
import { BoardMenu, ConnectionStatus, DRAG_TYPE, ELEMENT_TOOLS, placeElement, SelectionBar, Toolbar } from './chrome'
import { pasteOps, serialize } from './clipboard'
import { FloatingEdge, type JamEdge } from './FloatingEdge'
import { type ElNode, nodeTypes } from './nodes'
import {
  absPos,
  byId,
  connect,
  dropElements,
  getState,
  redo,
  setEditing,
  setMeasured,
  setOverlay,
  setSelected,
  setTool,
  sizeOf,
  type Tool,
  tryCommit,
  undo,
  useBoardState,
} from './store'
import { registerWebMcp } from './webmcp'

const edgeTypes = { floating: FloatingEdge }

function isTyping(e: Event) {
  const t = (e.target ?? document.activeElement) as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** 1文字のショートカットでツールを切り替える（FigJam と同じ割り当て） */
const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', s: 'note', r: 'box', t: 'text', S: 'section' }

function toNode(raw: El, overlay: object | undefined, selected: boolean, measured: { width: number; height: number } | undefined): ElNode {
  const el = (overlay ? { ...raw, ...overlay } : raw) as El
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

function Canvas({ menu }: { menu: React.ReactNode }) {
  const board = useBoardState((s) => s.board)
  const overlay = useBoardState((s) => s.overlay)
  const selected = useBoardState((s) => s.selected)
  const measured = useBoardState((s) => s.measured)
  const loaded = useBoardState((s) => s.loaded)
  const tool = useBoardState((s) => s.tool)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const selectionStart = useRef<{ x: number; y: number } | null>(null)

  // 最初の盤面が届いたら全体を表示する
  useEffect(() => {
    if (loaded) requestAnimationFrame(() => void fitView({ padding: 0.1 }))
  }, [loaded, fitView])

  const nodes = useMemo(
    () => board.elements.map((el) => toNode(el, overlay.get(el.id), selected.has(el.id), measured.get(el.id))),
    [board.elements, overlay, selected, measured],
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

  const dragging = useRef(false)
  const onNodesChange = useCallback((changes: NodeChange<ElNode>[]) => {
    onSelect(changes.flatMap((c) => (c.type === 'select' ? [c] : [])))
    const moves = new Map<string, { x: number; y: number }>()
    const sizes: [string, { width: number; height: number }][] = []
    // リサイズ中の位置変更は NodeResizer の onResize 側で扱う
    const resizing = changes.some((c) => c.type === 'dimensions' && c.resizing)
    for (const c of changes) {
      if (c.type === 'position' && c.position && !resizing)
        moves.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) })
      if (c.type === 'dimensions' && c.dimensions && !c.resizing) sizes.push([c.id, c.dimensions])
    }
    if (moves.size) {
      setOverlay(moves)
      // ドラッグ以外（矢印キー）での移動はその場で確定する。ドラッグは onNodeDragStop で確定する
      if (!dragging.current) dropElements([...moves.keys()])
    }
    if (sizes.length) setMeasured(sizes)
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<JamEdge>[]) => {
    onSelect(changes.flatMap((c) => (c.type === 'select' ? [c] : [])))
  }, [])

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  // ツールバーからドラッグ＆ドロップで置く。セクションの上なら中に入れる
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DRAG_TYPE) as ElType
    if (!ELEMENT_TOOLS.some((t) => t.type === type)) return
    e.preventDefault()
    placeElement(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    setTool('select')
  }

  // 要素のツールを選んだ後のクリックで、その場所に置いて選択ツールに戻る（FigJam と同じ）
  const placeAt = (e: MouseEvent) => {
    const t = getState().tool
    if (t === 'select' || t === 'hand') return false
    placeElement(t, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    setTool('select')
    return true
  }

  // 範囲選択は触れた要素を選ぶが、セクションは丸ごと囲んだときだけ選ぶ（中で始めた範囲選択でセクション自体を掴まない）
  const onSelectionEnd = (e: MouseEvent) => {
    const start = selectionStart.current
    selectionStart.current = null
    if (!start) return
    const a = screenToFlowPosition(start)
    const b = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const [x1, x2, y1, y2] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)]
    const { board, selected } = getState()
    const map = byId(board)
    const next = [...selected].filter((id) => {
      const el = map.get(id)
      if (el?.type !== 'section') return true
      const p = absPos(id, map)
      const s = sizeOf(el)
      return p.x >= x1 && p.y >= y1 && p.x + s.width <= x2 && p.y + s.height <= y2
    })
    if (next.length !== selected.size) setSelected(next)
  }

  // コピー・カット・貼り付け
  useEffect(() => {
    const copy = (e: ClipboardEvent) => {
      if (isTyping(e)) return
      const text = serialize(getState().board, getState().selected)
      if (!text) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', text)
      if (e.type === 'cut') tryCommit([...getState().selected].map((id) => ({ op: 'delete' as const, id })))
    }
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      // マウスがキャンバス上にあればその位置、無ければ画面中央に貼る
      const at = screenToFlowPosition(pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const { ops, roots } = pasteOps(text, getState().board, at)
      if (!ops.length) return
      tryCommit(ops)
      setSelected(roots)
    }
    document.addEventListener('copy', copy)
    document.addEventListener('cut', copy)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', copy)
      document.removeEventListener('paste', paste)
    }
  }, [screenToFlowPosition])

  const onPaneDoubleClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane') || getState().tool !== 'select') return
    placeElement('note', screenToFlowPosition({ x: e.clientX, y: e.clientY }))
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
      } else if (e.key === 'Escape') {
        setTool('select')
      } else if (e.shiftKey && e.key === '!') {
        void fitView({ padding: 0.1, duration: 200 })
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key]) {
        setTool(TOOL_KEYS[e.key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])

  return (
    <div
      className={`canvas tool-${tool === 'select' || tool === 'hand' ? tool : 'place'}`}
      onDoubleClick={onPaneDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerLeave={() => {
        pointer.current = null
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => {
          dragging.current = true
        }}
        onNodeDragStop={(_, __, dragged) => {
          dragging.current = false
          dropElements(dragged.map((n) => n.id))
        }}
        onPaneClick={placeAt}
        onNodeClick={(e) => placeAt(e)}
        onNodeDoubleClick={(_, n) => setEditing(n.id)}
        onEdgeDoubleClick={(_, e) => setEditing(e.id)}
        onConnect={(c) => tryCommit([{ op: 'connect', from: c.source, to: c.target }])}
        onConnectEnd={(e, conn) => {
          // ハンドルではなくノード本体の上で離しても接続する
          if (conn.isValid || !conn.fromNode) return
          const { clientX, clientY } = 'changedTouches' in e ? e.changedTouches[0] : e
          const to = document.elementFromPoint(clientX, clientY)?.closest('.react-flow__node')?.getAttribute('data-id')
          if (to && to !== conn.fromNode.id) tryCommit([{ op: 'connect', from: conn.fromNode.id, to }])
        }}
        onDelete={({ nodes, edges }) => tryCommit([...nodes, ...edges].map((n) => ({ op: 'delete' as const, id: n.id })))}
        onSelectionStart={(e) => {
          selectionStart.current = { x: e.clientX, y: e.clientY }
        }}
        onSelectionEnd={onSelectionEnd}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Shift']}
        // FigJam と同じ: 左ドラッグは範囲選択、パンは中ボタン / Space + ドラッグ / 2本指スクロール / 手のひらツール、
        // ⌘・Ctrl + スクロールでズーム
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'hand' ? [0, 1] : [1]}
        nodesDraggable={tool === 'select'}
        nodesConnectable={tool === 'select'}
        elementsSelectable={tool !== 'hand'}
        panOnScroll
        zoomActivationKeyCode={['Meta', 'Control']}
        zoomOnDoubleClick={false}
        minZoom={0.1}
      >
        <Background gap={24} />
        <Controls position="bottom-right" showInteractive={false} />
        <SelectionBar />
      </ReactFlow>
      {menu}
      <Toolbar />
      <ConnectionStatus />
    </div>
  )
}

/** ボードを開いて編集する。サーバーとの接続と WebMCP の登録もここで行う */
export default function BoardEditor({ boardId, title, user }: { boardId: string; title: string; user: SessionUser }) {
  useEffect(() => connect(boardId), [boardId])
  useEffect(() => registerWebMcp(), [boardId])
  const closed = useBoardState((s) => s.closed)
  if (closed)
    return (
      <div className="closed">
        {closed}
        <a href="/boards">ボード一覧へ</a>
      </div>
    )
  return (
    <ReactFlowProvider>
      <Canvas menu={<BoardMenu boardId={boardId} title={title} user={user} />} />
    </ReactFlowProvider>
  )
}
