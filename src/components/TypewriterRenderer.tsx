/**
 * TypewriterRenderer — 流式打字机效果渲染器
 *
 * P0-1: 对标 WaLiCode-Android 的即时反馈感
 *
 * 机制：
 * - 后端 SSE onText 推送累积全文 → fullText
 * - 段落级渐进渲染：按 \n\n 分段，逐段追赶显示
 * - 每段内逐字输出（模拟人类写作节奏）
 * - 段间停顿（模拟思考间隙）
 * - 渲染完成后回调 onRenderComplete
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { useThemeStore } from '../stores/themeStore'

interface TypewriterRendererProps {
  /** 后端推送的累积全文 */
  fullText: string
  /** 是否仍在加载（流式输出中） */
  isLoading: boolean
  /** 渲染完成回调 */
  onRenderComplete?: () => void
  /** 自定义渲染函数（如 Markdown 渲染） */
  renderContent?: (text: string) => React.ReactNode
  /** 每帧最大字符数（段落内逐字速度） */
  maxCharsPerFrame?: number
}

export function TypewriterRenderer({
  fullText,
  isLoading,
  onRenderComplete,
  renderContent,
  maxCharsPerFrame = 6,
}: TypewriterRendererProps) {
  const { colors } = useThemeStore()
  
  // 当前已渲染到的字符位置
  const [displayLen, setDisplayLen] = useState(0)
  const rafRef = useRef<number | null>(null)
  const fullTextRef = useRef('')
  const displayLenRef = useRef(0)
  const completedRef = useRef(false)
  // 段落边界缓存：加速段落查找
  const paragraphBoundsRef = useRef<number[]>([])

  // 更新目标文本
  useEffect(() => {
    fullTextRef.current = fullText
    // 预计算段落边界（\n\n 分隔）
    const bounds: number[] = [0]
    let searchFrom = 0
    while (true) {
      const idx = fullText.indexOf('\n\n', searchFrom)
      if (idx === -1) break
      bounds.push(idx + 2) // 段落起始位置（含分隔符）
      searchFrom = idx + 2
    }
    bounds.push(fullText.length)
    paragraphBoundsRef.current = bounds
  }, [fullText])

  // 找到当前显示位置所在段落，返回该段落结束位置
  const getCurrentParagraphEnd = useCallback((pos: number): number => {
    const bounds = paragraphBoundsRef.current
    for (let i = 0; i < bounds.length; i++) {
      if (bounds[i] > pos) return bounds[i]
    }
    return bounds[bounds.length - 1] || pos
  }, [])

  // requestAnimationFrame 驱动的逐字追赶
  const tick = useCallback(() => {
    const target = fullTextRef.current
    const currentLen = displayLenRef.current

    if (currentLen >= target.length) {
      // 已追上
      if (!isLoading && !completedRef.current) {
        completedRef.current = true
        onRenderComplete?.()
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    const remaining = target.length - currentLen
    
    // 段落级策略：
    // - 如果当前在段落中间 → 正常速度逐字
    // - 如果刚进入新段落 → 稍微加速冲过空行（视觉上快速开始新段）
    // - 距离段落结尾近时 → 正常速度收尾
    const paraEnd = getCurrentParagraphEnd(currentLen)
    const distToParaEnd = paraEnd - currentLen
    
    let speed: number
    if (distToParaEnd <= 4 && distToParaEnd > 0) {
      // 接近段落尾：慢速收尾
      speed = Math.min(2, remaining)
    } else if (remaining < 30) {
      // 剩余不多：慢速收尾
      speed = Math.min(2, remaining)
    } else {
      // 段落中/新段落开始：自适应速度
      speed = Math.min(maxCharsPerFrame, Math.ceil(remaining / 25))
    }

    const newLen = Math.min(currentLen + speed, target.length)
    setDisplayLen(newLen)
    displayLenRef.current = newLen
    completedRef.current = false

    rafRef.current = requestAnimationFrame(tick)
  }, [isLoading, maxCharsPerFrame, onRenderComplete, getCurrentParagraphEnd])

  // 启动/停止动画循环
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  // 流结束后确保完整渲染
  useEffect(() => {
    if (!isLoading && fullText) {
      const timer = setTimeout(() => {
        if (displayLenRef.current < fullText.length) {
          setDisplayLen(fullText.length)
          displayLenRef.current = fullText.length
        }
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isLoading, fullText])

  /**
   * Markdown 标记感知截取：避免在 Markdown 标记对中间截断。
   *
   * 核心策略：
   * 1. 统计截断文本中各标记的平衡状态
   * 2. 发现未闭合标记 → 延伸到闭合处或回退到开标记之前
   * 3. 长标记（**、__、~~）与短标记（*、_）共用字符，
   *    需先处理长标记并记录占用位置，短标记扫描时跳过这些位置
   * 4. 支持跨边界闭合（如 truncated='...*' + remaining='*...' 组成 **）
   */
  const getSafeDisplayLen = useCallback((text: string, len: number): number => {
    if (len >= text.length) return len
    const truncated = text.substring(0, len)
    const remaining = text.substring(len)

    // --- 步骤1：长标记检测（**、__、~~）---
    // 返回 { count, positions, closeIdx, hasCrossBoundaryOpen } — count 为截断文本中的标记数
    // hasCrossBoundaryOpen: 截断末尾+remaining开头组成了开标记（如 truncated='...*' + remaining='*...'）
    const detectLong = (open: string): { count: number; positions: number[]; closeIdx: number; hasCrossBoundaryOpen: boolean } => {
      let count = 0
      const positions: number[] = []
      let i = 0
      let inCodeBlock = false
      while (i <= truncated.length - open.length) {
        if (truncated.substring(i, i + 3) === '```') { inCodeBlock = !inCodeBlock; i += 3; continue }
        if (inCodeBlock) { i++; continue }
        if (truncated[i] === '`') {
          const ci = truncated.indexOf('`', i + 1)
          i = ci === -1 ? truncated.length : ci + 1; continue
        }
        if (truncated.substring(i, i + open.length) === open) {
          count++; positions.push(i); i += open.length
        } else { i++ }
      }
      // 开标记跨边界：truncated 末尾的部分 + remaining 开头组成完整的开标记
      let hasCrossBoundaryOpen = false
      const openPrefix = open.substring(0, open.length - 1)
      if (truncated.endsWith(openPrefix) && remaining.length > 0 && remaining[0] === open[open.length - 1]) {
        hasCrossBoundaryOpen = true
      }
      // 在 remaining 中找闭合（含跨边界）
      let closeIdx = remaining.indexOf(open)
      if (closeIdx === -1 && remaining.length > 0) {
        const closePrefix = open.substring(0, open.length - 1)
        if (truncated.endsWith(closePrefix) && remaining[0] === open[open.length - 1]) closeIdx = 0
      }
      return { count, positions, closeIdx, hasCrossBoundaryOpen }
    }

    // --- 步骤2：构建已被长标记占用的位置集合 ---
    const occupied = new Set<number>()
    const longDefs = [{ open: '**' }, { open: '__' }, { open: '~~' }]
    const longResults = new Map<string, { count: number; positions: number[]; closeIdx: number; hasCrossBoundaryOpen: boolean }>()

    for (const def of longDefs) {
      const result = detectLong(def.open)
      longResults.set(def.open, result)
      // 完整长标记的位置
      for (const p of result.positions) {
        for (let c = p; c < p + def.open.length; c++) occupied.add(c)
      }
      // 跨边界长标记前缀（truncated 末尾的部分 + remaining 开头组成完整标记）
      const prefix = def.open.substring(0, def.open.length - 1)
      if (truncated.endsWith(prefix) && remaining.length > 0 && remaining[0] === def.open[def.open.length - 1]) {
        for (let c = truncated.length - prefix.length; c < truncated.length; c++) occupied.add(c)
      }
    }

    // --- 步骤3：计算 safeLen ---
    let safeLen = len

    // 3a. 处理长标记
    for (const def of longDefs) {
      const result = longResults.get(def.open)!
      // 判断跨边界标记的角色：
      // - 截断中已有奇数个标记 → 跨边界是闭合标记（closeIdx 已检测）
      // - 截断中已有偶数个标记 → 跨边界是开标记（需延伸到闭合处或回退）
      const isCrossBoundaryOpen = result.count % 2 === 0 && result.hasCrossBoundaryOpen
      const effectiveOdd = (result.count % 2 !== 0) !== isCrossBoundaryOpen

      if (effectiveOdd) {
        if (result.closeIdx !== -1) {
          safeLen = Math.max(safeLen, len + result.closeIdx + def.open.length)
        } else {
          const lastPos = result.positions[result.positions.length - 1]
          if (lastPos !== undefined) safeLen = Math.min(safeLen, lastPos)
          else if (isCrossBoundaryOpen) {
            const openPrefix = def.open.substring(0, def.open.length - 1)
            const prefixPos = truncated.lastIndexOf(openPrefix)
            if (prefixPos >= 0) safeLen = Math.min(safeLen, prefixPos)
          }
        }
      }
    }

    // 3b. 处理短标记（*、_、`），跳过已被长标记占用的位置
    const shortDefs = [{ open: '*', close: '*' }, { open: '_', close: '_' }, { open: '`', close: '`' }]
    for (const def of shortDefs) {
      const skipOccupied = def.open === '*' || def.open === '_'
      let count = 0
      const positions: number[] = []
      let i = 0
      let inCodeBlock = false

      while (i < truncated.length) {
        if (truncated.substring(i, i + 3) === '```') { inCodeBlock = !inCodeBlock; i += 3; continue }
        if (inCodeBlock) { i++; continue }
        if (def.open !== '`' && truncated[i] === '`') {
          const ci = truncated.indexOf('`', i + 1)
          i = ci === -1 ? truncated.length : ci + 1; continue
        }
        if (skipOccupied && occupied.has(i)) { i++; continue }
        if (truncated[i] === def.open) {
          count++; positions.push(i); i++
        } else { i++ }
      }

      if (count % 2 !== 0) {
        let closeIdx = remaining.indexOf(def.close)
        // 短标记闭合搜索时跳过属于长标记的位置
        if (skipOccupied) {
          while (closeIdx !== -1) {
            const isPartOfLonger = closeIdx === 0 && truncated.endsWith(def.open)
            const isStartOfLongerClose = closeIdx + 1 < remaining.length && remaining[closeIdx + 1] === def.open
            if (!isPartOfLonger && !isStartOfLongerClose) break
            closeIdx = remaining.indexOf(def.close, closeIdx + 1)
          }
        }
        if (closeIdx !== -1) {
          safeLen = Math.max(safeLen, len + closeIdx + def.close.length)
        } else {
          const lastPos = positions[positions.length - 1]
          if (lastPos !== undefined && lastPos >= 0) safeLen = Math.min(safeLen, lastPos)
        }
      }
    }

    return Math.min(safeLen, text.length)
  }, [])

  // 渲染内容
  const rawDisplayLen = displayLen
  const safeLen = getSafeDisplayLen(fullTextRef.current, rawDisplayLen)
  const displayText = fullTextRef.current.substring(0, safeLen)
  const content = renderContent ? renderContent(displayText) : (
    <div
      className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
      style={{ color: colors.text }}
      dangerouslySetInnerHTML={{ __html: displayText }}
    />
  )

  return (
    <div className="relative">
      {content}
      {/* 光标：流式输出中且未完成时显示 */}
      {isLoading && safeLen < (fullTextRef.current?.length || 0) && (
        <span
          className="inline-block w-0.5 h-3.5 ml-0.5 animate-pulse"
          style={{ backgroundColor: colors.accent, verticalAlign: 'text-bottom' }}
        />
      )}
    </div>
  )
}
