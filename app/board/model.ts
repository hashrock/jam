export const COLORS = {
  white: { bg: '#FFFFFF', border: '#B3B3B3', section: '#FFFFFF' },
  gray: { bg: '#E6E6E6', border: '#8F8F8F', section: '#F9F9F9' },
  yellow: { bg: '#FFE299', border: '#E8A302', section: '#FFFBF0' },
  orange: { bg: '#FFD3A8', border: '#EB7500', section: '#FFF7F0' },
  red: { bg: '#FFB8A8', border: '#DC3009', section: '#FFF5F5' },
  pink: { bg: '#FFA8DB', border: '#B42487', section: '#FFF0FA' },
  violet: { bg: '#D3BDFF', border: '#5427B4', section: '#F8F5FF' },
  blue: { bg: '#A8DAFF', border: '#007AD2', section: '#F5FBFF' },
  teal: { bg: '#B3F4EF', border: '#369E94', section: '#F1FEFD' },
  green: { bg: '#B3EFBD', border: '#3E9B4B', section: '#EBFFEE' },
} as const

export type Color = keyof typeof COLORS
export const COLOR_NAMES = Object.keys(COLORS) as Color[]

export type Shape = 'rect' | 'round' | 'ellipse' | 'diamond' | 'db'
export type TextSize = 'sm' | 'md' | 'lg' | 'xl'

type Base = {
  id: string
  /** 親セクションの id。省略時はトップレベル */
  parent?: string
  /** 親からの相対座標。未指定なら自動配置される */
  x?: number
  y?: number
  /** 固定幅。未指定なら種類ごとのデフォルト幅 */
  w?: number
  color?: Color
}

export type SectionEl = Base & { type: 'section'; title: string; h?: number }
export type NoteEl = Base & { type: 'note'; text: string }
export type TaskEl = Base & { type: 'task'; text: string; done?: boolean }
export type LinkEl = Base & { type: 'link'; url: string; title?: string }
export type BoxEl = Base & { type: 'box'; text: string; shape?: Shape }
export type CodeEl = Base & { type: 'code'; code: string; lang?: string }
export type TextEl = Base & { type: 'text'; text: string; size?: TextSize }

export type El = SectionEl | NoteEl | TaskEl | LinkEl | BoxEl | CodeEl | TextEl
export type ElType = El['type']

export type Edge = {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
}

export type LayoutMode = 'grid' | 'dag'
export type LayoutRequest = { id?: string; mode: LayoutMode }

export type Board = {
  /** 描画順。親は必ず子より前に並ぶ */
  elements: El[]
  edges: Edge[]
  /** まだ実行していないレイアウト要求。寸法を測れるタブ（なければサーバー）が処理して空にする */
  layouts?: LayoutRequest[]
}

/** 変更された要素・矢印の値（null は削除）。undo/redo と同期の単位 */
export type Patch = {
  elements: Record<string, El | null>
  edges: Record<string, Edge | null>
}

export const DEFAULT_WIDTH: Record<ElType, number> = {
  section: 640,
  note: 240,
  task: 280,
  link: 280,
  box: 160,
  code: 420,
  text: 0, // 0 = 内容に合わせる
}

export const DEFAULT_COLOR: Partial<Record<ElType, Color>> = {
  note: 'yellow',
  task: 'white',
  link: 'white',
  box: 'blue',
  section: 'gray',
}

export const emptyBoard = (): Board => ({ elements: [], edges: [] })

/** 座標が未確定の要素か、未処理のレイアウト要求があるか */
export const needsPlacement = (b: Board) =>
  !!b.layouts?.length || b.elements.some((e) => e.x == null || e.y == null)
