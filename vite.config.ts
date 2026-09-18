import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { jamHub } from './server/hub.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), jamHub()],
  // MCP ブリッジが接続先として決め打ちするので固定する（変えるなら JAM_URL も合わせる）
  server: { port: 5199, strictPort: true },
})
