/**
 * SSH 常用命令数据
 * 按分类组织，支持搜索和快速插入
 */

export interface CommandItem {
  /** 命令文本 */
  command: string
  /** 显示描述（可选） */
  description?: string
}

export interface CommandCategory {
  /** 分类 ID */
  id: string
  /** 分类名称 */
  name: string
  /** 分类图标 emoji */
  icon: string
  /** 分类下命令列表 */
  commands: CommandItem[]
}

export const commandCategories: CommandCategory[] = [
  {
    id: 'file-ops',
    name: '文件和目录操作',
    icon: '📁',
    commands: [
      { command: 'ls -la', description: '列出目录详细内容' },
      { command: 'pwd', description: '显示当前目录' },
      { command: 'cd /home', description: '切换到 home 目录' },
      { command: 'mkdir test', description: '创建目录' },
      { command: 'rmdir test', description: '删除空目录' },
      { command: 'cp source.txt dest.txt', description: '复制文件' },
      { command: 'mv old.txt new.txt', description: '移动/重命名文件' },
      { command: 'rm -rf test', description: '强制删除目录' },
      { command: 'find / -name "*.log"', description: '查找文件' },
      { command: 'locate filename', description: '快速定位文件' },
    ],
  },
  {
    id: 'file-content',
    name: '文件内容操作',
    icon: '📄',
    commands: [
      { command: 'cat file.txt', description: '查看文件内容' },
      { command: 'less file.txt', description: '分页查看文件' },
      { command: 'head -n 20 file.txt', description: '查看文件头部' },
      { command: 'tail -f file.log', description: '实时跟踪日志' },
      { command: 'grep "keyword" file.txt', description: '搜索关键词' },
      { command: 'wc -l file.txt', description: '统计行数' },
      { command: 'sort file.txt', description: '排序内容' },
      { command: 'uniq file.txt', description: '去重相邻行' },
    ],
  },
  {
    id: 'system-info',
    name: '系统信息',
    icon: '⚙️',
    commands: [
      { command: 'ps aux', description: '查看所有进程' },
      { command: 'top', description: '实时进程监控' },
      { command: 'htop', description: '交互式进程查看' },
      { command: 'df -h', description: '磁盘使用情况' },
      { command: 'free -m', description: '内存使用情况' },
      { command: 'uptime', description: '系统运行时间' },
      { command: 'uname -a', description: '系统信息' },
      { command: 'lscpu', description: 'CPU 信息' },
      { command: 'lsblk', description: '块设备列表' },
    ],
  },
  {
    id: 'user-permission',
    name: '用户和权限',
    icon: '👤',
    commands: [
      { command: 'whoami', description: '显示当前用户' },
      { command: 'id', description: '显示用户 ID 和组' },
      { command: 'who', description: '查看登录用户' },
      { command: 'w', description: '查看用户详情' },
      { command: 'chmod 755 file', description: '设置权限' },
      { command: 'chmod +x script.sh', description: '添加执行权限' },
      { command: 'chmod 644 file', description: '设置文件权限' },
      { command: 'chmod -R 755 dir', description: '递归设置目录权限' },
      { command: 'chown user:group file', description: '更改所有者' },
      { command: 'su - username', description: '切换用户' },
      { command: 'sudo command', description: '以管理员执行' },
    ],
  },
  {
    id: 'network',
    name: '网络和服务',
    icon: '🌐',
    commands: [
      { command: 'ping -c 4 host', description: '测试网络连通性' },
      { command: 'wget url', description: '下载文件' },
      { command: 'curl -s url', description: '请求 URL' },
      { command: 'netstat -tuln', description: '查看端口监听' },
      { command: 'ss -tuln', description: '查看网络连接' },
      { command: 'systemctl status service', description: '查看服务状态' },
      { command: 'systemctl start service', description: '启动服务' },
      { command: 'systemctl stop service', description: '停止服务' },
      { command: 'systemctl restart service', description: '重启服务' },
      { command: 'iptables -L', description: '查看防火墙规则' },
    ],
  },
  {
    id: 'system-manage',
    name: '系统管理',
    icon: '🔧',
    commands: [
      { command: 'yum update', description: '更新软件包（CentOS）' },
      { command: 'yum install package', description: '安装软件包' },
      { command: 'yum remove package', description: '卸载软件包' },
      { command: 'apt update && apt upgrade', description: '更新软件包（Debian）' },
      { command: 'apt install package', description: '安装软件包' },
      { command: 'rpm -qa | grep package', description: '查看已安装包' },
      { command: 'crontab -l', description: '查看定时任务' },
      { command: 'crontab -e', description: '编辑定时任务' },
      { command: 'mount /dev/sdb1 /mnt', description: '挂载磁盘' },
      { command: 'umount /mnt', description: '卸载磁盘' },
      { command: 'history', description: '查看命令历史' },
      { command: 'clear', description: '清屏' },
    ],
  },
  {
    id: 'git',
    name: 'Git 版本控制',
    icon: '📦',
    commands: [
      { command: 'git clone url', description: '克隆仓库' },
      { command: 'git status', description: '查看状态' },
      { command: 'git add .', description: '添加所有更改' },
      { command: 'git commit -m "message"', description: '提交更改' },
      { command: 'git push', description: '推送到远程' },
      { command: 'git pull', description: '拉取更新' },
      { command: 'git checkout branch', description: '切换分支' },
      { command: 'git branch', description: '查看分支' },
      { command: 'git log --oneline -10', description: '查看提交历史' },
      { command: 'git reset --hard HEAD~1', description: '撤销上次提交' },
      { command: 'git stash', description: '暂存更改' },
      { command: 'git stash pop', description: '恢复暂存' },
    ],
  },
  {
    id: 'docker',
    name: 'Docker 容器',
    icon: '🐳',
    commands: [
      { command: 'docker ps', description: '查看运行中容器' },
      { command: 'docker ps -a', description: '查看所有容器' },
      { command: 'docker images', description: '查看镜像列表' },
      { command: 'docker run -it image', description: '运行容器' },
      { command: 'docker stop container', description: '停止容器' },
      { command: 'docker start container', description: '启动容器' },
      { command: 'docker restart container', description: '重启容器' },
      { command: 'docker exec -it container bash', description: '进入容器' },
      { command: 'docker build -t name .', description: '构建镜像' },
      { command: 'docker rm container', description: '删除容器' },
      { command: 'docker rmi image', description: '删除镜像' },
      { command: 'docker logs -f container', description: '查看容器日志' },
    ],
  },
  {
    id: 'maven',
    name: 'Maven 构建',
    icon: '☕',
    commands: [
      { command: 'mvn clean install', description: '清理并构建' },
      { command: 'mvn clean compile', description: '清理并编译' },
      { command: 'mvn test', description: '运行测试' },
      { command: 'mvn package', description: '打包' },
      { command: 'mvn clean', description: '清理' },
      { command: 'mvn dependency:tree', description: '查看依赖树' },
      { command: 'mvn spring-boot:run', description: '运行 Spring Boot' },
      { command: 'mvn archetype:generate', description: '生成项目骨架' },
    ],
  },
  {
    id: 'other',
    name: '其他常用',
    icon: '🔍',
    commands: [
      { command: 'date', description: '显示日期时间' },
      { command: 'cal', description: '显示日历' },
      { command: 'which command', description: '查找命令位置' },
      { command: 'whereis command', description: '查找命令位置' },
      { command: 'man command', description: '查看命令手册' },
      { command: 'command --help', description: '查看帮助' },
      { command: 'exit', description: '退出当前会话' },
      { command: 'logout', description: '注销登录' },
    ],
  },
]
