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
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'react-vendor': ['react', 'react-dom'],
          // Monaco 编辑器
          'monaco-vendor': ['@monaco-editor/react', 'monaco-editor'],
          // 终端
          'xterm-vendor': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-webgl'],
          // Markdown 渲染
          'markdown-vendor': ['react-markdown', 'remark-gfm', 'rehype-highlight', 'highlight.js', 'lowlight'],
          // Tauri API
          'tauri-vendor': ['@tauri-apps/api', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-opener'],
        },
      },
    },
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
