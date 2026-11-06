# 安装：预览（示例数据）

这份指南写给执行安装的 agent，人也可以照着做。

| 项 | 内容 |
| --- | --- |
| 目标 | 用内置的示例数据在本机打开控制台 |
| 前置 | Node.js 24+、pnpm、git |
| 不需要 | dsh-superagent、DSH、GitHub 账号、模型 |
| 改动 | 只在 `~/src/dsh-superagent-ui` 和 `~/.dsh-superagent-ui` 里写文件 |

## 执行规则

1. 按顺序执行。每个代码块都能单独运行，不依赖上一个代码块留下的 shell 状态。
2. 缺工具时，先把要安装的内容告诉操作者，得到同意再安装。
3. 带 token 的控制台链接只发给操作者，不要写进文件、日志或工单。

## 步骤

### 1. 检查工具

```bash
node -v; pnpm -v; git --version
```

通过条件：Node.js 是 24 或更高。pnpm 可以是任意版本，仓库固定了 10.18.3，运行时会自动切换。

- 缺 pnpm：`npm install -g pnpm`。
- 缺 Node.js 24：让操作者用自己习惯的版本管理工具安装。

### 2. 获取代码并安装依赖

```bash
[ -d "$HOME/src/dsh-superagent-ui/.git" ] || git clone --recurse-submodules https://github.com/hustnn/dsh-superagent-ui.git "$HOME/src/dsh-superagent-ui"
cd "$HOME/src/dsh-superagent-ui" && pnpm install
```

提示 `Ignored build scripts: esbuild` 是正常的，不用处理。

### 3. 启动

这是常驻进程，放在后台运行：

```bash
cd "$HOME/src/dsh-superagent-ui" && pnpm dev:mock
```

通过条件：输出里有一行 `Superagent 控制台  http://127.0.0.1:5173/?token=…`。

如果报端口被占用，先确认本机是不是已经在运行控制台（BFF 默认用 3090 端口）。可以设置 `CONSOLE_PORT` 换一个 BFF 端口。

### 4. 交给操作者

把这行链接发给操作者，并说明：

- 用浏览器打开这个链接。示例数据每 20 秒推进一步，可以看到页面实时更新。
- 这里的操作只影响示例数据。
- 想用起来，把 README 里“接入 GitHub”那段提示词交给 agent。

不用时停掉这个进程就行。示例数据有单独的数据库（`~/.dsh-superagent-ui/console-mock.db`），不会混进真实数据。
