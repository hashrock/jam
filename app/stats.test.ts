/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { statsApp } from './stats.ts'
import { memoryDb } from './db/memoryDb.ts'

const now = new Date('2026-09-18T12:00:00.000Z')
const app = statsApp(() => now)
const DB = memoryDb([
  { id: 'u1', createdAt: '2026-09-17T00:00:00.000Z' },
  { id: 'u2', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'scenario-abc', createdAt: '2026-09-18T00:00:00.000Z' },
])
const get = (env: Record<string, unknown>, auth?: string) =>
  app.request('/', { headers: auth ? { Authorization: auth } : {} }, { DB, ...env })

test('STATS_TOKEN 未設定なら 404', async () => {
  assert.equal((await get({}, 'Bearer anything')).status, 404)
  assert.equal((await get({ STATS_TOKEN: '' }, 'Bearer ')).status, 404)
})

test('トークン不一致・ヘッダなしは 401', async () => {
  assert.equal((await get({ STATS_TOKEN: 'secret' }, 'Bearer wrong')).status, 401)
  assert.equal((await get({ STATS_TOKEN: 'secret' }, 'Bearer secret-longer')).status, 401)
  assert.equal((await get({ STATS_TOKEN: 'secret' }, 'secret')).status, 401)
  assert.equal((await get({ STATS_TOKEN: 'secret' })).status, 401)
})

test('一致すれば件数を返す（no-store）', async () => {
  const res = await get({ STATS_TOKEN: 'secret' }, 'Bearer secret')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await res.json(), {
    service: 'jam',
    generated_at: '2026-09-18T12:00:00.000Z',
    users: { total: 2, new_7d: 1, new_30d: 1 },
  })
})
