import './index.css'
import { MainView } from './views/MainView'
import { useEffect } from 'react'
import { useConnectionStore } from './stores/connectionStore'
import { useLocalFileStore } from './stores/localFileStore'
import { ConnectionStatus } from './types'
import { ErrorBoundary } from './components/ErrorBoundary'

function App() {
  const { startHeartbeat, stopHeartbeat, connections, disconnect } = useConnectionStore()

  // 恢复上次打开的本地文件夹
  const restoreLocalFolder = useLocalFileStore((s) => s.restoreFolder)

  useEffect(() => {
    // 应用启动时：重置所有连接状态为断开（防止后端状态不同步）
    useConnectionStore.setState((state) => ({
      connections: state.connections.map((c) => ({ ...c, status: ConnectionStatus.DISCONNECTED })),
    }))
    // 开启心跳检测
    startHeartbeat()
    // 恢复本地文件夹（静默恢复，不弹对话框）
    void restoreLocalFolder()
    return () => stopHeartbeat()
  }, [startHeartbeat, stopHeartbeat, restoreLocalFolder])

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

  return (
    <ErrorBoundary>
      <MainView />
    </ErrorBoundary>
  )
}

export default App
