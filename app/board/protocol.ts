// ブラウザ ⇔ BoardRoom（Durable Object）の WebSocket メッセージ
import type { Board, Patch } from './model'
import type { Op } from './ops'

export type ClientMessage =
  /** 操作の送信。batch はクライアント内で単調増加する番号 */
  | { type: 'ops'; batch: number; ops: Op[] }
  /** 実寸の報告（サーバー側の概算配置の精度を上げる） */
  | { type: 'sizes'; sizes: Record<string, [number, number]> }

export type ServerMessage =
  /**
   * 盤面の正本。接続直後と変更のたびに届く。
   * ack はその変更を送ったクライアントとバッチ番号、change は変更前後の差分と送り主
   */
  | {
      type: 'state'
      version: number
      board: Board
      ack?: { client: string; batch: number }
      change?: { by: 'agent' | 'user'; client?: string; before: Patch; after: Patch }
    }
  /** 自分の接続情報。primary は自動配置を担当するタブ */
  | { type: 'hello'; client: string; primary: boolean }
  | { type: 'role'; primary: boolean }
  | { type: 'error'; batch: number; message: string }
  /** ボードが削除された。以後は接続し直さない */
  | { type: 'deleted' }
