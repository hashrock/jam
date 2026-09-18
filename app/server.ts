import { Hono } from "hono";
import { inertia } from "@hono/inertia";
import { googleAuth } from "@hono/oauth-providers/google";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { rootView } from "./root-view";
import { apiTokens, boards, users } from "./db/schema";
import { authMiddleware, selectAuth } from "./auth";
import { findUserByEmail, insertUser } from "./utils/userRepository";
import { hashToken } from "./utils/tokenHash";
import { createBoard, deleteBoard, listBoards, loadOwnedBoard, room } from "./boards";
import { handleMcp } from "./mcp";
import type { Env } from "./global.d";

export { BoardRoom } from "./room";

const app = new Hono<Env>();

app.use("*", authMiddleware(selectAuth));
app.use(inertia({ rootView }));

// --- Auth (full-page redirects, not Inertia) ---
app.get(
  "/auth/google",
  googleAuth({ scope: ["openid", "email", "profile"], prompt: "select_account" }),
  async (c) => {
    const googleUser = c.get("user-google");
    if (!googleUser?.email) return c.redirect("/?error=auth");

    const db = drizzle(c.env.DB);
    const existing = await findUserByEmail(db, googleUser.email);
    const profile = { name: googleUser.name || "", avatarUrl: googleUser.picture || "" };
    let userId: string;
    if (existing) {
      userId = existing.id;
      await db.update(users).set(profile).where(eq(users.id, existing.id));
    } else {
      userId = crypto.randomUUID();
      await insertUser(db, { id: userId, email: googleUser.email, ...profile });
    }
    await c.get("auth").signIn(c, { id: userId, email: googleUser.email, ...profile });
    return c.redirect("/boards");
  },
);

app.get("/auth/logout", async (c) => {
  await c.get("auth").signOut(c);
  return c.redirect("/");
});

// --- Remote MCP (Bearer token) ---
app.all("/mcp", handleMcp);

// --- Board realtime channel: the tab ⇔ BoardRoom WebSocket ---
app.get("/api/boards/:id/ws", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("Unauthorized", 401);
  const id = c.req.param("id");
  if (!(await loadOwnedBoard(c.env, id, user.id))) return c.text("Not found", 404);
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected websocket", 426);
  return room(c.env, id).fetch(c.req.raw);
});

app.patch("/api/boards/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (!(await loadOwnedBoard(c.env, id, user.id))) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const title = body.title?.trim();
  if (title) {
    await drizzle(c.env.DB)
      .update(boards)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(boards.id, id));
  }
  return c.json({ ok: true });
});

// --- API tokens (for remote MCP) ---
app.post("/api/tokens", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const rawToken = `jam_${crypto.randomUUID().replace(/-/g, "")}`;
  const id = crypto.randomUUID();
  const name = body.name?.trim() || "default";
  await drizzle(c.env.DB)
    .insert(apiTokens)
    .values({ id, userId: user.id, name, tokenHash: await hashToken(rawToken), createdAt: new Date().toISOString() });
  // Return the raw token only once — it cannot be retrieved later
  return c.json({ id, token: rawToken, name }, 201);
});

app.delete("/api/tokens/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await drizzle(c.env.DB)
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, user.id)));
  return c.json({ ok: true });
});

// --- Inertia pages ---
const routes = app
  .get("/", (c) => {
    if (c.get("user")) return c.redirect("/boards");
    return c.render("Home", {});
  })
  .get("/boards", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    return c.render("Boards/Index", { user, boards: await listBoards(c.env, user.id) });
  })
  .post("/boards", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const id = await createBoard(c.env, user.id, body.title ?? "");
    return c.redirect(`/boards/${id}`, 303);
  })
  .delete("/boards/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    const id = c.req.param("id");
    if (await loadOwnedBoard(c.env, id, user.id)) await deleteBoard(c.env, id);
    return c.redirect("/boards", 303);
  })
  .get("/boards/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    const board = await loadOwnedBoard(c.env, c.req.param("id"), user.id);
    if (!board) return c.notFound();
    return c.render("Boards/Show", { user, board: { id: board.id, title: board.title } });
  })
  .get("/settings", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    const tokens = await drizzle(c.env.DB)
      .select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt })
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id));
    return c.render("Settings", { user, tokens, mcpUrl: `${new URL(c.req.url).origin}/mcp` });
  });

export default routes;
