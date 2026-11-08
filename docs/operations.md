中文 | [English](operations.en.md)

# 日常运行

安装好之后的启停、更新、升级和排错。安装步骤见 [`docs/install/`](install)。这里的路径都按默认位置写：控制台 `~/src/dsh-superagent-ui`，服务 `~/src/dsh-superagent`。

上游的完整说明在 [`docs/006-deployment.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md)。

## dsh-superagent

```bash
cd ~/src/dsh-superagent
scripts/dsh-superagent status      # 0 正常；1 没在运行；2 某个部分出错（重启无效）；3 等配置
scripts/dsh-superagent restart     # 会等正在干活的 worker 结束，最多 5 分钟
scripts/dsh-superagent stop
```

- **日志：** `~/src/dsh-superagent/.artifacts/dsh-superagent-superagent-*.log`。服务运行在 tmux 会话 `dsh-superagent` 里。
- **不会开机自启：** 重启电脑后要重新 `start`。
- **每小时自检：** 在你平时用的 DSH profile 里（不是 superagent），让 agent 用上游 [`docs/006-deployment.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) 里 Hourly check 那段提示词，建一个每小时运行的定时任务。服务挂了它会用 `restart` 拉起来。

## 控制台

```bash
tmux attach -t dsh-superagent-ui                  # 看输出；Ctrl-b 再按 d 退出，不会停
tmux kill-session -t dsh-superagent-ui            # 停止
cd ~/src/dsh-superagent-ui && pnpm console:url    # 打印打开用的链接
```

启动：

```bash
tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd ~/src/dsh-superagent-ui && pnpm start'
```

- **为什么带 `-e "PATH=$PATH"`：** tmux 里的命令不会读 `~/.zshrc`，而 pnpm 通常是在那里加进 PATH 的。
- **token：** 存在 `~/.dsh-superagent-ui` 里，重启不变。同一个浏览器 7 天内直接打开 `http://127.0.0.1:3090` 就行，过期了再用 `pnpm console:url` 的链接打开一次。

更新：

```bash
cd ~/src/dsh-superagent-ui && git pull && git submodule update && pnpm install && pnpm build
tmux kill-session -t dsh-superagent-ui; tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd ~/src/dsh-superagent-ui && pnpm start'
```

