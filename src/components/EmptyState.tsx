import { useThemeStore } from '../stores/themeStore'

interface EmptyStateProps {
  onQuickAction?: (text: string) => void
}

interface CapabilityCard {
  icon: string
  title: string
  description: string
  prompt: string
}

const CAPABILITIES: CapabilityCard[] = [
  {
    icon: '🖥️',
    title: '服务器运维',
    description: '查看系统状态、管理进程、分析日志',
    prompt: '帮我查看服务器系统状态和资源使用情况',
  },
  {
    icon: '🔍',
    title: '故障排查',
    description: '诊断服务异常、分析错误日志',
    prompt: '帮我排查最近的服务异常和错误',
  },
  {
    icon: '📄',
    title: '文件管理',
    description: '浏览文件、查看配置、搜索内容',
    prompt: '列出当前目录的文件结构',
  },
  {
    icon: '🔒',
    title: '安全检查',
    description: '检查权限配置、扫描安全风险',
    prompt: '帮我做一次基础安全检查',
  },
  {
    icon: '📊',
    title: '性能分析',
    description: '分析CPU/内存/磁盘瓶颈',
    prompt: '分析当前服务器性能状况',
  },
  {
    icon: '🚀',
    title: '部署发布',
    description: '构建部署、版本回滚',
    prompt: '帮我检查最近的部署状态',
  },
  {
    icon: '🏗️',
    title: '架构分析',
    description: '分析项目结构、依赖关系、代码质量',
    prompt: '帮我分析当前项目的架构和模块依赖关系',
  },
  {
    icon: '🐛',
    title: 'Bug 修复',
    description: '定位 Bug、分析根因、生成修复方案',
    prompt: '帮我分析这段代码中的 Bug 并给出修复方案',
  },
  {
    icon: '✨',
    title: '代码生成',
    description: '生成新功能代码、补全实现、编写测试',
    prompt: '帮我生成一个 RESTful API 接口实现',
  },
  {
    icon: '📝',
    title: '代码审查',
    description: '审查代码变更、检测潜在问题、优化建议',
    prompt: '帮我审查最近的代码变更并给出优化建议',
  },
  {
    icon: '🔧',
    title: '配置管理',
    description: '管理应用配置、环境变量、CI/CD 流水线',
    prompt: '帮我检查和优化当前的配置文件',
  },
  {
    icon: '🐳',
    title: '容器化',
    description: 'Docker 镜像构建、K8s 部署、容器编排',
    prompt: '帮我为当前项目编写 Dockerfile 和部署配置',
  },
]

/**
 * 空状态引导页面。
 * 显示能力卡片 + 快速操作，帮助新用户上手。
 */
export function EmptyState({ onQuickAction }: EmptyStateProps) {
  const { colors } = useThemeStore()

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 overflow-y-auto">
      {/* Logo + 标题 */}
      <div className="flex flex-col items-center mb-6">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
          style={{ backgroundColor: `${colors.accent}15`, border: `1px solid ${colors.accent}25` }}
        >
          <span className="text-2xl">🤖</span>
        </div>
        <h2 className="text-[15px] font-semibold mb-1" style={{ color: colors.text }}>
          AI DevOps 智能助手
        </h2>
        <p className="text-[12px] text-center max-w-[280px]" style={{ color: colors.textDim }}>
          从服务器运维到代码开发，用自然语言完成全栈 DevOps 操作
        </p>
      </div>

      {/* 能力卡片网格 */}
      <div className="grid grid-cols-2 gap-2.5 w-full max-w-[480px] mb-6 max-h-[360px] overflow-y-auto pr-1">
        {CAPABILITIES.map((cap) => (
          <button
            key={cap.title}
            onClick={() => onQuickAction?.(cap.prompt)}
            className="flex items-start gap-2.5 p-3 rounded-lg text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${colors.border}60`,
            }}
          >
            <span className="text-lg leading-none mt-0.5">{cap.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium mb-0.5" style={{ color: colors.text }}>
                {cap.title}
              </div>
              <div className="text-[10px] leading-snug" style={{ color: colors.textDim }}>
                {cap.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 快捷提示 */}
      <div className="flex items-center gap-3 text-[10px]" style={{ color: colors.textDim }}>
        <span className="flex items-center gap-1">
          <kbd
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
          >
            /
          </kbd>
          命令菜单
        </span>
        <span className="flex items-center gap-1">
          <kbd
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
          >
            ?
          </kbd>
          快捷键
        </span>
        <span className="flex items-center gap-1">
          <kbd
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
          >
            @
          </kbd>
          提及
        </span>
      </div>
    </div>
  )
}
