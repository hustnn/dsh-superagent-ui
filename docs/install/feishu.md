# 安装：飞书来源（可选）

这份指南写给执行安装的 agent，人也可以照着做。它只增加飞书这一个来源，GitHub 的配置不变。

| 项 | 内容 |
| --- | --- |
| 目标 | 名单里的人在飞书群里 @ 机器人或私聊它，agent 接活并回到原对话回复 |
| 前置 | [core.md](core.md) 已完成。飞书不能替代 GitHub，dsh-superagent 启动时仍会检查 GitHub 仓库 |
| 操作者要做 | 在飞书开发者后台建应用、开权限，建测试群，发第一条消息 |

## 执行规则

1. **按顺序执行。** 带“检查”的步骤先运行检查，通过就跳到下一步，所以这份指南可以中断后重新执行。
2. **每个代码块都能单独运行。** 不依赖上一个代码块留下的 shell 状态。把 `<尖括号>` 占位符换成实际的值。
3. **标着【操作者】的事只有人能做。** 把要做的事和链接发给操作者，等对方确认后再运行验证。
4. **不要接触密钥。** 不要在对话里索要或打印 App Secret、token。
5. **机器人只能用机器人身份。** 不要运行 `lark-cli auth login`，不要把操作者的个人身份配给机器人。dsh-superagent 会拒绝能以用户身份操作的 CLI，因为 worker 会直接调用它。
6. **不要重复建应用。** 步骤 2 的检查通过时，不要再运行 `config init --new`。
7. **不要跳过验证。** 验证失败时先查 [常见问题](../operations.md#常见问题)，解决不了就停下，把卡住的步骤和完整输出告诉操作者。

## 步骤

### 1. 检查前置条件

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status > /dev/null; echo "status exit: $?"
command -v lark-cli && lark-cli --version
```

- `status exit` 不是 0：先修好 GitHub 安装。
- 缺 `lark-cli`：得到操作者同意后运行 `npm install -g @larksuite/cli`（测过 1.0.98）。

### 2. 配置机器人的 CLI

**检查：**

```bash
"$HOME/.local/bin/lark-bot" auth status | jq -r '.appId, .identities.bot.status'
```

通过条件：输出 `cli_` 开头的 App ID 和 `ready`。通过就跳到步骤 3。

**执行：** 写 wrapper。机器人有自己单独的配置目录，不影响操作者个人的 `lark-cli`。里面写 `lark-cli` 的完整路径，因为服务的 PATH 可能和当前终端不同。

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/lark-bot" <<EOF
#!/bin/sh
export LARKSUITE_CLI_CONFIG_DIR="\$HOME/.lark-cli-dsh-superagent"
exec "$(command -v lark-cli)" "\$@"
EOF
chmod +x "$HOME/.local/bin/lark-bot"
```

创建应用。这条命令会一直等，直到操作者在浏览器里建好应用，所以放在后台运行：

```bash
"$HOME/.local/bin/lark-bot" config init --new --brand feishu
```

**【操作者】** 把命令打印的 `https://open.feishu.cn/page/cli?user_code=…` 链接发给操作者，让对方在浏览器里打开并按提示建好应用。这样建出来的应用已经订阅了收消息的事件。

命令结束后，限制它只能用机器人身份：

```bash
"$HOME/.local/bin/lark-bot" config strict-mode bot --global
```

**验证：** 重新运行上面的检查。

### 3. 【操作者】开通权限

取出 App ID：

```bash
"$HOME/.local/bin/lark-bot" auth status | jq -r .appId
```

把下面链接里的 `<App ID>` 换掉，发给操作者，让对方打开后申请全部权限。如果后台提示要发布新版本，就发布。

```text
https://open.feishu.cn/page/scope-apply?clientID=<App ID>&scopes=im%3Achat%3Areadonly%2Cim%3Achat.members%3Aread%2Cim%3Amessage%3Areadonly%2Cim%3Amessage.group_msg%2Cim%3Amessage.group_at_msg%2Cim%3Amessage.p2p_msg%2Cim%3Amessage%3Asend_as_bot%2Cim%3Aresource
```

| 权限 | 用来 |
| --- | --- |
| `im:chat:readonly`、`im:chat.members:read` | 读群信息和群成员 |
| `im:message:readonly` | 读消息和话题，评估时看上下文 |
| `im:message.group_at_msg`、`im:message.p2p_msg` | 收 @ 机器人的消息和私聊 |
| `im:message.group_msg` | 收群里的全部消息。这是敏感权限，可能要管理员审批。批不下来时可以先不开，把群设成“仅 @” |
| `im:message:send_as_bot` | 以机器人身份回复 |
| `im:resource` | 下载消息里的图片 |

### 4. 【操作者】建测试群

发给操作者：先建一个只有自己的飞书群，在“群设置 → 群机器人”里把这个机器人加进来。

### 5. 找到群和操作者的 ID

```bash
"$HOME/.local/bin/lark-bot" im +chat-list --page-all --page-size 100 --as bot --format json | jq -c '.data.chats[] | {chat_id, name}'
```

把列表给操作者，确认用哪个群，记为 `<chat-id>` 和 `<chat-name>`。

```bash
"$HOME/.local/bin/lark-bot" im +chat-members-list --chat-id <chat-id> --member-types user --page-all --page-limit 0 --as bot --format json | jq -c '.data.users[] | {member_id, name}'
```

和操作者确认哪一个是本人，记为 `<open-id>`（`ou_` 开头）和 `<name>`。

如果报 `app_scope_not_applied` 或错误码 230027，就是步骤 3 的权限还没生效。

### 6. 启用飞书来源

```bash
P="$HOME/.dsh/profiles/superagent/cordis.patch.yml"
grep -q 'id: dsh-superagent-feishu' "$P" || printf -- '- id: dsh-superagent-feishu\n  disabled: false\n' >> "$P"
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent restart
```

如果 `grep` 找到了这个条目，但它下面写的是 `disabled: true`，把它改成 `false` 再重启。

**验证：**

```bash
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/orchestrator/api/settings | jq -r '.sources[].id'
```

通过条件：输出里有 `feishu`。

### 7. 保存设置

**机器人的 CLI：** 保存时会检查它是否只能用机器人身份，通过后服务会重启。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg cli "$HOME/.local/bin/lark-bot" \
      '.sources[] | select(.id == "feishu") | {value: {enabled: true, config: (.value.config + {cli: $cli, directMessages: true})}, revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:feishu" -d @-
```

等服务重启完成：

```bash
cd "$HOME/src/dsh-superagent"
for i in $(seq 1 40); do scripts/dsh-superagent status > /dev/null 2>&1; code=$?; [ "$code" != 1 ] && break; sleep 3; done; echo "status exit: $code"
```

**监听的群：** 默认是“仅 @”。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg id '<chat-id>' --arg name '<chat-name>' \
      '.sources[] | select(.id == "feishu") | {value: (.value | .config.chats = (((.config.chats // []) + [{chatId: $id, name: $name, listen: "mentions"}]) | unique_by(.chatId))), revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:feishu" -d @-
```

**名单：** 只有名单里的人能让 agent 干活。

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg id '<open-id>' --arg name '<name>' \
      '{value: (.blocks.policy.value | .sources.feishu.allowed = (((.sources.feishu.allowed // []) + [{id: $id, name: $name}]) | unique_by(.id))), revision: .blocks.policy.revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/policy" -d @-
```

**验证：**

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status | jq '{setup, feishu, errors, health: .health.feishu}'
```

通过条件：`setup` 和 `feishu` 都是 `null`，`errors` 是空的，`health` 是 `ready`。飞书的配置失败只会停用飞书来源，不影响 GitHub。

### 8. 试一次

**【操作者】** 在测试群里 @ 机器人：

```text
@<机器人> 在 README 里加一段项目简介，开个 PR 给我
```

**验证：**

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/tickets?state=open&limit=5" | jq '[.items[] | {id, title, stage, action}]'
```

通过条件：我们实测时，半分钟内机器人在这条消息的话题里回复，一两分钟后 worker 开出 PR，并在话题里回复链接。

## 完成标准

- [ ] `status` 退出码 0，`feishu` 是 `null`，健康页里飞书显示正常
- [ ] 第一条飞书消息生成了 Ticket，机器人在话题里回复了

## 交给操作者

用一条简短的消息说明：

- 名单里的人在 `<chat-name>` 里 @ 机器人或私聊它，就是明确请求。
- 要加群、加人或把群改成“全部消息”，在控制台的来源页和策略页操作。
- 一个话题上开了多个 Ticket 时，同一条消息会送给所有 Ticket，由各自的 worker 判断是否接手。独立的新任务建议开新话题。
- worker 需要飞书的其他能力（例如创建云文档）时，按报错里 `missing_scopes` 列出的权限，用步骤 3 的链接格式申请。
