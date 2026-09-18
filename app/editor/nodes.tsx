import {
  Handle,
  NodeResizeControl,
  NodeResizer,
  type NodeProps,
  type Node,
  Position,
} from '@xyflow/react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { COLORS, DEFAULT_COLOR, type El } from '../board/model'
import { commitOverlay, setEditing, setOverlay, tryCommit, useBoardState } from './store'

export type ElNode = Node<{ el: El }>

// ---------------------------------------------------------------------------
// 小さな Markdown: 見出し / 箇条書き / **太字** / `code` / URL

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={m.index}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={m.index}>{t.slice(1, -1)}</code>)
    else
      out.push(
        <a key={m.index} href={t} target="_blank" rel="noreferrer" className="nodrag">
          {t}
        </a>,
      )
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  const flushList = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list}</ul>)
    list = []
  }
  text.split('\n').forEach((line, i) => {
    const bullet = line.match(/^\s*[-*] (.*)/)
    if (bullet) return list.push(<li key={i}>{inline(bullet[1])}</li>)
    flushList()
    const h = line.match(/^#+ (.*)/)
    if (h) blocks.push(<div key={i} className="md-h">{inline(h[1])}</div>)
    else blocks.push(<div key={i}>{line ? inline(line) : ' '}</div>)
  })
  flushList()
  return <div className="md">{blocks}</div>
}

// ---------------------------------------------------------------------------
// 編集

function useEditing(id: string) {
  return useBoardState((s) => s.editing === id)
}

function commit(id: string, patch: Record<string, unknown>) {
  setEditing(null)
  tryCommit([{ op: 'update', id, ...patch }])
}

function onEditorKey(e: KeyboardEvent, done: () => void) {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault()
    done()
  }
}

function TextEditor({ value, onDone, className }: { value: string; onDone: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value)
  const done = () => onDone(v)
  return (
    <textarea
      className={`editor nodrag nowheel ${className ?? ''}`}
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => onEditorKey(e, done)}
    />
  )
}

function EditableText({ el, field, md }: { el: El; field: 'text' | 'title' | 'code'; md?: boolean }) {
  const editing = useEditing(el.id)
  const value = ((el as Record<string, unknown>)[field] as string | undefined) ?? ''
  if (editing)
    return (
      <TextEditor
        value={value}
        className={field === 'code' ? 'mono' : ''}
        onDone={(v) => (v !== value ? commit(el.id, { [field]: v }) : setEditing(null))}
      />
    )
  if (field === 'code') return <pre className="code-body">{value}</pre>
  if (!value) return <div className="placeholder">ダブルクリックで編集</div>
  return md ? <Markdown text={value} /> : <div className="plain">{value}</div>
}

// ---------------------------------------------------------------------------
// 共通パーツ

function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
    </>
  )
}

function WidthResizer({ id }: { id: string }) {
  return (
    <NodeResizeControl
      position="right"
      variant={'line' as never}
      resizeDirection="horizontal"
      minWidth={80}
      onResize={(_, p) => setOverlay(new Map([[id, { w: Math.round(p.width) }]]))}
      onResizeEnd={commitOverlay}
    />
  )
}

const colorOf = (el: El) => COLORS[el.color ?? DEFAULT_COLOR[el.type] ?? 'white']

// ---------------------------------------------------------------------------
// nodes

function NoteNode({ data: { el }, selected }: NodeProps<ElNode>) {
  const c = colorOf(el)
  return (
    <div className="el note" style={{ background: c.bg }}>
      <EditableText el={el} field="text" md />
      <Handles />
      {selected && <WidthResizer id={el.id} />}
    </div>
  )
}

function TaskNode({ data: { el }, selected }: NodeProps<ElNode>) {
  if (el.type !== 'task') return null
  const c = colorOf(el)
  return (
    <div className={`el task ${el.done ? 'done' : ''}`} style={{ background: c.bg, borderColor: c.border }}>
      <input
        type="checkbox"
        className="nodrag"
        checked={!!el.done}
        onChange={(e) => tryCommit([{ op: 'update', id: el.id, done: e.target.checked }])}
      />
      <EditableText el={el} field="text" md />
      <Handles />
      {selected && <WidthResizer id={el.id} />}
    </div>
  )
}

