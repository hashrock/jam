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
  SelectionMode,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type DragEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef } from 'react'
import type { Pos } from '../board/layout'
import { COLOR_NAMES, COLORS, DEFAULT_WIDTH, type El, type ElType } from '../board/model'
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
  sizeOf,
  tryCommit,
  undo,
  useBoardState,
} from './store'
import { registerWebMcp, useWebMcpAvailable } from './webmcp'

const edgeTypes = { floating: FloatingEdge }

const DRAG_TYPE = 'application/x-jam-tool'

const TOOLS: { type: ElType; label: string; fields: Record<string, unknown> }[] = [
  { type: 'note', label: 'メモ', fields: { text: '' } },
  { type: 'task', label: 'タスク', fields: { text: '' } },
  { type: 'link', label: 'リンク', fields: { url: '', title: '' } },
  { type: 'box', label: '図形', fields: { text: '' } },
  { type: 'code', label: 'コード', fields: { code: '', lang: 'ts' } },
  { type: 'text', label: 'テキスト', fields: { text: '見出し', size: 'lg' } },
  { type: 'section', label: 'セクション', fields: { title: 'セクション', w: 640, h: 400 } },
]

function isTyping(e: Event) {
  const t = (e.target ?? document.activeElement) as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** その点を含む一番内側のセクション */
function sectionAt(p: Pos): El | undefined {
  const board = getState().board
  const map = byId(board)
  let hit: El | undefined
  for (const e of board.elements) {
    if (e.type !== 'section') continue
    const a = absPos(e.id, map)
    const s = sizeOf(e)
    if (p.x >= a.x && p.x <= a.x + s.width && p.y >= a.y && p.y <= a.y + s.height) hit = e // 後ろほど深い
  }
  return hit
}

function select(ids: string[]) {
  if (!ids.length) return
  setSelected(ids)
  setEditing(ids[0])
}

function Toolbar() {
  const { screenToFlowPosition } = useReactFlow()
  const board = useBoardState((s) => s.board)
  const selected = useBoardState((s) => s.selected)
  const selEls = board.elements.filter((e) => selected.has(e.id))
  const single = selEls.length === 1 ? selEls[0] : undefined
  const section = single?.type === 'section' ? single : undefined

  const create = (type: ElType, fields: Record<string, unknown>) => {
    // セクションを選択中ならその中に自動配置、そうでなければ画面中央に置く
    let pos: Record<string, unknown> = {}
    if (!section || type === 'section') {
      const c = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const w = type === 'section' ? 640 : DEFAULT_WIDTH[type] || 120
      pos = { x: Math.round(c.x - w / 2), y: Math.round(c.y - 40) }
    }
    select(tryCommit([{ op: 'create', type, parent: type === 'section' ? undefined : section?.id, ...pos, ...fields }]))
  }

  const patchSelected = (patch: Record<string, unknown>) =>
    tryCommit(selEls.map((e) => ({ op: 'update' as const, id: e.id, ...patch })))

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.type}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, t.type)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => create(t.type, t.fields)}
          title="クリックで中央に、ドラッグで好きな場所に置く"
        >
          {t.label}
        </button>
      ))}
      <span className="sep" />
      <button onClick={() => tryCommit([{ op: 'layout', id: section?.id, mode: 'grid' }])} title="選択中のセクション（なければ全体）を整列">
        整列
      </button>
      <button onClick={() => tryCommit([{ op: 'layout', id: section?.id, mode: 'dag' }])} title="矢印の依存関係で左→右に並べる">
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
      <button onClick={undo} title="元に戻す (⌘Z)">
        ↶
      </button>
      <button onClick={redo} title="やり直す (⇧⌘Z)">
        ↷
      </button>
    </div>
  )
}

function ConnectionStatus() {
  const connected = useBoardState((s) => s.connected)
  const webmcp = useWebMcpAvailable()
  return (
    <div className="status">
      <span className={connected ? 'on' : 'off'} title={connected ? 'サーバーと同期中' : '再接続中。変更は接続し直したときに送られる'}>
        {connected ? '同期中' : 'オフライン'}
      </span>
      <span
        className={webmcp ? 'on' : 'off'}
        title={webmcp ? 'このボードのツールを WebMCP で公開中' : 'WebMCP 非対応。chrome://flags/#enable-webmcp-testing を有効にすると使える'}
      >
        WebMCP
      </span>
    </div>
  )
}

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

function Canvas() {
  const board = useBoardState((s) => s.board)
  const overlay = useBoardState((s) => s.overlay)
  const selected = useBoardState((s) => s.selected)
  const measured = useBoardState((s) => s.measured)
  const loaded = useBoardState((s) => s.loaded)
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
    const tool = TOOLS.find((t) => t.type === type)
    if (!tool) return
    e.preventDefault()
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const w = type === 'section' ? 640 : DEFAULT_WIDTH[type] || 120
    const parent = type === 'section' ? undefined : sectionAt(p)
    const origin = parent ? absPos(parent.id, byId(getState().board)) : { x: 0, y: 0 }
    select(
      tryCommit([
        {
          op: 'create',
          type,
          ...tool.fields,
          parent: parent?.id,
          x: Math.round(p.x - origin.x - w / 2),
          y: Math.round(p.y - origin.y - 20),
        },
      ]),
    )
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
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    select(tryCommit([{ op: 'create', type: 'note', text: '', x: Math.round(p.x - 120), y: Math.round(p.y - 30) }]))
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
    <div
      className="canvas"
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
        // FigJam と同じ: 左ドラッグは範囲選択、パンは中ボタン / Space + ドラッグ / 2本指スクロール、⌘・Ctrl + スクロールでズーム
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        panOnScroll
        zoomActivationKeyCode={['Meta', 'Control']}
        zoomOnDoubleClick={false}
        minZoom={0.1}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <Toolbar />
      <ConnectionStatus />
    </div>
  )
}

/** ボードを開いて編集する。サーバーとの接続と WebMCP の登録もここで行う */
export default function BoardEditor({ boardId }: { boardId: string }) {
  useEffect(() => connect(boardId), [boardId])
  useEffect(() => registerWebMcp(), [boardId])
  const closed = useBoardState((s) => s.closed)
  if (closed) return <div className="closed">{closed}</div>
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
