import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the console runs on Vite and reaches the BFF through this proxy. `changeOrigin` makes the Host header the
// BFF's own loopback authority, which its trust check requires; the BFF also accepts this server's origin (CONSOLE_DEV_ORIGIN).
// The BFF's port follows CONSOLE_PORT, so a preview can run beside a console that already holds 3090.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.CONSOLE_PORT || 3090}`, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
