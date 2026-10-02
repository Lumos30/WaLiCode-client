import { useEffect, useMemo, useState } from 'react'
import { useThemeStore } from '../stores/themeStore'
import * as agentApi from '../api/agent'
import { MemoryRelationGraph } from './MemoryRelationGraph'

interface MemoryPanelProps {
  open: boolean
  onClose: () => void
  sessionId: string | null
  projectRootPath: string | null
}

const SCOPE_LABEL: Record<agentApi.AgentMemoryScope, string> = {
  SESSION: '当前会话', PROJECT: '当前项目', EXPERIENCE: '通用经验',
}
const ORIGIN_LABEL: Record<NonNullable<agentApi.AgentMemoryDTO['proposalOrigin']>, string> = {
  USER_REQUEST: '你创建的候选', AGENT_PROPOSAL: 'Agent 建议', DETERMINISTIC_TOOL: '工具证据',
}
type View = 'INBOX' | 'ACTIVE' | 'ALL' | 'GRAPH'
type OriginFilter = 'ALL' | 'AGENT_PROPOSAL' | 'DETERMINISTIC_TOOL' | 'USER_REQUEST'
type ExpiryFilter = 'ALL' | 'VALID' | 'EXPIRED'

/** Owner-facing, review-first durable memory inbox. Candidates never activate by themselves. */
export function MemoryPanel({ open, onClose, sessionId, projectRootPath }: MemoryPanelProps) {
  const { colors } = useThemeStore()
  const [memories, setMemories] = useState<agentApi.AgentMemoryDTO[]>([])
  const [scope, setScope] = useState<agentApi.AgentMemoryScope>('SESSION')
  const [factText, setFactText] = useState('')
  const [view, setView] = useState<View>('INBOX')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL')
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [supersedeTargets, setSupersedeTargets] = useState<Record<string, string>>({})
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const next = await agentApi.listMemories()
      setMemories(next)
      setSelected(previous => new Set([...previous].filter(id => next.some(memory => memory.memoryId === id && memory.status === 'PENDING'))))
      setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open) void load() }, [open])

  const inbox = useMemo(() => memories.filter(memory => memory.status === 'PENDING'), [memories])
  const visible = useMemo(() => {
    const byView = view === 'INBOX' ? inbox : view === 'ACTIVE'
      ? memories.filter(memory => memory.status === 'ACTIVE') : view === 'GRAPH'
        ? memories.filter(memory => memory.status !== 'PENDING' && memory.status !== 'DELETED') : memories
    return byView.filter(memory => (originFilter === 'ALL' || memory.proposalOrigin === originFilter)
      && (expiryFilter === 'ALL' || (expiryFilter === 'EXPIRED' ? memory.expired : !memory.expired)))
  }, [expiryFilter, inbox, memories, originFilter, view])
  const graphNodes = useMemo(() => visible.slice(0, 24), [visible])
  const graphEdges = useMemo(() => {
    const allowed = new Set(graphNodes.map(memory => memory.memoryId))
    const unique = new Map<string, agentApi.AgentMemoryRelationDTO>()
    graphNodes.flatMap(memory => memory.relations || []).forEach(relation => {
      if (relation.sourceEvidenceId && allowed.has(relation.fromMemoryId) && allowed.has(relation.toMemoryId)) {
        unique.set(relation.relationId, relation)
      }
    })
    return [...unique.values()]
  }, [graphNodes])
  const selectedGraphNode = graphNodes.find(memory => memory.memoryId === selectedGraphNodeId) || null

  const propose = async () => {
    if (!factText.trim()) return
    if ((scope === 'SESSION' || scope === 'PROJECT') && !sessionId) {
      setError('会话或项目记忆需要先创建并选中一个会话'); return
    }
    if (scope === 'PROJECT' && !projectRootPath) {
      setError('项目记忆需要当前项目根路径；请先打开本地项目或在远程会话中选择项目目录'); return
    }
    setLoading(true)
    try {
      await agentApi.proposeMemory({ scope, sessionId, projectRootPath: scope === 'PROJECT' ? projectRootPath : null, factText })
      setFactText(''); setView('INBOX'); setError(null); await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }

  const act = async (id: string, action: 'confirm' | 'reject' | 'delete') => {
    setActionId(id)
    try {
      if (action === 'confirm') await agentApi.confirmMemory(id)
      else if (action === 'reject') await agentApi.rejectMemory(id)
      else await agentApi.deleteMemory(id)
      setError(null); await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setActionId(null) }
  }

  const saveEdit = async (memoryId: string) => {
    if (!editingText.trim()) { setError('记忆事实不能为空'); return }
    setActionId(memoryId)
    try {
      await agentApi.editMemory(memoryId, editingText)
      setEditingId(null); setEditingText(''); setError(null); await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setActionId(null) }
  }

  const toggle = (memoryId: string) => setSelected(previous => {
    const next = new Set(previous)
    if (next.has(memoryId)) next.delete(memoryId); else next.add(memoryId)
    return next
  })

  const batch = async (action: agentApi.AgentMemoryBatchAction) => {
    const ids = [...selected]
    if (!ids.length) return
    if (action === 'REJECT' && !window.confirm(`确定拒绝选中的 ${ids.length} 条候选吗？`)) return
    setLoading(true)
    try {
      const results = await agentApi.batchMemoryAction(ids, action)
      const failures = results.filter(result => !result.succeeded)
      setError(failures.length ? `${failures.length} 条未处理：${failures.map(item => item.error || item.memoryId).join('；')}` : null)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }

  const toggleAllInbox = () => setSelected(previous => previous.size === inbox.length
    ? new Set() : new Set(inbox.map(memory => memory.memoryId)))
  const sourceLabel = (memory: agentApi.AgentMemoryDTO) => {
    const reference = memory.sourceRunId || memory.sourceTaskId || memory.sourceSessionId
    return [memory.sourceType || '未标注来源', reference ? `#${reference.slice(0, 18)}` : ''].filter(Boolean).join(' · ')
  }
  const supersede = async (memoryId: string) => {
    const previousMemoryId = supersedeTargets[memoryId]
    if (!previousMemoryId) { setError('请选择要替代的已启用记忆'); return }
    if (!window.confirm('建立替代关系后，旧记忆将停止参与后续检索。继续吗？')) return
    setActionId(memoryId)
    try { await agentApi.supersedeMemory(memoryId, previousMemoryId); setError(null); await load() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setActionId(null) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div className="w-[700px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] flex flex-col rounded-xl shadow-2xl"
           style={{ backgroundColor: colors.bgPrimary, border: `1px solid ${colors.border}` }} onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <div><div className="text-sm font-semibold" style={{ color: colors.text }}>长期记忆收件箱</div>
            <div className="text-[11px] mt-0.5" style={{ color: colors.textDim }}>Agent 建议默认待确认；只有受控工具的确定性验证可按严格规则自动启用。</div></div>
          <button onClick={onClose} className="p-1 rounded" style={{ color: colors.textDim }}>✕</button>
        </div>
        <div className="p-4 space-y-2" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <textarea value={factText} onChange={event => setFactText(event.target.value)} maxLength={1000}
                    placeholder="手动补充事实，例如：此项目统一使用 Java 17。不要填写密码、令牌或提示词指令。"
                    className="w-full min-h-16 p-2 rounded-md text-xs outline-none resize-y"
                    style={{ color: colors.text, backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }} />
          <div className="flex gap-2 items-center">
            <select value={scope} onChange={event => setScope(event.target.value as agentApi.AgentMemoryScope)}
                    className="text-xs rounded px-2 py-1.5" style={{ color: colors.text, backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              {(Object.keys(SCOPE_LABEL) as agentApi.AgentMemoryScope[]).map(item => <option key={item} value={item}>{SCOPE_LABEL[item]}</option>)}
            </select>
            <button onClick={() => void propose()} disabled={loading || !factText.trim()} className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: colors.accent, color: '#fff' }}>创建候选</button>
          </div>
          {error && <div className="text-[11px]" style={{ color: '#ef4444' }}>{error}</div>}
        </div>
        <div className="px-3 py-2 flex flex-wrap gap-2 items-center" style={{ borderBottom: `1px solid ${colors.border}` }}>
          {([['INBOX', `待确认 (${inbox.length})`], ['ACTIVE', '已启用'], ['ALL', '全部记录'], ['GRAPH', '关系图谱']] as const).map(([key, label]) =>
            <button key={key} onClick={() => setView(key)} className="text-[11px] px-2 py-1 rounded"
                    style={{ color: view === key ? '#fff' : colors.textDim, backgroundColor: view === key ? colors.accent : colors.bgSecondary }}>{label}</button>)}
          {view === 'INBOX' && inbox.length > 0 && <>
            <button onClick={toggleAllInbox} className="ml-auto text-[11px]" style={{ color: colors.accent }}>{selected.size === inbox.length ? '取消全选' : '全选'}</button>
            <button onClick={() => void batch('CONFIRM')} disabled={loading || !selected.size} className="text-[11px] disabled:opacity-40" style={{ color: '#22c55e' }}>确认选中 ({selected.size})</button>
            <button onClick={() => void batch('REJECT')} disabled={loading || !selected.size} className="text-[11px] disabled:opacity-40" style={{ color: '#f59e0b' }}>拒绝选中</button>
          </>}
        </div>
        <div className="px-3 py-2 flex flex-wrap gap-2 items-center" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <span className="text-[10px]" style={{ color: colors.textDim }}>来源</span>
          {([['ALL', '全部'], ['AGENT_PROPOSAL', 'Agent'], ['DETERMINISTIC_TOOL', '工具'], ['USER_REQUEST', '手动']] as const).map(([key, label]) =>
            <button key={key} onClick={() => setOriginFilter(key)} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ color: originFilter === key ? '#fff' : colors.textDim, backgroundColor: originFilter === key ? colors.accent : colors.bgSecondary }}>{label}</button>)}
          <span className="ml-1 text-[10px]" style={{ color: colors.textDim }}>时效</span>
          {([['ALL', '全部'], ['VALID', '有效'], ['EXPIRED', '已过期']] as const).map(([key, label]) =>
            <button key={key} onClick={() => setExpiryFilter(key)} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ color: expiryFilter === key ? '#fff' : colors.textDim, backgroundColor: expiryFilter === key ? colors.accent : colors.bgSecondary }}>{label}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {view === 'GRAPH' ? <>
            <div className="text-[10px]" style={{ color: colors.textDim }}>仅显示当前筛选结果中已有证据支撑的关系边；点击节点查看详情。{visible.length > 24 ? ' 当前仅展示前 24 个节点。' : ''}</div>
            {graphNodes.length ? <MemoryRelationGraph nodes={graphNodes} edges={graphEdges} selectedId={selectedGraphNodeId}
              onSelect={setSelectedGraphNodeId} colors={colors} /> : <div className="p-6 text-center text-xs" style={{ color: colors.textDim }}>没有可展示的记忆节点。</div>}
            {graphNodes.length > 0 && graphEdges.length === 0 && <div className="text-[11px]" style={{ color: colors.textDim }}>尚无带证据的关系边。可在两条同作用域的已启用记忆之间建立替代关系。</div>}
            {graphEdges.length > 0 && <div className="p-3 rounded-lg" style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              <div className="text-[11px] font-medium" style={{ color: colors.text }}>已验证关系 ({graphEdges.length})</div>
              <div className="mt-2 space-y-1">
                {graphEdges.map(edge => {
                  const from = graphNodes.find(item => item.memoryId === edge.fromMemoryId)
                  const to = graphNodes.find(item => item.memoryId === edge.toMemoryId)
                  const evidence = from?.evidence?.find(item => item.evidenceId === edge.sourceEvidenceId)
                  return <button key={edge.relationId} onClick={() => setSelectedGraphNodeId(edge.fromMemoryId)}
                    className="w-full text-left rounded px-2 py-1 text-[10px]" style={{ color: colors.text, backgroundColor: colors.bgPrimary }}>
                    <span>{from?.factText.slice(0, 28) || '未知节点'} → {to?.factText.slice(0, 28) || '未知节点'}</span>
                    <span className="ml-1" style={{ color: colors.textDim }}>· {evidence?.evidenceType || '已验证凭据'}{evidence?.summary ? `：${evidence.summary}` : ''}</span>
                  </button>
                })}
              </div>
            </div>}
            {selectedGraphNode && <div className="p-3 rounded-lg text-xs" aria-live="polite" style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, color: colors.text }}>
              <div className="font-medium">{selectedGraphNode.factText}</div>
              <div className="mt-1 text-[10px]" style={{ color: colors.textDim }}>来源：{sourceLabel(selectedGraphNode)} · 使用 {selectedGraphNode.usageCount || 0} 次</div>
              {selectedGraphNode.evidence?.length ? <div className="mt-1 text-[10px]" style={{ color: colors.textDim }}>凭据：{selectedGraphNode.evidence.map(item => item.evidenceType).join('、')}</div> : null}
            </div>}
          </> : <>
          {loading && memories.length === 0 ? <div className="p-6 text-center text-xs" style={{ color: colors.textDim }}>加载中…</div> : null}
          {!loading && visible.length === 0 ? <div className="p-6 text-center text-xs" style={{ color: colors.textDim }}>{view === 'INBOX' ? '收件箱为空。完成受控验证后，Agent 的建议会出现在这里。' : '没有符合条件的记忆。'}</div> : null}
          {visible.map(memory => <div key={memory.memoryId} className="p-3 rounded-lg" style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2">
              {memory.status === 'PENDING' && <input type="checkbox" checked={selected.has(memory.memoryId)} onChange={() => toggle(memory.memoryId)} aria-label="选择候选" />}
              <span className="text-[10px] font-semibold" style={{ color: colors.accent }}>{SCOPE_LABEL[memory.scope]}</span>
              <span className="text-[10px]" style={{ color: memory.status === 'ACTIVE' ? '#22c55e' : '#f59e0b' }}>{memory.status}</span>
              <span className="text-[10px]" style={{ color: colors.textDim }}>{ORIGIN_LABEL[memory.proposalOrigin || 'USER_REQUEST']}</span>
            </div>
            {editingId === memory.memoryId ? <textarea value={editingText} onChange={event => setEditingText(event.target.value)} maxLength={1000}
              className="mt-2 w-full min-h-16 p-2 rounded text-xs outline-none resize-y" style={{ color: colors.text, backgroundColor: colors.bgPrimary, border: `1px solid ${colors.border}` }} /> :
              <div className="mt-1.5 text-xs whitespace-pre-wrap" style={{ color: colors.text }}>{memory.factText}</div>}
            <div className="mt-1.5 text-[10px] space-y-0.5" style={{ color: colors.textDim }}>
              {memory.candidateRationale && <div>建议理由：{memory.candidateRationale}</div>}
              <div>来源：{sourceLabel(memory)}{memory.candidateConfidence != null ? ` · 建议置信度 ${memory.candidateConfidence}%` : ''}</div>
              <div>使用：{memory.usageCount || 0} 次{memory.lastUsedAt ? ` · 最近 ${new Date(memory.lastUsedAt).toLocaleString()}` : ''}</div>
              {memory.expiresAt && <div>有效期至：{new Date(memory.expiresAt).toLocaleString()}</div>}
              {memory.expired && <div style={{ color: '#f59e0b' }}>此工具验证记忆已过期，不会再注入对话。</div>}
              {(memory.supersedesMemoryIds?.length || memory.supersededByMemoryIds?.length) ? <div>关系：
                {memory.supersedesMemoryIds?.map(id => `替代 #${id.slice(0, 12)}`).join('；')}
                {memory.supersededByMemoryIds?.map(id => `被 #${id.slice(0, 12)} 替代`).join('；')}
              </div> : null}
              {memory.evidence?.length ? <div>凭据：{memory.evidence.map(item =>
                `${item.evidenceType}${item.summary ? `（${item.summary}）` : ''}`).join('；')}</div> : null}
            </div>
            <div className="mt-2 flex gap-3">
              {editingId === memory.memoryId ? <><button onClick={() => void saveEdit(memory.memoryId)} disabled={actionId === memory.memoryId} className="text-[11px]" style={{ color: '#22c55e' }}>保存修改</button>
                <button onClick={() => { setEditingId(null); setEditingText('') }} className="text-[11px]" style={{ color: colors.textDim }}>取消</button></> : <>
                {memory.status === 'PENDING' && <><button onClick={() => void act(memory.memoryId, 'confirm')} disabled={actionId === memory.memoryId} className="text-[11px]" style={{ color: '#22c55e' }}>确认并启用</button>
                  <button onClick={() => { setEditingId(memory.memoryId); setEditingText(memory.factText) }} className="text-[11px]" style={{ color: colors.accent }}>编辑</button>
                  <button onClick={() => void act(memory.memoryId, 'reject')} disabled={actionId === memory.memoryId} className="text-[11px]" style={{ color: '#f59e0b' }}>拒绝</button></>}
                <button onClick={() => { if (window.confirm('确定删除此记忆吗？删除后不会再注入对话。')) void act(memory.memoryId, 'delete') }} disabled={actionId === memory.memoryId} className="text-[11px]" style={{ color: '#ef4444' }}>删除</button>
              </>}
            </div>
            {memory.status === 'ACTIVE' && !memory.expired && memories.some(item => item.status === 'ACTIVE' && item.memoryId !== memory.memoryId && item.scope === memory.scope) &&
              <div className="mt-2 flex gap-2 items-center"><select value={supersedeTargets[memory.memoryId] || ''}
                onChange={event => setSupersedeTargets(previous => ({ ...previous, [memory.memoryId]: event.target.value }))}
                className="max-w-56 text-[10px] rounded px-1.5 py-1" style={{ color: colors.text, backgroundColor: colors.bgPrimary, border: `1px solid ${colors.border}` }}>
                <option value="">选择要替代的已启用记忆…</option>
                {memories.filter(item => item.status === 'ACTIVE' && item.memoryId !== memory.memoryId && item.scope === memory.scope).map(item =>
                  <option key={item.memoryId} value={item.memoryId}>{item.factText.slice(0, 42)}</option>)}
              </select><button onClick={() => void supersede(memory.memoryId)} disabled={actionId === memory.memoryId}
                className="text-[11px]" style={{ color: '#f59e0b' }}>替代所选</button></div>}
          </div>)}
          </>}
        </div>
      </div>
    </div>
  )
}
