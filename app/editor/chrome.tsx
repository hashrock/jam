// キャンバスの周りの UI（FigJam 風）: 左上のメニュー、下のツールバー、選択中の要素の上に出るバー
import { router } from '@inertiajs/react'
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react'
import {
  ChevronDown,
  Code,
  Hand,
  LayoutGrid,
  Link as LinkIcon,
  type LucideIcon,
  MousePointer2,
  SquareCheck,
  Trash2,
  Type,
  Workflow,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Pos } from '../board/layout'
import { COLOR_NAMES, COLORS, DEFAULT_WIDTH, type El, type ElType } from '../board/model'
import type { SessionUser } from '../user'
import {
  absPos,
  byId,
  getState,
  redo,
  setEditing,
  setSelected,
  setTool,
  sizeOf,
  type Tool,
  tryCommit,
  undo,
  useBoardState,
} from './store'
import { useWebMcpAvailable } from './webmcp'

export const DRAG_TYPE = 'application/x-jam-tool'

type ElementTool = {
  type: ElType
  label: string
  key?: string
  icon: ReactNode
  fields: Record<string, unknown>
}

const lucide = (Icon: LucideIcon) => <Icon size={20} strokeWidth={1.75} />

/** FigJam の付箋・図形ツールのように、置かれる物そのものに見えるアイコン */
const StickyIcon = () => <span className="tool-sticky" />
const SectionIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="2.5" y="6.5" width="17" height="13" rx="2" />
    <rect x="2.5" y="2.5" width="8" height="3.2" rx="1" fill="currentColor" stroke="none" />
  </svg>
)
const ShapeIcon = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="2.5" y="4.5" width="12" height="12" rx="1" />
    <circle cx="18.5" cy="18.5" r="5.5" fill="var(--tool-bg, #fff)" />
    <path d="M17 3.5h5v5M22 3.5l-5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ELEMENT_TOOLS: ElementTool[] = [
  { type: 'note', label: '付箋', key: 'S', icon: <StickyIcon />, fields: { text: '' } },
  { type: 'box', label: '図形', key: 'R', icon: <ShapeIcon />, fields: { text: '' } },
  { type: 'text', label: 'テキスト', key: 'T', icon: lucide(Type), fields: { text: 'テキスト', size: 'lg' } },
  { type: 'section', label: 'セクション', key: '⇧S', icon: <SectionIcon />, fields: { title: 'セクション', w: 640, h: 400 } },
  { type: 'task', label: 'タスク', icon: lucide(SquareCheck), fields: { text: '' } },
  { type: 'link', label: 'リンク', icon: lucide(LinkIcon), fields: { url: '', title: '' } },
  { type: 'code', label: 'コード', icon: lucide(Code), fields: { code: '', lang: 'ts' } },
]

