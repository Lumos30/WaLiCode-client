import type { AgentMemoryDTO, AgentMemoryRelationDTO } from '../api/agent'

interface MemoryRelationGraphProps {
  nodes: AgentMemoryDTO[]
  edges: AgentMemoryRelationDTO[]
  selectedId: string | null
  onSelect: (memoryId: string) => void
  colors: { text: string; textDim: string; bgPrimary: string; bgSecondary: string; border: string; accent: string }
}

const WIDTH = 640
const HEIGHT = 330

function position(index: number, total: number) {
  if (total <= 1) return { x: WIDTH / 2, y: HEIGHT / 2 }
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total
  const radius = Math.min(118, 44 + total * 5)
  return { x: WIDTH / 2 + Math.cos(angle) * radius * 1.85, y: HEIGHT / 2 + Math.sin(angle) * radius }
}

function label(memory: AgentMemoryDTO) {
  const normalized = memory.factText.replace(/\s+/g, ' ').trim()
  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized
}

/** Read-only relationship map. Only pre-existing, evidence-backed edges are supplied by the parent. */
export function MemoryRelationGraph({ nodes, edges, selectedId, onSelect, colors }: MemoryRelationGraphProps) {
  const positions = new Map(nodes.map((node, index) => [node.memoryId, position(index, nodes.length)]))
  return <div className="rounded-lg overflow-hidden" style={{ backgroundColor: colors.bgPrimary, border: `1px solid ${colors.border}` }}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full min-h-[260px]" role="group" aria-label="只读记忆关系图谱，可使用 Tab 键选择记忆节点">
      <title>只读记忆关系图谱</title>
      <defs><marker id="memory-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={colors.accent} /></marker></defs>
      {edges.map(edge => {
        const from = positions.get(edge.fromMemoryId)
        const to = positions.get(edge.toMemoryId)
        if (!from || !to) return null
        return <g key={edge.relationId}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={colors.accent} strokeWidth="1.5" opacity="0.7" markerEnd="url(#memory-graph-arrow)" />
          <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} textAnchor="middle" fontSize="9" fill={colors.textDim}>{edge.relationType === 'SUPERSEDES' ? '替代' : edge.relationType}</text>
        </g>
      })}
      {nodes.map(node => {
        const point = positions.get(node.memoryId)!
        const active = selectedId === node.memoryId
        const fill = node.status === 'ACTIVE' ? colors.bgSecondary : '#4b5563'
        return <g key={node.memoryId} onClick={() => onSelect(node.memoryId)} className="cursor-pointer" role="button" tabIndex={0}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.memoryId) } }}>
          <rect x={point.x - 70} y={point.y - 19} width="140" height="38" rx="8" fill={fill} stroke={active ? colors.accent : colors.border} strokeWidth={active ? 2 : 1} />
          <text x={point.x} y={point.y - 2} textAnchor="middle" fontSize="10" fill={colors.text}>{label(node)}</text>
          <text x={point.x} y={point.y + 11} textAnchor="middle" fontSize="8" fill={colors.textDim}>{node.status} · {node.scope}</text>
        </g>
      })}
    </svg>
  </div>
}
