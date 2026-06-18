/**
 * SSH 常用命令分类数据
 */

export interface CommandItem {
  command: string
  description: string
}

export interface CommandCategory {
  name: string
  emoji: string
  commands: CommandItem[]
}

export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    name: '文件和目录操作',
    emoji: '📁',
    commands: [
      { command: 'ls -la', description: '显示所有文件（包括隐藏文件）的详细信息' },
      { command: 'pwd', description: '显示当前工作目录的完整路径' },
      { command: 'cd /home', description: '切换到 /home 目录' },
      { command: 'mkdir test', description: '创建名为 test 的目录' },
      { command: 'rmdir test', description: '删除空目录 test' },
      { command: 'cp source dest', description: '复制文件从 source 到 dest' },
      { command: 'mv old new', description: '移动或重命名文件 old 为 new' },
      { command: 'rm -rf test', description: '强制递归删除目录 test（谨慎使用！）' },
      { command: 'find / -name "*.log"', description: '从根目录开始查找所有 .log 文件' },
      { command: 'locate filename', description: '快速定位文件名（使用数据库）' },
    ],
  },
  {
    name: '文件内容操作',
    emoji: '📄',
    commands: [
      { command: 'cat filename', description: '显示文件的全部内容' },
      { command: 'less filename', description: '分页查看文件内容（支持前后翻页）' },
      { command: 'head -n 20 filename', description: '显示文件前 20 行' },
      { command: 'tail -f filename', description: '实时追踪文件末尾内容变化' },
      { command: 'grep "pattern" filename', description: '在文件中搜索匹配的行' },
      { command: 'wc -l filename', description: '统计文件的行数' },
      { command: 'sort filename', description: '对文件内容进行排序' },
      { command: 'uniq filename', description: '去除文件中连续的重复行' },
    ],
  },
  {
    name: '系统信息',
    emoji: '⚙️',
    commands: [
      { command: 'ps aux', description: '显示所有运行中的进程详细信息' },
      { command: 'top', description: '实时显示系统进程和资源使用情况' },
      { command: 'htop', description: 'top 命令的增强版（更友好的界面）' },
      { command: 'df -h', description: '显示磁盘使用情况（人类可读格式）' },
      { command: 'free -m', description: '显示内存使用情况（以 MB 为单位）' },
      { command: 'uptime', description: '显示系统运行时间和平均负载' },
      { command: 'uname -a', description: '显示系统内核信息' },
      { command: 'lscpu', description: '显示 CPU 架构信息' },
      { command: 'lsblk', description: '列出块设备信息' },
    ],
  },
  {
    name: '用户和权限',
    emoji: '👤',
    commands: [
      { command: 'whoami', description: '显示当前登录用户名' },
      { command: 'id', description: '显示当前用户的 UID、GID 和所属组' },
      { command: 'who', description: '显示当前登录的用户' },
      { command: 'w', description: '显示谁登录了以及在做什么' },
      { command: 'chmod 755 filename', description: '设置文件权限为 755（rwxr-xr-x）' },
      { command: 'chmod +x script.sh', description: '给脚本添加可执行权限' },
      { command: 'chmod 644 filename', description: '设置文件权限为 644（rw-r--r--）' },
      { command: 'chmod -R 755 dir/', description: '递归设置目录及其所有内容权限' },
      { command: 'chown user:group file', description: '修改文件所有者和所属组' },
      { command: 'su - username', description: '切换到指定用户（带环境变量）' },
      { command: 'sudo command', description: '以超级用户权限执行命令' },
    ],
  },
  {
    name: '网络和服务',
    emoji: '🌐',
    commands: [
      { command: 'ping -c 4 host', description: '发送 4 个 ICMP 包测试网络连通性' },
      { command: 'wget url', description: '下载 URL 指向的文件' },
      { command: 'curl -s url', description: '静默模式获取 URL 内容' },
      { command: 'netstat -tuln', description: '显示所有监听的 TCP/UDP 端口' },
      { command: 'ss -tuln', description: 'netstat 的替代品，更快速显示网络状态' },
      { command: 'systemctl status service', description: '查看 systemd 服务状态' },
      { command: 'systemctl start service', description: '启动 systemd 服务' },
      { command: 'systemctl restart service', description: '重启 systemd 服务' },
      { command: 'iptables -L', description: '列出防火墙规则' },
    ],
  },
  {
    name: '系统管理',
    emoji: '🔧',
    commands: [
      { command: 'yum update', description: '更新所有已安装的包（RHEL/CentOS）' },
      { command: 'yum install package', description: '安装指定的软件包' },
      { command: 'rpm -qa | grep package', description: '查询已安装的 RPM 包' },
      { command: 'crontab -l', description: '列出当前用户的定时任务' },
      { command: 'crontab -e', description: '编辑当前用户的定时任务' },
      { command: 'mount', description: '列出所有已挂载的文件系统' },
      { command: 'umount /dev/sda1', description: '卸载指定的文件系统' },
      { command: 'history', description: '显示命令历史记录' },
      { command: 'clear', description: '清屏' },
    ],
  },
  {
    name: 'Git 版本控制',
    emoji: '📦',
    commands: [
      { command: 'git clone url', description: '克隆远程仓库到本地' },
      { command: 'git status', description: '查看工作区状态' },
      { command: 'git add .', description: '添加所有文件到暂存区' },
      { command: 'git commit -m "message"', description: '提交暂存区到本地仓库' },
      { command: 'git push', description: '推送到远程仓库' },
      { command: 'git pull', description: '从远程仓库拉取更新' },
      { command: 'git checkout branch', description: '切换到指定分支' },
      { command: 'git branch', description: '列出所有分支' },
      { command: 'git log --oneline -10', description: '以单行格式显示最近 10 条提交' },
      { command: 'git reset --hard commit', description: '强制重置到指定提交（慎用！）' },
    ],
  },
  {
    name: 'Docker 容器',
    emoji: '🐳',
    commands: [
      { command: 'docker ps', description: '列出正在运行的容器' },
      { command: 'docker ps -a', description: '列出所有容器（包括已停止的）' },
      { command: 'docker images', description: '列出本地镜像' },
      { command: 'docker run -it image /bin/bash', description: '以交互模式运行容器' },
      { command: 'docker stop container', description: '停止运行中的容器' },
      { command: 'docker start container', description: '启动已停止的容器' },
      { command: 'docker exec -it container /bin/bash', description: '在运行中的容器内执行命令' },
      { command: 'docker build -t tag .', description: '构建 Docker 镜像' },
      { command: 'docker rm container', description: '删除容器' },
      { command: 'docker rmi image', description: '删除镜像' },
    ],
  },
  {
    name: 'Maven 构建',
    emoji: '☕',
    commands: [
      { command: 'mvn clean install', description: '清理并安装项目到本地仓库' },
      { command: 'mvn clean compile', description: '清理并编译项目' },
      { command: 'mvn test', description: '运行测试' },
      { command: 'mvn package', description: '打包项目' },
      { command: 'mvn clean', description: '清理构建产物' },
      { command: 'mvn dependency:tree', description: '显示依赖树' },
      { command: 'mvn spring-boot:run', description: '运行 Spring Boot 应用' },
      { command: 'mvn archetype:generate', description: '从原型生成项目' },
    ],
  },
  {
    name: '其他常用',
    emoji: '🔍',
    commands: [
      { command: 'date', description: '显示当前日期和时间' },
      { command: 'cal', description: '显示本月日历' },
      { command: 'cal 2026', description: '显示 2026 年全年日历' },
      { command: 'which command', description: '查找命令的可执行文件路径' },
      { command: 'whereis command', description: '查找命令的二进制、源码和手册页' },
      { command: 'man command', description: '查看命令的手册页' },
      { command: 'command --help', description: '查看命令的帮助信息' },
      { command: 'exit', description: '退出当前 shell' },
    ],
  },
]

/**
 * 获取所有命令的平铺列表
 */
export function getAllCommands(): CommandItem[] {
  return COMMAND_CATEGORIES.flatMap((cat) => cat.commands)
}