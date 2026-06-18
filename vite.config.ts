import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

// 由于 Vite plugin 的导出形式可能是 esm default，尝试兼容取 .default 或它本身
const monacoPlugin = (monacoEditorPlugin as any).default || monacoEditorPlugin

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    monacoPlugin({
      // 根据你的需要，可以只引入基础语言，减少包体积
      // 例如 ['json', 'javascript', 'typescript', 'html', 'css']
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript']
    }),
  ],
  base: './',
  clearScreen: false,
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8091',
        changeOrigin: true,
      },
    },
  },
})
