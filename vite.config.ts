import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

// 由于 Vite plugin 的导出形式可能是 esm default，尝试兼容取 .default 或它本身
const monacoPlugin = (monacoEditorPlugin as any).default || monacoEditorPlugin

/**
 * vite-plugin-monaco-editor writes workers after Vite has emptied dist. When a
 * worker is removed from its configuration, the plugin deliberately leaves the
 * old generated file behind. Remove only that generated directory before each
 * production build so the deployed asset set matches languageWorkers exactly.
 */
function cleanGeneratedMonacoWorkers(): Plugin {
  return {
    name: 'clean-generated-monaco-workers',
    apply: 'build',
    buildStart() {
      rmSync(resolve(__dirname, 'dist', 'monacoeditorwork'), {
        recursive: true,
        force: true,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cleanGeneratedMonacoWorkers(),
    monacoPlugin({
      // File workspaces are already lazy. Keep their first open bounded too:
      // editing/diff/highlighting use the editor worker, JSON keeps validation;
      // heavyweight TypeScript/CSS/HTML language services are not preloaded.
      languageWorkers: ['editorWorkerService', 'json']
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
            // Monaco belongs to lazy file workspaces. Let Vite derive its shared
            // dynamic chunk instead of forcing it into an entry dependency.
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
