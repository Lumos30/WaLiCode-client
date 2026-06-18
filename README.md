# walissh-client ai shell 智能终端

**启动脚本** 

- mac：`walissh-client/docs/dev-ops/start-dev.sh`
- windows：`walissh-client/docs/dev-ops/start-dev.bat`

>注意，先启动服务端 walissh-server。把 ssh 的操作操作，ai的操作，统一放到服务端，可以更有效的统一控制风险（企业中最为常见的做法）。如果都在客户端，可能会有人误操作执行危险命令，或者把核心服务器信息泄露。