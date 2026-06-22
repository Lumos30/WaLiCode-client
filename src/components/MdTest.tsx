import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { all } from 'lowlight'

const TEST_MD = `## 测试标题

| 列1 | 列2 |
|-----|-----|
| A   | B   |
| C   | D   |

- 列表项1
- 列表项2

**粗体** 和 *斜体*

\`\`\`java
System.out.println("hello");
\`\`\`

> 引用块
`

export function MdTest() {
  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', color: '#e0e0e0', minHeight: '100vh' }}>
      <h1>Markdown 渲染测试</h1>
      <div style={{ backgroundColor: '#16213e', padding: 16, borderRadius: 8, maxWidth: 600 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { languages: all, aliases: { vue: 'xml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript' } }]]}
          components={{
            code: ({ className, children }: { className?: string; children?: React.ReactNode }) => (
              <pre style={{ backgroundColor: '#0f0f23', padding: 8, borderRadius: 4, overflow: 'auto' }}>
                <code className={className}>{children}</code>
              </pre>
            ),
            p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: '8px 0' }}>{children}</p>,
            table: ({ children }: { children?: React.ReactNode }) => (
              <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #333' }}>{children}</table>
            ),
            th: ({ children }: { children?: React.ReactNode }) => <th style={{ border: '1px solid #333', padding: 4 }}>{children}</th>,
            td: ({ children }: { children?: React.ReactNode }) => <td style={{ border: '1px solid #333', padding: 4 }}>{children}</td>,
          }}
        >
          {TEST_MD}
        </ReactMarkdown>
      </div>
      <p style={{ marginTop: 16 }}>如果你能看到格式化的表格、代码块和标题，说明 react-markdown 工作正常。</p>
    </div>
  )
}