/** その点を含む一番内側のセクション */
export function sectionAt(p: Pos): El | undefined {
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

/** 指定した点を中心に要素を置き、選択して編集を始める。セクションの上なら中に入れる */
export function placeElement(type: ElType, p: Pos) {
  const tool = ELEMENT_TOOLS.find((t) => t.type === type)
  if (!tool) return
  const w = type === 'section' ? 640 : DEFAULT_WIDTH[type] || 120
  const parent = type === 'section' ? undefined : sectionAt(p)
  const origin = parent ? absPos(parent.id, byId(getState().board)) : { x: 0, y: 0 }
  const ids = tryCommit([
    {
      op: 'create',
      type,
      ...tool.fields,
      parent: parent?.id,
      x: Math.round(p.x - origin.x - w / 2),
      y: Math.round(p.y - origin.y - 20),
    },
  ])
  if (!ids.length) return
  setSelected(ids)
  setEditing(ids[0])
}

// ---------------------------------------------------------------------------
// 下のツールバー

function ToolButton({ tool, label, shortcut, children, ...rest }: { tool: Tool; label: string; shortcut?: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const active = useBoardState((s) => s.tool === tool)
  return (
    <button
      className={`tool ${active ? 'active' : ''}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      onClick={() => setTool(active && tool !== 'select' ? 'select' : tool)}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Toolbar() {
  return (
    <div className="toolbar">
      <ToolButton tool="select" label="選択" shortcut="V">
        {lucide(MousePointer2)}
      </ToolButton>
      <ToolButton tool="hand" label="手のひら" shortcut="H">
        {lucide(Hand)}
      </ToolButton>
      <span className="sep" />
      {ELEMENT_TOOLS.map((t) => (
        <ToolButton
          key={t.type}
          tool={t.type}
          label={`${t.label}：クリックしてから置く場所をクリック、またはドラッグして置く`}
          shortcut={t.key}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, t.type)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          {t.icon}
        </ToolButton>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 選択中の要素の上に出るバー

export function SelectionBar() {
  const board = useBoardState((s) => s.board)
  const selected = useBoardState((s) => s.selected)
  const els = board.elements.filter((e) => selected.has(e.id))
  if (!els.length) return null
  const single = els.length === 1 ? els[0] : undefined
  const patch = (fields: Record<string, unknown>) => tryCommit(els.map((e) => ({ op: 'update' as const, id: e.id, ...fields })))
  const current = single?.color

  return (
    <NodeToolbar nodeId={els.map((e) => e.id)} isVisible position={Position.Top} offset={16} className="selection-bar">
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          className={`swatch ${current === c ? 'current' : ''}`}
          title={c}
          style={{ background: COLORS[c].bg }}
          onClick={() => patch({ color: c })}
        />
      ))}
      {single?.type === 'box' && (
        <>
          <span className="sep" />
          <select value={single.shape ?? 'round'} onChange={(e) => patch({ shape: e.target.value })} title="形">
            {[
              ['rect', '四角'],
              ['round', '角丸'],
              ['ellipse', '楕円'],
              ['diamond', 'ひし形'],
              ['db', 'DB'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      {single?.type === 'text' && (
        <>
          <span className="sep" />
          <select value={single.size ?? 'md'} onChange={(e) => patch({ size: e.target.value })} title="文字の大きさ">
            {[
              ['sm', '小'],
              ['md', '中'],
              ['lg', '大'],
              ['xl', '特大'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      {single?.type === 'section' && (
        <>
          <span className="sep" />
          <button className="icon" title="中身を整列" onClick={() => tryCommit([{ op: 'layout', id: single.id, mode: 'grid' }])}>
            <LayoutGrid size={16} />
          </button>
          <button className="icon" title="矢印の依存関係で左→右に並べる" onClick={() => tryCommit([{ op: 'layout', id: single.id, mode: 'dag' }])}>
            <Workflow size={16} />
          </button>
        </>
      )}
      <span className="sep" />
      <button className="icon" title="削除 (Delete)" onClick={() => tryCommit(els.map((e) => ({ op: 'delete' as const, id: e.id })))}>
        <Trash2 size={16} />
      </button>
    </NodeToolbar>
  )
}

// ---------------------------------------------------------------------------
// 左上: ロゴのメニューとボード名

function TitleInput({ boardId, initial }: { boardId: string; initial: string }) {
  const [title, setTitle] = useState(initial)
  const [saved, setSaved] = useState(initial)
  useEffect(() => {
    document.title = `${saved} - jam`
  }, [saved])
  const save = async () => {
    const next = title.trim()
    if (!next || next === saved) return setTitle(saved)
    const res = await fetch(`/api/boards/${boardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    if (res.ok) setSaved(next)
    else setTitle(saved)
  }
  return (
    <input
      className="pill-title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
      aria-label="ボード名"
    />
  )
}

export function BoardMenu({ boardId, title, user }: { boardId: string; title: string; user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const item = (label: string, onClick: () => void, hint?: string) => (
    <button
      onClick={() => {
        setOpen(false)
        onClick()
      }}
    >
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )

  return (
    <div className="pill" ref={ref}>
      <button className={`pill-logo ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="メニュー">
        <img src="/logo.svg" alt="jam" width={22} height={22} />
        <ChevronDown size={14} />
      </button>
      <TitleInput boardId={boardId} initial={title} />
      {open && (
        <div className="menu">
          <div className="menu-user">{user.name || user.email}</div>
          {item('ボード一覧', () => router.visit('/boards'))}
          {item('新しいボード', () => router.post('/boards', { title: '' }))}
          <hr />
          {item('元に戻す', undo, '⌘Z')}
          {item('やり直す', redo, '⇧⌘Z')}
          {item('全体を表示', () => void fitView({ padding: 0.1, duration: 200 }), '⇧1')}
          {item('全体を整列', () => tryCommit([{ op: 'layout', mode: 'grid' }]))}
          <hr />
          {item('設定', () => router.visit('/settings'))}
          {item('ログアウト', () => window.location.assign('/auth/logout'))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 右上: 接続状態

export function ConnectionStatus() {
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
      {/* ボード画面はヘッダーが無いので、右上の状態表示の右端に置く */}
      <div className="switcher">
        <hashrock-switcher />
      </div>
    </div>
  )
}
