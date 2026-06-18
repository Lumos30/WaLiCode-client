import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// 将 @monaco-editor/react 的加载器指向本地引入的 monaco 实例，禁止它去请求 CDN
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
