// リモート MCP（Streamable HTTP, ステートレス）。Claude Code / Codex が API トークンで直接つなぐ。
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { Context } from "hono";
import type { Op } from "./board/ops";
import { MCP_INSTRUCTIONS, serverTools } from "./board/tools";
import { boardUrl, createBoard, listBoards, loadOwnedBoard, room } from "./boards";
import type { Env } from "./global.d";
import type { SessionUser } from "./user";

type Args = Record<string, unknown>;

async function callTool(c: Context<Env>, user: SessionUser, name: string, args: Args): Promise<unknown> {
  const origin = new URL(c.req.url).origin;
  const owned = async () => {
    const id = String(args.board_id ?? "");
    if (!(await loadOwnedBoard(c.env, id, user.id))) throw new Error(`no board "${id}". Call list_boards to see the available ids.`);
    return room(c.env, id);
  };
  switch (name) {
    case "list_boards":
      return (await listBoards(c.env, user.id)).map((b) => ({ ...b, url: boardUrl(origin, b.id) }));
    case "create_board": {
      const id = await createBoard(c.env, user.id, String(args.title ?? ""));
      return { id, url: boardUrl(origin, id) };
    }
    case "get_board":
      return (await owned()).snapshot();
    case "apply": {
      if (!Array.isArray(args.ops)) throw new Error('"ops" must be an array');
      return (await owned()).apply(args.ops as Op[]);
    }
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

export async function handleMcp(c: Context<Env>) {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized. Issue an API token at /settings and send it as a Bearer token." }, 401, {
      "WWW-Authenticate": 'Bearer realm="jam"',
    });
  }
  const server = new Server(
    { name: "jam", version: "0.2.0" },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: serverTools.map((t) => structuredClone(t) as never),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await callTool(c, user, req.params.name, (req.params.arguments ?? {}) as Args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      // DO の RPC 越しの例外は "Error: ops[0]: ..." のように前置きが付く
      return { content: [{ type: "text", text: `error: ${(e as Error).message.replace(/^Error: /, "")}` }], isError: true };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}
