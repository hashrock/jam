// 開発サーバーに相乗りするハブ。
// - ブラウザのタブ（role=board）と MCP ブリッジ（role=agent）を WebSocket で中継する
// - 盤面を JSON ファイルに保存し、ファイルが外から書き換えられたらタブに配り直す
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'
import { HUB_PATH, type WireMessage } from '../src/board/tools.ts'

export function jamHub(): Plugin {
  return {
    name: 'jam-hub',
    apply: 'serve',
    configureServer(server) {
      const file = resolve(process.env.JAM_FILE ?? resolve(server.config.root, 'board.jam.json'))
      const log = (msg: string) => server.config.logger.info(`[jam] ${msg}`, { timestamp: true })

      let lastWritten = existsSync(file) ? readFileSync(file, 'utf8') : ''
      const read = () => {
        if (!existsSync(file)) return null
        try {
          return JSON.parse(readFileSync(file, 'utf8')) as unknown
        } catch {
          return undefined // 書き込み途中などで壊れている
        }
      }

      const boards: WebSocket[] = []
      const pending = new Map<string, { agent: WebSocket; id: string }>()
      let seq = 0
      const send = (ws: WebSocket, m: WireMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

      const wss = new WebSocketServer({ noServer: true })
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith(HUB_PATH)) return
        wss.handleUpgrade(req, socket, head, (ws) => {
          const role = new URL(req.url!, 'http://x').searchParams.get('role')
          if (role === 'board') onBoard(ws)
          else onAgent(ws)
        })
      })

      const announce = () => boards.forEach((b, i) => send(b, { type: 'role', primary: i === boards.length - 1 }))

      function onBoard(ws: WebSocket) {
        boards.push(ws)
        log(`board connected (${boards.length})`)
        announce()
        send(ws, { type: 'load', board: read() ?? null })
        ws.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as WireMessage
          if (m.type === 'save') {
            const text = JSON.stringify(m.board, null, 2) + '\n'
            if (text === lastWritten) return
            lastWritten = text
            writeFileSync(file, text)
            // 他のタブにも反映する
            for (const b of boards) if (b !== ws) send(b, { type: 'load', board: m.board })
          } else if (m.type === 'result') {
            const p = pending.get(m.id)
            if (!p) return
            pending.delete(m.id)
            send(p.agent, { ...m, id: p.id })
          }
        })
        ws.on('close', () => {
          boards.splice(boards.indexOf(ws), 1)
          log(`board disconnected (${boards.length})`)
          announce()
        })
      }

      function onAgent(ws: WebSocket) {
        ws.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as WireMessage
          if (m.type !== 'call') return
          // 最後に開いたタブを操作対象にする
          const board = boards.at(-1)
          if (!board) {
            send(ws, {
              type: 'result',
              id: m.id,
              ok: false,
              error: `no board is open. Ask the user to open http://localhost:${server.config.server.port} in a browser.`,
            })
            return
          }
          const hubId = String(++seq)
          pending.set(hubId, { agent: ws, id: m.id })
          send(board, { ...m, id: hubId })
        })
        ws.on('close', () => {
          for (const [k, p] of pending) if (p.agent === ws) pending.delete(k)
        })
      }

      // エディタや git でファイルが書き換えられたら読み直す
      let timer: NodeJS.Timeout | undefined
      watch(dirname(file), (_, name) => {
        if (name !== basename(file)) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (!existsSync(file)) return
          const text = readFileSync(file, 'utf8')
          if (text === lastWritten) return
          const board = read()
          if (board === undefined) return
          lastWritten = text
          log('board file changed on disk, reloading')
          for (const b of boards) send(b, { type: 'load', board })
        }, 100)
      })

      log(`board file: ${file}`)
    },
  }
}
