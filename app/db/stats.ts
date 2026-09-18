/**
 * サインアップ数の集計（GET /api/stats 用）。UI テストの使い捨てユーザー（id が `scenario-`）は数えない。
 *
 * `created_at` は JS の ISO 文字列（`2026-09-18T01:02:03.456Z`）なので、文字列のまま
 * `datetime('now', ...)`（`2026-09-18 01:02:03`）と比べると同じ日の順序が崩れる。両辺を datetime() で揃える。
 */
export type UserCounts = { total: number; new_7d: number; new_30d: number };

/** D1Database のうち、ここで使う分だけ（テストは node:sqlite の薄いラッパーを渡す）。 */
export type StatsDb = {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
};

const COUNT_USERS_SQL = `
SELECT
  COUNT(*) AS total,
  COALESCE(SUM(datetime(created_at) >= datetime(?1, '-7 days')), 0) AS new_7d,
  COALESCE(SUM(datetime(created_at) >= datetime(?1, '-30 days')), 0) AS new_30d
FROM users
WHERE id NOT LIKE 'scenario-%'`;

export async function countUsers(db: StatsDb, now: Date = new Date()): Promise<UserCounts> {
  const row = await db.prepare(COUNT_USERS_SQL).bind(now.toISOString()).first<UserCounts>();
  return {
    total: Number(row?.total ?? 0),
    new_7d: Number(row?.new_7d ?? 0),
    new_30d: Number(row?.new_30d ?? 0),
  };
}