function LinkEditor({ el }: { el: El & { type: 'link' } }) {
  const [draft, setDraft] = useState({ title: el.title ?? '', url: el.url })
  const done = () => commit(el.id, draft)
  return (
    <div
      className="link-form nodrag"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && done()}
      onKeyDown={(e) => onEditorKey(e, done)}
    >
      <input autoFocus placeholder="タイトル" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <input placeholder="https://" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
    </div>
  )
}

function LinkNode({ data: { el }, selected }: NodeProps<ElNode>) {
  const editing = useEditing(el.id)
  if (el.type !== 'link') return null
  const c = colorOf(el)
  let host = el.url
  try {
    const u = new URL(el.url)
    host = u.host + u.pathname
  } catch {
    // URL として不正ならそのまま表示
  }
  return (
    <div className="el link" style={{ background: c.bg, borderColor: c.border }}>
      {editing ? (
        <LinkEditor el={el} />
      ) : (
        <>
          <div className="link-title">{el.title || host || 'ダブルクリックで編集'}</div>
          {el.url && (
            <a className="link-url nodrag" href={el.url} target="_blank" rel="noreferrer">
              {host}
            </a>
          )}
        </>
      )}
      <Handles />
      {selected && <WidthResizer id={el.id} />}
    </div>
  )
}

function BoxNode({ data: { el }, selected }: NodeProps<ElNode>) {
  if (el.type !== 'box') return null
  const c = colorOf(el)
  const shape = el.shape ?? 'round'
  const svgShape = shape === 'diamond' || shape === 'db'
  return (
    <div
      className={`el box box-${shape}`}
      style={svgShape ? undefined : { background: c.bg, borderColor: c.border }}
    >
      {svgShape && (
        <svg className="box-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {shape === 'diamond' ? (
            <polygon points="50,1 99,50 50,99 1,50" fill={c.bg} stroke={c.border} vectorEffect="non-scaling-stroke" strokeWidth={2} />
          ) : (
            <>
              <path d="M1,10 A49,9 0 0 0 99,10 V90 A49,9 0 0 1 1,90 Z" fill={c.bg} stroke={c.border} vectorEffect="non-scaling-stroke" strokeWidth={2} />
              <ellipse cx="50" cy="10" rx="49" ry="9" fill={c.bg} stroke={c.border} vectorEffect="non-scaling-stroke" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      <EditableText el={el} field="text" />
      <Handles />
      {selected && <WidthResizer id={el.id} />}
    </div>
  )
}

function CodeNode({ data: { el }, selected }: NodeProps<ElNode>) {
  if (el.type !== 'code') return null
  return (
    <div className="el code">
      <div className="code-lang">{el.lang ?? 'code'}</div>
      <EditableText el={el} field="code" />
      <Handles />
      {selected && <WidthResizer id={el.id} />}
    </div>
  )
}

function TextNode({ data: { el } }: NodeProps<ElNode>) {
  if (el.type !== 'text') return null
  return (
    <div className={`el text tsize-${el.size ?? 'md'}`}>
      <EditableText el={el} field="text" />
      <Handles />
    </div>
  )
}

function SectionNode({ data: { el }, selected }: NodeProps<ElNode>) {
  if (el.type !== 'section') return null
  const c = colorOf(el)
  return (
    <div className="el section" style={{ background: c.section, borderColor: selected ? undefined : c.border }}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        onResize={(_, p) =>
          setOverlay(
            new Map([[el.id, { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) }]]),
          )
        }
        onResizeEnd={commitOverlay}
      />
      <div className="section-title" style={{ background: c.bg }}>
        <EditableText el={el} field="title" />
      </div>
      <Handles />
    </div>
  )
}

export const nodeTypes = {
  section: SectionNode,
  note: NoteNode,
  task: TaskNode,
  link: LinkNode,
  box: BoxNode,
  code: CodeNode,
  text: TextNode,
}
