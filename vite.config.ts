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
    chunkSizeWarningLimit: 1000, // Monaco Editor 核心包 >500KB 属于正常
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React 核心 + ReactDOM（必须在同一个 chunk，避免循环依赖）
            if (id.includes('/react-dom/') || id.match(/\/react\/(index|cjs)/) || id.includes('/react/')) {
              return 'react-vendor'
            }
            // Monaco 编辑器 — 核心与 React 绑定拆分
            if (id.includes('/monaco-editor/')) return 'monaco-core'
            if (id.includes('/@monaco-editor/')) return 'monaco-react'
            // 终端
            if (id.includes('/@xterm/')) return 'xterm-vendor'
            // Markdown 渲染 — 按子包拆分
            if (id.includes('/react-markdown/')) return 'markdown-react'
            if (id.includes('/remark-') || id.includes('/rehype-') || id.includes('/unified/') || id.includes('/unist/') || id.includes('/vfile/') || id.includes('/micromark/') || id.includes('/mdast-')) return 'markdown-parse'
            if (id.includes('/lowlight/') || id.includes('/highlight.js/') || id.includes('/highlight.js-')) return 'highlight-vendor'
            // Tauri API
            if (id.includes('/@tauri-apps/')) return 'tauri-vendor'
            // Zustand + 状态管理
            if (id.includes('/zustand/')) return 'app-state'
            // 其他 node_modules → 不单独拆分，让 Vite 自动处理
          }
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
