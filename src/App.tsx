import './index.css'
import { MainView } from './views/MainView'
import { useEffect } from 'react'
import { useConnectionStore } from './stores/connectionStore'
import { ConnectionStatus } from './types'

function App() {
  const { startHeartbeat, stopHeartbeat, connections, disconnect } = useConnectionStore()

  useEffect(() => {
    // 应用启动时：重置所有连接状态为断开（防止后端状态不同步）
    useConnectionStore.setState((state) => ({
      connections: state.connections.map((c) => ({ ...c, status: ConnectionStatus.DISCONNECTED })),
    }))
    // 开启心跳检测
    startHeartbeat()
    return () => stopHeartbeat()
  }, [startHeartbeat, stopHeartbeat])

  // 应用关闭时断开所有连接
  useEffect(() => {
    const handleBeforeUnload = () => {
      connections
        .filter((c) => c.status === ConnectionStatus.CONNECTED)
        .forEach((c) => disconnect(c.id))
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [connections, disconnect])

  // 使用 MainView 启用 SSH 智能体交互功能
  return <MainView />
}

export default App