如果这次更新改到了 `packages/companion`，再按[更新 companion](#更新-companion) 重装。如果改到了 `upstream/`，再按[升级 dsh-superagent](#升级-dsh-superagent) 升级。

### 环境变量

默认值适合本机的 dsh-superagent。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `SUPERAGENT_URL` | `http://127.0.0.1:3082` | dsh-superagent 所在 DSH Web 的地址，必须是它监听的回环地址 |
| `CONSOLE_PORT` | `3090` | BFF 端口，只绑定 127.0.0.1 |
| `CONSOLE_DATA_DIR` | `~/.dsh-superagent-ui` | 启动 token、会话密钥，以及控制台自己的数据库（审计日志、校准标注、每小时的状态采样；用 mock 时是单独的 `console-mock.db`） |
| `CONSOLE_POLL_MS` | `2000` | 有控制台打开时，BFF 轮询 dsh-superagent 的间隔 |
| `CONSOLE_MOCK` | 未设置 | 设为 `1` 时用内置的示例数据 |

## 在控制台里改设置

安装指南用管理 API 保存设置，方便 agent 执行。人可以直接在控制台里改，效果一样：

| 设置 | 位置 |
| --- | --- |
| GitHub 仓库、agent 的 CLI | 来源 → GitHub → 账号 |
| 机器人的 CLI、监听的群 | 来源 → 飞书 |
| 谁能让它干活 | 策略 → 对应来源 → 名单 |
| prepare 命令、并发、模型 | 执行 |
| 提交署名、自动合并、PR 要求 | 提示词 → Delivery requirements |

保存账号或仓库时会先检查，没通过就什么都不保存，页面上会写出原因；通过后服务会重启，十几秒后页面恢复。在控制台外修好了问题（比如重新登录了 CLI），点首页或来源页的“重新检查”。

## 磁盘占用

dsh-superagent 不会清理 Ticket 的工作目录，Ticket 结束后目录还在。控制台的“工作目录”页能看每个目录占多少磁盘，并逐层查看里面的文件。这个页面只看不改。

要腾空间时，**删目录里的大文件，不要删整个目录**。Ticket 结束后，线程里的新消息还可能恢复它：目录还在，worker 就接着用；整个目录不见了，prepare 会重新运行，而 `git worktree add -b` 会报分支已存在，这个 Ticket 就失败了。删之前也看一眼 Ticket 的对话，确认这些文件已经交付，或者确实不再需要。

## 升级 dsh-superagent

控制台手抄的接口类型对应 `upstream/` 指向的提交，所以部署要跟着这个提交走，不要直接用上游最新的代码。

```bash
cd ~/src/dsh-superagent
cp ~/.dsh/state/superagent/orchestrator.sqlite ~/.dsh/state/superagent/orchestrator.sqlite.bak   # 新版迁移过的库旧版打不开
git apply --reverse ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
git fetch && git checkout "$(git -C ~/src/dsh-superagent-ui rev-parse HEAD:upstream/dsh-superagent-prototype)"
git apply ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
pnpm install && pnpm build
scripts/dsh-superagent restart
```

补丁打不上时，说明上游改了那段代码：先看上游是否已经修好，没修好就照着补丁的说明重做一份，更新到 `patches/`。

维护者升级 `upstream/` 时，要同时对照上游核对 `apps/bff/src/upstream/types.ts`。

### 补丁

上游目前不接受 PR，我们需要的修改以补丁的形式放在 [`patches/dsh-superagent/`](../patches/dsh-superagent)：

| 补丁 | 解决什么 |
| --- | --- |
| `0001-status-desktop-app.patch` | 用 DeepSeek Harness 桌面应用的 `dsh` 时，服务进程叫 `DeepSeek Harness` 而不是 `node`，名字里还带空格。上游脚本因此认不出正在运行的服务：`status` 一直报“没在运行”（退出码 1），每小时的自检会再启动一份。用 npm 装的 `dsh` 不受影响，打上也无害 |

确认补丁是否已经打上：`git apply --reverse --check ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch` 不报错就是已经打上了。

## companion 插件

companion 是本仓库 `packages/companion` 里的一个 DSH 插件，装进 superagent profile，和 dsh-superagent 一起运行。它补上上游管理 API 没有提供的功能：

- **worker 在做什么：** Ticket 工作台里能看到 worker 每一步的思考、调用的工具（命令、读写的文件、退出码、耗时）和结果，以及这一单实际用的模型。worker 还在跑时，每 4 秒刷新一次。
- **主 Session 的模型：** 执行页显示主 Session 实际在用的模型（0.2.0 起）。保存模型设置时，正在运行的主 Session 会直接切换，从它下一次调用模型开始生效；worker 和 profile 的默认模型不变（0.3.0 起）。设置和实际不一样时，执行页有一个按钮，可以让它换成设置里的模型。换模型后的第一次调用用不上之前对话的缓存，只有这一次。
- **它说了什么：** 每个 Ticket 的对话里，agent 发出、还在排队、被丢弃的每一条消息。
- **它对外说了多少话：** 洞察页按 Ticket 统计确认、回复、通知各多少条，以及哪个 Ticket 说得最多。

不装也能用控制台，只是这些地方会显示“装上 companion 插件后可以看到”。安装步骤在 [core.md 的步骤 10](install/core.md#10-安装控制台)。

### 更新 companion

路径没变时 `add` 不会更新已装的那份，所以要先 `remove` 再 `add`：

```bash
cd ~/src/dsh-superagent-ui
pnpm install && pnpm build
dsh plugin --profile superagent remove @dsh-superagent-ui/companion
dsh plugin --profile superagent add "file:$HOME/src/dsh-superagent-ui/packages/companion"
cd ~/src/dsh-superagent && scripts/dsh-superagent restart
curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info   # 版本号应该是新的
```

- **装进去的是一份拷贝，但 profile 记着来源路径：** `file:` 把插件复制进 profile，dsh-superagent 运行时只用这份拷贝；但 profile 的 `package.json` 记着来源路径，以后在这个 profile 上执行 `dsh plugin add` 或 `remove` 时会重新读它。所以要从固定位置的克隆安装；挪了目录就从新位置重新 `add` 一次。
- **只有切换模型这一处会写：** worker 的记录通过 DSH 的会话存储以只读方式打开；消息是从 dsh-superagent 的发送记录里查询的，只执行 SELECT。切换模型走 DSH 自己的接口，和在 DSH 界面里手动选模型一样。
- **访问限制和管理 API 一样：** 只接受本机回环地址，并且必须带 `x-superagent-ui-request: 1` 请求头。
- **卸载：** `dsh plugin --profile superagent remove @dsh-superagent-ui/companion`，然后 `restart`。

## 常见问题

| 现象 | 原因和处理 |
| --- | --- |
| `status` 说没在运行，但 `http://127.0.0.1:3082` 能打开 | 补丁没打上，见[补丁](#补丁) |
| `git checkout` 报 `reference is not a tree` | 上游改写了历史，`upstream/` 指向的提交已经不在上游的分支上。先 `git -C ~/src/dsh-superagent-ui pull && git -C ~/src/dsh-superagent-ui submodule update`；还是不行就提 Issue |
| 首页“配置没完成”：GitHub 来源没有设置监听的仓库 | 见 [core.md 的步骤 9](install/core.md#9-保存设置)。只用飞书也要配 |
| 保存 GitHub 来源时报推送权限不足 | agent 账号没有接受仓库邀请，或者权限不是 Write。用 `~/.local/bin/gh-agent api repos/<owner>/<repo> --jq .permissions.push` 确认 |
| 在 GitHub 上 @ 了没反应 | 依次看：你在不在名单里；agent 账号和你是不是同一个账号（它会忽略自己发的内容）；是不是通过修改 Issue 正文加的 @（要发新评论）；健康页里 GitHub 是否正常 |
| 重启后来源的账号检查失败，详情里有 `exec: gh: not found`（或 `lark-cli`） | wrapper 里的 CLI 路径失效了，常见于用 nvm 换了 Node 版本之后。按安装指南用完整路径重新生成 wrapper，再在来源页点“重新检查” |
| `tmux new-session` 失败，或 tmux 报 `unknown option -- e` | tmux 版本低于 3.2，先升级 |
| `The bot lark-cli allows user identities` | 机器人的配置没设 `strict-mode bot`，或者来源里填的是你个人的 `lark-cli`，见 [feishu.md 的步骤 2](install/feishu.md#2-配置机器人的-cli) |
| 报错 `app_scope_not_applied`，或者读群消息报 230027 | 缺权限，见 [feishu.md 的步骤 3](install/feishu.md#3-操作者开通权限) |
| 在飞书群里 @ 了没反应 | 依次看：机器人在不在群里；这个群在不在来源的接收列表里；你在不在飞书名单里；健康页里飞书是否正常 |
| 首页一直提示“名单是空的” | 策略里给飞书或 GitHub 至少加一个人 |
| 飞书后台提示权限受组织策略限制 | 找组织管理员放行，或者用范围更小的权限代替。不要改用个人身份绕过 |
| worker 报模型错误，或者一直没有评估结论 | 用 `dsh headless "reply with exactly: ok"` 检查 key。用其他 provider 时，检查 `~/.dsh/.env` 和 profile 里的 `apiKeyEnv` 是否一致 |
| Ticket 里显示“装上 companion 插件后可以看到” | 看 `curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info` 是否有回应，没有就按[更新 companion](#更新-companion) 重装（`remove` 报 `Cannot remove` 说明没装过，接着 `add` 就行） |
| 日志里 companion 报模块找不到 | 没有构建就安装了插件。先 `pnpm build`，再按[更新 companion](#更新-companion) 重装 |
| 更新后 companion 还是旧版本 | 路径没变时 `add` 不会更新已装的那份，按[更新 companion](#更新-companion) 先 `remove` 再 `add` |
| 控制台 `http://127.0.0.1:3090/` 返回 404 | 还没有构建，运行 `pnpm build` |
