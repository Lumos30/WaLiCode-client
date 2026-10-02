# WaLiSSH 开发环境部署

## 快速启动

根据你的操作系统，双击或运行对应的脚本：

| 操作系统 | 脚本 | 命令 |
|---------|------|------|
| macOS / Linux | `start-dev.sh` | `./start-dev.sh` |
| Windows | `start-dev.bat` | 双击或 `start-dev.bat` |

## 前置要求

确保已安装以下依赖：

### 1. Node.js 22+
- macOS/Linux: [https://nodejs.org/](https://nodejs.org/)
- Windows: 使用 [nvm-windows](https://github.com/coreybutler/nvm-windows) 或官网下载

### 2. Rust
```bash
# macOS / Linux / WSL
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows: 从 https://rustup.rs 下载安装
```

### 3. Windows Tauri 前置条件

- 安装 **Visual Studio Build Tools 2022**，并勾选“使用 C++ 的桌面开发”（MSVC v143 和 Windows SDK）。
- 安装 **Microsoft Edge WebView2 Runtime**。
- 在 PowerShell 执行 `rustup default stable-msvc`，然后以 `rustc -Vv` 确认 host 为 `x86_64-pc-windows-msvc`。

### 4. Tauri CLI（项目已声明为开发依赖）
```bash
npm install -D @tauri-apps/cli
```

## 脚本功能

1. **环境检查** - 检测 Node.js、npm、Rust 是否已安装
2. **目录检查** - 自动切换到客户端根目录，并验证 `package.json` 存在
3. **依赖安装** - 首次启动时使用锁文件执行 `npm ci`
4. **启动开发服务器** - 运行 `npm run tauri dev`，失败时返回非零退出码

## 常见问题

**Q: 脚本没有执行权限？**
```bash
chmod +x start-dev.sh
```

**Q: Windows 下提示 "不是内部或外部命令"？**
确保在 Windows Terminal 或 CMD 中运行脚本。

**Q: Rust 编译提示找不到链接器或 Windows SDK？**
安装 Visual Studio Build Tools 的“使用 C++ 的桌面开发”工作负载后，重新打开终端；不要使用 GNU Rust 工具链。

**Q: WebView2 相关启动失败？**
安装或修复 Microsoft Edge WebView2 Runtime，然后重新运行 `npm run tauri dev`。

**Q: Rust 安装慢？**
使用国内镜像：
```bash
export RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static
export RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
curl --proto '=https' --tlsv1.2 -sSf https://mirrors.ustc.edu.cn/rust-static/rustup-init.sh | sh
```
