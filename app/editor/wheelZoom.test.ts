/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMouseWheelDetector, GESTURE_BURST_MS, stepZoomFactor, WHEEL_ZOOM_STEP, type WheelInput, zoomAt } from './wheelZoom.ts'

const wheel = (e: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: 0, ...e })

test('マウスホイールは速く回して deltaY が小数になってもマウスと判定する', () => {
  // macOS Chrome の実測値（edane の ADR 0001）
  const isMouse = createMouseWheelDetector()
  assert.equal(isMouse(wheel({ deltaY: -120, wheelDeltaY: 360 })), true)
  assert.equal(isMouse(wheel({ deltaY: -124.1241455078125, wheelDeltaY: 360, timeStamp: 16 })), true)
  assert.equal(isMouse(wheel({ deltaY: 208.441162109375, wheelDeltaY: -600, timeStamp: 32 })), true)
})

test('トラックパッドのピンチはマウスと判定しない', () => {
  const isMouse = createMouseWheelDetector()
  assert.equal(isMouse(wheel({ deltaY: 7.2001953125, wheelDeltaY: -120 })), false)
  assert.equal(isMouse(wheel({ deltaY: -3.4404296875, wheelDeltaY: 120, timeStamp: 16 })), false)
})

test('トラックパッドのスクロールはマウスと判定しない', () => {
  const isMouse = createMouseWheelDetector()
  assert.equal(isMouse(wheel({ deltaY: 4, wheelDeltaY: -12 })), false)
  assert.equal(isMouse(wheel({ deltaX: 2.5, deltaY: -7.5 })), false)
})

test('Firefox の行単位の delta はマウス', () => {
  assert.equal(createMouseWheelDetector()(wheel({ deltaY: 3, deltaMode: 1 })), true)
})

test('判別できないイベントは続きなら直前を引き継ぎ、間が空けばマウスに戻る', () => {
  const isMouse = createMouseWheelDetector()
  assert.equal(isMouse(wheel({ deltaY: 4 })), true)
  assert.equal(isMouse(wheel({ deltaY: 1.5, timeStamp: 10 })), false)
  assert.equal(isMouse(wheel({ deltaY: 4, timeStamp: 20 })), false)
  assert.equal(isMouse(wheel({ deltaY: 4, timeStamp: 20 + GESTURE_BURST_MS })), true)
})

test('ズームは回した量によらず 1 段', () => {
  assert.equal(stepZoomFactor(100), 1 / WHEEL_ZOOM_STEP)
  assert.equal(stepZoomFactor(-600), WHEEL_ZOOM_STEP)
})

test('zoomAt はアンカーの下の点を動かさず、範囲内に収める', () => {
  const v = { x: 10, y: 20, zoom: 1 }
  const anchor = { x: 110, y: 70 }
  assert.deepEqual(zoomAt(v, anchor, 2, 0.1, 4), { x: -90, y: -30, zoom: 2 })
  assert.equal(zoomAt(v, anchor, 10, 0.1, 2).zoom, 2)
  assert.equal(zoomAt(v, anchor, 0.01, 0.1, 2).zoom, 0.1)
})
