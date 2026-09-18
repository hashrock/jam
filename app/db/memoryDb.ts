/// <reference types="node" />
// テスト専用（本番コードからは import しない）
import { DatabaseSync } from 'node:sqlite'
import type { StatsDb } from './stats.ts'

/** migrations/0000_init.sql の users を node:sqlite に作り、D1 の prepare/bind/first だけを真似る */
export function memoryDb(rows: { id: string; createdAt: string }[]): StatsDb {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE users (id text PRIMARY KEY NOT NULL, email text NOT NULL, created_at text NOT NULL)')
  const insert = sqlite.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
  for (const r of rows) insert.run(r.id, `${r.id}@example.com`, r.createdAt)
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async <T>() => (sqlite.prepare(sql).get(...(values as string[])) ?? null) as T | null,
      }),
    }),
  }
}
