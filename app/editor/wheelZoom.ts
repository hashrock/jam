/**
 * ⌘・Ctrl + スクロールのズームを、マウスホイールのときだけ 1 イベント 1 段の固定倍率にする。
 *
 * React Flow は wheel の deltaY に比例してズームし、macOS で ctrlKey が立っているとさらに 10 倍する
 * （トラックパッドのピンチ向け）。ピンチの deltaY は小さいので滑らかだが、Ctrl + マウスホイールだと
 * 1 ノッチで deltaY が 100 を超え、加速が乗ると 200 以上にもなって一気に何倍も飛んでしまう。
 *
 * ブラウザは入力デバイスを教えてくれないので、edane（app/lib/panZoom.ts）と同じ手がかりで見分ける:
 *   - deltaMode が行・ページ単位 → マウス（Firefox）
 *   - wheelDeltaY（Chrome / Safari）が 120 の倍数でない → トラックパッド。2 ノッチ分以上 → マウス
 *   - ちょうど ±120 で deltaY が小数 → ピンチ。整数なら 1 ノッチのマウスかもしれず判別できない
 *   - wheelDeltaY が無ければ、小数の delta や横成分 → トラックパッド
 * 判別できないイベントは、続けて届いている間は直前の判定を引き継ぎ、そうでなければマウスとみなす。
 */

import type { Viewport } from '@xyflow/react'

export const WHEEL_ZOOM_STEP = 1.1

/** これより間が空かずに届く wheel は同じ操作の続きとみなす */
export const GESTURE_BURST_MS = 300

export interface WheelInput {
  deltaX: number
  deltaY: number
  /** 0 = ピクセル, 1 = 行, 2 = ページ */
  deltaMode: number
  timeStamp: number
  /** WebKit 系の旧プロパティ。マウスは 1 ノッチ ±120 の倍数、トラックパッドは -3 * deltaY */
  wheelDeltaY?: number
}

type Device = 'mouse' | 'trackpad'

function detectDevice(e: WheelInput): Device | null {
  if (e.deltaMode !== 0) return 'mouse'
  // deltaY は OS のスクロール加速でマウスでも小数になるので、wheelDeltaY を先に見る
  if (e.wheelDeltaY) {
    if (e.wheelDeltaY % 120 !== 0) return 'trackpad'
    // ノッチがまとめて届くのはマウスだけ（ピンチは ±120 に張り付く）
    if (Math.abs(e.wheelDeltaY) > 120) return 'mouse'
    if (!Number.isInteger(e.deltaY)) return 'trackpad'
    return null
  }
  if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) return 'trackpad'
  return null
}

/** wheel がマウスホイールから来たかを返す関数を作る。直前の判定を覚えているので、キャンバスごとに 1 つ */
export function createMouseWheelDetector(): (e: WheelInput) => boolean {
  let last: Device = 'mouse'
  let lastTime = -Infinity
  return (e) => {
    const inBurst = e.timeStamp - lastTime < GESTURE_BURST_MS
    last = detectDevice(e) ?? (inBurst ? last : 'mouse')
    lastTime = e.timeStamp
    return last === 'mouse'
  }
}

/** 下に回すと縮小、上に回すと拡大。回した量によらず 1 段 */
export function stepZoomFactor(deltaY: number): number {
  return deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP
}

/** anchor（キャンバス左上からの画面座標）の下にある点を動かさずに factor 倍する */
export function zoomAt(
  v: Viewport,
  anchor: { x: number; y: number },
  factor: number,
  minZoom: number,
  maxZoom: number,
): Viewport {
  const zoom = Math.min(maxZoom, Math.max(minZoom, v.zoom * factor))
  const k = zoom / v.zoom
  return { x: anchor.x - (anchor.x - v.x) * k, y: anchor.y - (anchor.y - v.y) * k, zoom }
}
