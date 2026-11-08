中文 | [English](core.en.md)

# 安装：dsh-superagent + GitHub + 控制台

这份指南写给执行安装的 agent，人也可以照着做。这是最小可用安装，不涉及飞书；飞书在 [feishu.md](feishu.md) 里单独安装。

| 项 | 内容 |
| --- | --- |
| 目标 | agent 能在 GitHub 上接活、开 PR，操作者能在本地控制台管理它 |
| 平台 | 在 macOS 上测过；Linux 没有测过；Windows 不支持 |
| 操作者要做 | 准备 agent 的 GitHub 账号、登录、提供模型 API key、发第一条请求 |
| 默认位置 | 控制台 `~/src/dsh-superagent-ui`，服务 `~/src/dsh-superagent`，profile `superagent`，服务端口 3082，控制台端口 3090 |

完成后是这样：

```text
GitHub ──▶ dsh-superagent（DSH 的 superagent profile，127.0.0.1:3082）──▶ worker 在独立目录里干活、开 PR、回到原对话回复
                 ▲
                 │ 管理 API
    dsh-superagent-ui（BFF 127.0.0.1:3090，浏览器打开）
```

## 执行规则

1. **按顺序执行。** 带“检查”的步骤先运行检查，通过就跳到下一步，所以这份指南可以中断后重新执行。
2. **每个代码块都能单独运行。** 不依赖上一个代码块留下的 shell 状态。把 `<尖括号>` 占位符换成实际的值。
3. **标着【操作者】的事只有人能做。** 把要做的事和完整命令一次发给操作者，等对方确认后再运行验证。
4. **不要接触密钥。** 不要在对话里索要或打印密码、token、API key。
5. **带 token 的链接只发给操作者。** 不要写进文件、日志或工单。
6. **不要覆盖已有配置。** `~/.dsh/profiles/superagent` 已经存在时，不要运行 `--from-default-profile`：它会删除这个 profile 的配置。不要手动修改 `~/.dsh/storages`。
7. **不要跳过验证。** 验证失败时先查 [常见问题](../operations.md#常见问题)，解决不了就停下，把卡住的步骤和完整输出告诉操作者。
8. **对外操作要先问。** 在 GitHub 上建仓库、发 Issue、发评论，都要操作者同意。

## 开始前要问操作者的值

一次问一个，每个都给出建议。

| 占位符 | 含义 | 建议 |
| --- | --- | --- |
| `<owner>/<repo>` | agent 干活的 github.com 仓库。不支持 GitHub Enterprise Server | 第一次用一个新建的私有沙盒仓库 |
| `<agent-login>` | agent 使用的 GitHub 账号 | 新建一个专用账号。**不能和 `<operator-login>` 相同** |
| `<operator-login>` | 操作者本人的 GitHub 账号，会被加入名单，只有名单里的人能让 agent 干活 | `gh api user --jq .login` 的结果 |

下文的 `<repo>` 指 `<owner>/<repo>` 里仓库名那一段。

账号不能相同的原因：dsh-superagent 会忽略 agent 账号自己发的 Issue 和评论，用同一个账号时，操作者在 GitHub 上 @ 它不会有任何反应。GitHub App 也不能当 agent，因为 dsh-superagent 要读这个账号的通知。

## 步骤

### 1. 检查工具

```bash
node -v; pnpm -v; git --version; python3 --version; tmux -V; gh --version | head -1; jq --version; dsh --version
```

| 工具 | 要求 | 缺少时 |
| --- | --- | --- |
| Node.js | 24+ | 让操作者用自己习惯的版本管理工具安装 |
| pnpm | 任意版本，仓库会自动切换到固定版本 | `npm install -g pnpm` |
| git | 2.32+ | macOS：`brew install git` |
| Python | 3.8+ | macOS：`brew install python` |
| tmux | 3.2+ | macOS：`brew install tmux` |
| GitHub CLI | 2.48+ | macOS：`brew install gh` |
| jq | 1.6+ | macOS：`brew install jq` |
| DSH | 测过 0.2.1-rc.5 | `npm install -g @deepseek-ai/dsh@0.2.1-rc.5`。装了 DeepSeek Harness 桌面应用的话，`dsh` 命令已经有了 |

把缺的工具列给操作者，得到同意后再安装。如果仓库用了 Git LFS，还要装 `git-lfs`。

### 2. 【操作者】准备账号和仓库

发给操作者：

1. 新建一个 GitHub 账号给 agent 用（`<agent-login>`）。
2. 如果还没有仓库，新建 `<owner>/<repo>`，建议先用私有的沙盒仓库。
3. 在仓库的 Settings → Collaborators 里邀请 `<agent-login>`，权限选 Write。
4. 登录 `<agent-login>`，接受邀请。

等操作者确认后继续。

### 3. 配置 agent 的 GitHub CLI

**检查：**

```bash
"$HOME/.local/bin/gh-agent" api user --jq .login
```

通过条件：输出 `<agent-login>`。通过就跳到“验证”。

**执行：** 写一个只使用 agent 凭据的 wrapper。里面写 `gh` 的完整路径，因为服务的 PATH 可能和当前终端不同。

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/gh-agent" <<EOF
#!/bin/sh
export GH_CONFIG_DIR="\$HOME/.config/gh-agent"
exec "$(command -v gh)" "\$@"
EOF
chmod +x "$HOME/.local/bin/gh-agent"
```

**【操作者】** 在自己的终端里运行下面的命令，用 **agent 账号**登录，不要用本人账号：

```bash
~/.local/bin/gh-agent auth login
```

**验证：**

```bash
"$HOME/.local/bin/gh-agent" api user --jq .login
"$HOME/.local/bin/gh-agent" api repos/<owner>/<repo> --jq .permissions.push
```

通过条件：第一行是 `<agent-login>`，第二行是 `true`。

### 4. 配置模型

**检查：** 这会调用一次模型，消耗很少。

```bash
cd "$HOME" && dsh headless "reply with exactly: ok"
```

通过条件：输出 `ok`。

**失败时：**

- 报 `MISSING_CREDENTIAL`：还没有配置 key。DSH 默认使用 DeepSeek 官方 API，让操作者二选一：
  - **用 DeepSeek 官方 API：** 【操作者】编辑 `~/.dsh/.env`，加一行 `DEEPSEEK_API_KEY=<key>`，再运行 `chmod 600 ~/.dsh/.env`。然后重新运行检查。
  - **用其他 OpenAI 兼容的模型：** 【操作者】编辑 `~/.dsh/.env`，加一行 `<KEY 的变量名>=<key>`，再运行 `chmod 600 ~/.dsh/.env`。向操作者问清楚 provider 名称、接口地址和模型 id（这些不是密钥），在步骤 6 写进配置。这种情况跳过这里的检查，模型是否可用在步骤 11 确认。
- 报 `AUTH`：key 不对，让操作者换一个。

### 5. 获取代码

dsh-superagent 要切到控制台对应的提交，并打上补丁。两个目录都要放在固定位置，profile 和插件都记着这些路径。

```bash
[ -d "$HOME/src/dsh-superagent-ui/.git" ] || git clone --recurse-submodules https://github.com/hustnn/dsh-superagent-ui.git "$HOME/src/dsh-superagent-ui"
[ -d "$HOME/src/dsh-superagent/.git" ] || git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git "$HOME/src/dsh-superagent"
cd "$HOME/src/dsh-superagent"
git checkout "$(git -C "$HOME/src/dsh-superagent-ui" rev-parse HEAD:upstream/dsh-superagent-prototype)"
git apply --reverse --check "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch 2>/dev/null || git apply "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
pnpm install && pnpm build
```

**验证：**

```bash
test -f "$HOME/src/dsh-superagent/lib/client.js" && echo built
git -C "$HOME/src/dsh-superagent" apply --reverse --check "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch && echo patched
```

通过条件：输出 `built` 和 `patched`。

### 6. 创建 superagent profile

**检查：**

```bash
grep -q 'id: dsh-superagent' "$HOME/.dsh/profiles/superagent/cordis.patch.yml" 2>/dev/null && echo exists
```

输出 `exists` 就跳过这一步，**不要**运行下面的命令。这时如果要用其他模型，只把模型配置追加到已有文件里。

**执行：**

```bash
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$HOME/src/dsh-superagent"
cat > "$HOME/.dsh/profiles/superagent/cordis.patch.yml" <<EOF
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082
- id: dsh-superagent
  config:
    stateDir: $HOME/.dsh/state/superagent
EOF
```

只有在用其他 OpenAI 兼容的模型时，才追加这一段：

```bash
cat >> "$HOME/.dsh/profiles/superagent/cordis.patch.yml" <<'EOF'
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      <provider>:
        apiKeyEnv: <KEY 的变量名>
        api: openai-completions
        baseURL: <接口地址>
        models:
          - id: <模型 id>
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: <provider>
    model: <模型 id>
EOF
```

### 7. 克隆仓库到本地

每个 Ticket 都会从这份克隆里拉出一个独立的 worktree。

```bash
[ -d "$HOME/src/<repo>/.git" ] || "$HOME/.local/bin/gh-agent" repo clone <owner>/<repo> "$HOME/src/<repo>"
```

如果 `$HOME/src/<repo>` 已经被另一个项目占用，问操作者换一个目录，并在步骤 9 的 `CLONE` 里写同一个路径。

### 8. 启动 dsh-superagent

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent start
```

通过条件：第一次启动时退出码是 3，输出里的 `setup.code` 是 `repositoryUnset`。这表示服务已经运行，在等配置。退出码 0 表示之前已经配置好了。

服务运行在 tmux 会话 `dsh-superagent` 里。退出码的含义见 [日常运行](../operations.md#dsh-superagent)。

### 9. 保存设置

三项设置都通过本机管理 API 保存。

**GitHub 来源：** 保存时会检查账号和推送权限，通过后服务会重启。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg repo '<owner>/<repo>' --arg cli "$HOME/.local/bin/gh-agent" \
      '.sources[] | select(.id == "github") | {value: {enabled: true, config: (.value.config + {repository: $repo, cli: $cli})}, revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:github" -d @-
```

通过条件：返回 `"saved":true`。如果是 400，`setup` 字段里有原因。

等服务重启完成：

```bash
cd "$HOME/src/dsh-superagent"
for i in $(seq 1 40); do scripts/dsh-superagent status > /dev/null 2>&1; code=$?; [ "$code" != 1 ] && break; sleep 3; done; echo "status exit: $code"
```

通过条件：`status exit: 0`。

**名单：** 只有名单里的人能让 agent 干活，名单为空时不会接任何请求。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg login '<operator-login>' \
      '{value: (.blocks.policy.value | .sources.github.allowed = (((.sources.github.allowed // []) + [{id: $login}]) | unique_by(.id))), revision: .blocks.policy.revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/policy" -d @-
```

**prepare 命令：** 每个 Ticket 第一次派工前运行一次，为它创建独立的 worktree。如果步骤 7 换了目录，改 `CLONE`。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
CLONE="$HOME/src/<repo>"
PREPARE=$(cat <<EOF
git -C '$CLONE' fetch --no-tags "https://github.com/\$DSH_SUPERAGENT_GITHUB_REPOSITORY.git" "\${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/\$DSH_SUPERAGENT_TICKET" &&
git -C '$CLONE' worktree add -b "agent/\$DSH_SUPERAGENT_NAME" "\$DSH_SUPERAGENT_DIR" "refs/dsh-superagent/\$DSH_SUPERAGENT_TICKET"
EOF
)
curl -s -H "$h" "$api/settings" \
  | jq --arg prepare "$PREPARE" '{value: (.blocks.executor.value | .prepare = $prepare), revision: .blocks.executor.revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/executor" -d @-
```

**验证：**

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" | jq '{allowed: .blocks.policy.value.sources.github.allowed, prepare: .blocks.executor.value.prepare, github: (.sources[] | select(.id == "github") | .value.config | {repository, cli})}'
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status
```

通过条件：三项设置都是刚保存的值；`status` 退出码 0，`setup` 是 `null`，`errors` 是空的。

### 10. 安装控制台

先构建，再安装 companion 插件。顺序不能反：没构建时装进去的插件无法加载。companion 让控制台能显示 worker 的每一步和它发出的消息。

```bash
cd "$HOME/src/dsh-superagent-ui" && pnpm install && pnpm build
dsh plugin --profile superagent add "file:$HOME/src/dsh-superagent-ui/packages/companion"
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent restart
curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info
```

通过条件：最后一行返回 `{"name":"@dsh-superagent-ui/companion",…}`。

启动控制台。`-e "PATH=$PATH"` 让 tmux 里能找到 pnpm 和 Node 24：

```bash
tmux has-session -t dsh-superagent-ui 2>/dev/null || tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd "$HOME/src/dsh-superagent-ui" && pnpm start'
cd "$HOME/src/dsh-superagent-ui" && pnpm --silent console:url
```

通过条件：打印 `http://127.0.0.1:3090/?token=…`。把链接发给操作者。

### 11. 试一次

**【操作者】** 用本人账号（不是 agent 账号），在 `<owner>/<repo>` 里新建一个 Issue，或者在已有 Issue 下评论：

```text
@<agent-login> 在 README 里加一段项目简介，开个 PR 给我
```

必须是新建 Issue 或新评论。修改已有 Issue 的正文来加 @ 不会被收到。

**验证：** 默认每分钟检查一次 GitHub，所以这条消息最多等一分钟左右才会被收到。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/tickets?state=open&limit=5" | jq '[.items[] | {id, title, stage, action}]'
```

通过条件：出现一个 Ticket，agent 在 GitHub 上回复，之后开出 PR。控制台的首页和 Ticket 页也能看到完整经过。

没有反应时，看 [常见问题](../operations.md#常见问题)。

## 完成标准

- [ ] `scripts/dsh-superagent status` 退出码 0，`errors` 是空的
- [ ] 控制台能打开，健康页里 GitHub 显示正常，companion 插件显示已安装
- [ ] 第一条请求生成了 Ticket，agent 在 GitHub 上回复并开了 PR

## 交给操作者

安装完成后，用一条简短的消息告诉操作者：

- **控制台：** 链接，以及以后打开用 `cd ~/src/dsh-superagent-ui && pnpm console:url`。
- **用法：** 名单里的人在仓库里 @ `<agent-login>`；需要操作者处理的事都在控制台首页。
- **合并：** 默认由人合并 PR，agent 不会自己合并。这部分和提交署名都可以在提示词页的 Delivery requirements 里调整。
- **放手：** 主动接单默认是“观察”，只记录不执行。先在校准页复核判断，再决定是否放开。
- **重启：** 服务和控制台都不会开机自启，见 [日常运行](../operations.md)。
- **飞书：** 想接入飞书时，把 README 里“加上飞书”那段提示词交给 agent。
