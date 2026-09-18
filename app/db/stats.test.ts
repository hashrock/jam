/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countUsers } from './stats.ts'
import { memoryDb } from './memoryDb.ts'

const now = new Date('2026-09-18T12:00:00.000Z')
const daysAgo = (d: number, extraMs = 0) => new Date(now.getTime() - d * 86_400_000 - extraMs).toISOString()

test('ちょうど 7 日前・30 日前は含み、1 秒前は含まない', async () => {
  const db = memoryDb([
    { id: 'a', createdAt: daysAgo(7) },
    { id: 'b', createdAt: daysAgo(7, 1000) },
    { id: 'c', createdAt: daysAgo(30) },
    { id: 'd', createdAt: daysAgo(30, 1000) },
    { id: 'e', createdAt: now.toISOString() },
  ])
  assert.deepEqual(await countUsers(db, now), { total: 5, new_7d: 2, new_30d: 4 })
})

test('scenario- ユーザーは数えない', async () => {
  const db = memoryDb([
    { id: 'scenario-1', createdAt: now.toISOString() },
    { id: 'scenario-old', createdAt: daysAgo(100) },
    { id: 'real', createdAt: daysAgo(1) },
    { id: 'my-scenario-x', createdAt: daysAgo(100) },
  ])
  assert.deepEqual(await countUsers(db, now), { total: 2, new_7d: 1, new_30d: 1 })
})

test('ユーザーがいなければ 0', async () => {
  assert.deepEqual(await countUsers(memoryDb([]), now), { total: 0, new_7d: 0, new_30d: 0 })
})
