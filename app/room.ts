// 1ボード = 1 Durable Object。盤面の正本を持ち、ブラウザのタブ（WebSocket）と
// エージェント（Worker 経由の RPC）からの操作を同じ順序で適用して配る。
import { DurableObject } from "cloudflare:workers";
import { estimateSize } from "./board/layout";
import { type Board, DEFAULT_WIDTH, type El, emptyBoard, needsPlacement } from "./board/model";
import { applyOps, diff, type Op } from "./board/ops";
import { placeBoard, placementOp, type SizeOf } from "./board/placement";
import type { ClientMessage, ServerMessage } from "./board/protocol";
import type { Bindings } from "./global.d";

type Attachment = { client: string; at: number };
type Origin = { by: "agent" | "user"; client?: string; batch?: number };

/** タブが自動配置を返してくるまで待つ時間。過ぎたらサーバーが概算で配置する */
const PLACE_TIMEOUT = 2500;
/** 一覧の「更新日時」を D1 に書く間隔 */
const TOUCH_INTERVAL = 30_000;

export class BoardRoom extends DurableObject<Bindings> {
  private board: Board = emptyBoard();
  private version = 0;
  private boardId: string | undefined;
  private sizes: Record<string, [number, number]> = {};
  private waiters: (() => void)[] = [];
  private lastTouch = 0;
  private deleted = false;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get(["board", "version", "boardId", "sizes", "deleted"]);
      this.deleted = !!s.get("deleted");
      this.board = (s.get("board") as Board) ?? emptyBoard();
      this.version = (s.get("version") as number) ?? 0;
      this.boardId = s.get("boardId") as string | undefined;
      this.sizes = (s.get("sizes") as Record<string, [number, number]>) ?? {};
    });
  }

  // -------------------------------------------------------------------------
  // RPC（Worker から呼ぶ。所有者の確認は Worker 側で済んでいる）

  async create(boardId: string) {
    this.boardId = boardId;
    await this.ctx.storage.put("boardId", boardId);
  }

  /** エージェント向け: 座標は親からの相対値、w/h は実寸（未計測なら概算） */
  async snapshot() {
    const sizeOf = this.sizeOf();
    return {
      version: this.version,
      elements: this.board.elements.map((e) => {
        const { width, height } = e.type === "section" ? { width: e.w ?? DEFAULT_WIDTH.section, height: e.h ?? 400 } : sizeOf(e);
        const { w: _w, h: _h, ...rest } = e as El & { h?: number };
        return { ...rest, x: Math.round(e.x ?? 0), y: Math.round(e.y ?? 0), w: Math.round(width), h: Math.round(height) };
      }),
      edges: this.board.edges,
    };
  }

  /** エージェントの操作。自動配置まで終わってから返す */
  async apply(ops: Op[]): Promise<{ ids: string[] }> {
    if (this.deleted) throw new Error("this board was deleted");
    const result = await this.commit(ops, { by: "agent" });
    await this.settle();
    return result;
  }

  async destroy() {
    // 開いているタブに知らせてから閉じる。消した後に古いタブが書き込んで復活させないよう印を残す
    this.deleted = true;
    this.broadcast({ type: "deleted" });
    for (const ws of this.ctx.getWebSockets()) ws.close(4404, "board deleted");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("deleted", true);
    this.board = emptyBoard();
  }

  // -------------------------------------------------------------------------
  // WebSocket（ブラウザのタブ）

  async fetch(request: Request) {
    if (this.deleted) return new Response("board deleted", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const id = crypto.randomUUID();
    server.serializeAttachment({ client: id, at: Date.now() } satisfies Attachment);
    this.send(server, { type: "hello", client: id, primary: true });
    this.send(server, { type: "state", version: this.version, board: this.board });
    this.announceRoles();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as ClientMessage;
    const { client } = ws.deserializeAttachment() as Attachment;
    if (this.deleted) {
      this.send(ws, { type: "deleted" });
      return ws.close(4404, "board deleted");
    }
    if (msg.type === "ops") {
      try {
        await this.commit(msg.ops, { by: "user", client, batch: msg.batch });
      } catch (e) {
        this.send(ws, { type: "error", batch: msg.batch, message: (e as Error).message });
      }
    } else if (msg.type === "sizes") {
      Object.assign(this.sizes, msg.sizes);
      const live = new Set(this.board.elements.map((e) => e.id));
      for (const id of Object.keys(this.sizes)) if (!live.has(id)) delete this.sizes[id];
      await this.ctx.storage.put("sizes", this.sizes);
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    this.announceRoles();
  }

  async alarm() {
    if (needsPlacement(this.board)) await this.placeOnServer();
  }

  // -------------------------------------------------------------------------

  private async commit(ops: Op[], origin: Origin) {
    const before = this.board;
    const { board, ids } = applyOps(before, ops);
    const change = diff(before, board);
    if (!change && (board.layouts?.length ?? 0) === (before.layouts?.length ?? 0)) {
      // 何も変わらなくても ack は返す（送り主の保留を解くため）
      if (origin.client) this.broadcast({ type: "state", version: this.version, board: this.board, ack: { client: origin.client, batch: origin.batch! } });
      return { ids };
    }
    this.board = board;
    this.version++;
    await this.ctx.storage.put({ board, version: this.version });
    this.broadcast({
      type: "state",
      version: this.version,
      board,
      ...(origin.client && { ack: { client: origin.client, batch: origin.batch! } }),
      ...(change && { change: { by: origin.by, client: origin.client, ...change } }),
    });
    this.touch();
    if (needsPlacement(board)) {
      // 開いているタブ（primary）が実寸で配置するのを待ち、来なければサーバーが概算で配置する
      if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + PLACE_TIMEOUT);
      else await this.placeOnServer();
    } else {
      this.waiters.splice(0).forEach((w) => w());
    }
    return { ids };
  }

  /** 自動配置が終わるまで待つ */
  private async settle() {
    if (!needsPlacement(this.board)) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PLACE_TIMEOUT + 500);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (needsPlacement(this.board)) await this.placeOnServer();
  }

  private sizeOf(): SizeOf {
    return (el) => {
      const s = this.sizes[el.id];
      return s ? { width: s[0], height: s[1] } : estimateSize(el, el.w ?? DEFAULT_WIDTH[el.type]);
    };
  }

  private async placeOnServer() {
    const placed = await placeBoard(this.board, this.sizeOf());
    await this.commit([placementOp(this.board, placed)], { by: "user" });
  }

  private touch() {
    if (!this.boardId || Date.now() - this.lastTouch < TOUCH_INTERVAL) return;
    this.lastTouch = Date.now();
    this.ctx.waitUntil(
      this.env.DB.prepare("UPDATE boards SET updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), this.boardId)
        .run(),
    );
  }

  /** 最後に接続したタブを primary（自動配置の担当）にする */
  private announceRoles() {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    const latest = Math.max(...sockets.map((ws) => (ws.deserializeAttachment() as Attachment).at));
    for (const ws of sockets) this.send(ws, { type: "role", primary: (ws.deserializeAttachment() as Attachment).at === latest });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 切断済み
    }
  }

  private broadcast(msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // 切断済み
      }
    }
  }
}
