// ボードの一覧（D1）と中身（BoardRoom）をまたぐ操作。ページ・API・MCP で共有する
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { boards } from "./db/schema";
import type { Bindings } from "./global.d";

export const room = (env: Bindings, boardId: string) => env.BOARD.get(env.BOARD.idFromName(boardId));

export async function listBoards(env: Bindings, userId: string) {
  return drizzle(env.DB)
    .select({ id: boards.id, title: boards.title, updatedAt: boards.updatedAt })
    .from(boards)
    .where(eq(boards.userId, userId))
    .orderBy(desc(boards.updatedAt));
}

/** `userId` の持つボードだけを返す。他人のボードは「無い」ものとして扱う */
export async function loadOwnedBoard(env: Bindings, boardId: string, userId: string) {
  return (
    (await drizzle(env.DB)
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)))
      .get()) ?? null
  );
}

export async function createBoard(env: Bindings, userId: string, title: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await drizzle(env.DB).insert(boards).values({ id, userId, title: title.trim() || "Untitled", createdAt: now, updatedAt: now });
  await room(env, id).create(id);
  return id;
}

export async function deleteBoard(env: Bindings, boardId: string) {
  await room(env, boardId).destroy();
  await drizzle(env.DB).delete(boards).where(eq(boards.id, boardId));
}

export const boardUrl = (origin: string, id: string) => `${origin}/boards/${id}`;
