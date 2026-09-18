#!/usr/bin/env node
// Claude Code / Codex から stdio で起動される MCP サーバー。
// ツール呼び出しを開発サーバーのハブ経由でブラウザのボードに中継する。
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { WebSocket } from 'ws'
import { HUB_PATH, toolDefs, type WireMessage } from '../src/board/tools.ts'

const BASE = process.env.JAM_URL ?? 'http://localhost:5199'
const HUB = `${BASE.replace(/^http/, 'ws')}${HUB_PATH}?role=agent`
const TIMEOUT = 30_000

let socket: Promise<WebSocket> | undefined
const waiting = new Map<string, (m: WireMessage & { type: 'result' }) => void>()
let seq = 0

function connect(): Promise<WebSocket> {
  socket ??= new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB)
    ws.once('open', () => resolve(ws))
    ws.once('error', () => {
      socket = undefined
      reject(new Error(`cannot reach the jam server at ${BASE}. Ask the user to run \`pnpm dev\` in the jam repository.`))
    })
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as WireMessage
      if (m.type === 'result') waiting.get(m.id)?.(m)
    })
    ws.on('close', () => {
      socket = undefined
      for (const [id, done] of waiting) done({ type: 'result', id, ok: false, error: 'connection to the jam server was lost' })
    })
  })
  return socket
}

async function call(name: string, input: unknown) {
  const ws = await connect()
  const id = String(++seq)
  return new Promise<WireMessage & { type: 'result' }>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve({ type: 'result', id, ok: false, error: 'the board did not respond in time' })
    }, TIMEOUT)
    waiting.set(id, (m) => {
      clearTimeout(timer)
      waiting.delete(id)
      resolve(m)
    })
    ws.send(JSON.stringify({ type: 'call', id, name, input } satisfies WireMessage))
  })
}

const server = new Server(
  { name: 'jam', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions: `jam is a whiteboard (like a minimal FigJam) that the user keeps open in a browser at ${BASE}. Use it to lay out code summaries, issue/PR links, TODOs with dependencies, and design diagrams for the user. Always call get_board before editing, and prefer adding over rearranging what the user placed by hand.`,
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.map((t) => ({ ...t, inputSchema: { ...t.inputSchema } })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const r = await call(req.params.name, req.params.arguments ?? {})
    if (!r.ok) return { content: [{ type: 'text', text: `error: ${r.error}` }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(r.result) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true }
  }
})

await server.connect(new StdioServerTransport())
