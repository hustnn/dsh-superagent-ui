[中文](feishu.md) | English

# Install: Feishu source (optional)

This guide is written for the agent doing the install; a person can follow it too. It only adds Feishu as a source and leaves the GitHub configuration as it is.

| Item | Details |
| --- | --- |
| Goal | People on the allow list @ the bot in a Feishu group or message it directly; the agent takes the work and replies in the original conversation |
| Requires | [core.en.md](core.en.md) is done. Feishu cannot replace GitHub: dsh-superagent still checks the GitHub repository on start |
| Operator does | Creates the app and grants permissions in the Feishu developer console, creates a test group, sends the first message |
| Tested with | Feishu (`--brand feishu`). Lark, the international version, has not been tested |

## Rules

1. **Go in order.** For a step with a check, run the check first and skip to the next step if it passes. That makes this guide safe to stop and run again.
2. **Every code block runs on its own.** None relies on shell state left by an earlier block. Replace `<angle-bracket>` placeholders with real values.
3. **Steps marked [Operator] can only be done by a person.** Send the operator what to do and the link, and wait for them to confirm before running the verification.
4. **Do not touch secrets.** Never ask for or print the App Secret or tokens in the conversation.
5. **The bot only uses the bot identity.** Do not run `lark-cli auth login`, and do not give the bot the operator's personal identity. dsh-superagent rejects a CLI that can act as a user, because workers call it directly.
6. **Do not create the app twice.** If the check in step 2 passes, do not run `config init --new` again.
7. **Do not skip verification.** If a verification fails, check [Troubleshooting](../operations.en.md#troubleshooting) first. If that does not solve it, stop and tell the operator which step is stuck, with the full output.

## Steps

### 1. Check the prerequisites

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status > /dev/null; echo "status exit: $?"
command -v lark-cli && lark-cli --version
```

- `status exit` is not 0: fix the GitHub install first.
- No `lark-cli`: with the operator's consent, run `npm install -g @larksuite/cli` (tested with 1.0.98).

### 2. Configure the bot's CLI

**Check:**

```bash
"$HOME/.local/bin/lark-bot" auth status | jq -r '.appId, .identities.bot.status'
```

Passes if it prints an App ID starting with `cli_` and `ready`. If it passes, skip to step 3.

**Run:** write a wrapper. The bot gets its own configuration directory and does not affect the operator's personal `lark-cli`. The wrapper holds the full path to `lark-cli`, because the service's PATH may differ from the current terminal's.

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/lark-bot" <<EOF
#!/bin/sh
export LARKSUITE_CLI_CONFIG_DIR="\$HOME/.lark-cli-dsh-superagent"
exec "$(command -v lark-cli)" "\$@"
EOF
chmod +x "$HOME/.local/bin/lark-bot"
```

Create the app. This command waits until the operator has created the app in the browser, so run it in the background:

```bash
"$HOME/.local/bin/lark-bot" config init --new --brand feishu
```

**[Operator]** Send the operator the `https://open.feishu.cn/page/cli?user_code=…` link the command prints, and ask them to open it in a browser and follow the prompts to create the app. An app created this way is already subscribed to the message events.

When the command finishes, restrict it to the bot identity:

```bash
"$HOME/.local/bin/lark-bot" config strict-mode bot --global
```

**Verify:** run the check above again.

### 3. [Operator] Grant permissions

Get the App ID:

```bash
"$HOME/.local/bin/lark-bot" auth status | jq -r .appId
```

Replace `<App ID>` in the link below, send it to the operator, and ask them to open it and request all the permissions. If the console asks to publish a new version, publish it.

```text
https://open.feishu.cn/page/scope-apply?clientID=<App ID>&scopes=im%3Achat%3Areadonly%2Cim%3Achat.members%3Aread%2Cim%3Amessage%3Areadonly%2Cim%3Amessage.group_msg%2Cim%3Amessage.group_at_msg%2Cim%3Amessage.p2p_msg%2Cim%3Amessage%3Asend_as_bot%2Cim%3Aresource
```

| Permission | Used for |
| --- | --- |
| `im:chat:readonly`, `im:chat.members:read` | Reading group info and members |
| `im:message:readonly` | Reading messages and threads, for context during evaluation |
| `im:message.group_at_msg`, `im:message.p2p_msg` | Receiving messages that @ the bot, and direct messages |
| `im:message.group_msg` | Receiving every message in a group. This is a sensitive permission and may need admin approval. If it is not approved, leave it out and listen to the group for @ mentions only |
| `im:message:send_as_bot` | Replying as the bot |
| `im:resource` | Downloading images in messages |

### 4. [Operator] Create a test group

Send this to the operator: create a Feishu group with only yourself in it, and add this bot under group settings → bots.

### 5. Find the group and operator IDs

```bash
"$HOME/.local/bin/lark-bot" im +chat-list --page-all --page-size 100 --as bot --format json | jq -c '.data.chats[] | {chat_id, name}'
```

Show the list to the operator and confirm which group to use; record it as `<chat-id>` and `<chat-name>`.

```bash
"$HOME/.local/bin/lark-bot" im +chat-members-list --chat-id <chat-id> --member-types user --page-all --page-limit 0 --as bot --format json | jq -c '.data.users[] | {member_id, name}'
```

Confirm with the operator which entry is them; record it as `<open-id>` (starts with `ou_`) and `<name>`.

An `app_scope_not_applied` error or error code 230027 means the permissions from step 3 have not taken effect yet.

### 6. Enable the Feishu source

```bash
P="$HOME/.dsh/profiles/superagent/cordis.patch.yml"
grep -q 'id: dsh-superagent-feishu' "$P" || printf -- '- id: dsh-superagent-feishu\n  disabled: false\n' >> "$P"
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent restart
```

If `grep` finds the entry but it says `disabled: true`, change that to `false` and restart.

**Verify:**

```bash
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/orchestrator/api/settings | jq -r '.sources[].id'
```

Passes if the output includes `feishu`.

### 7. Save the settings

**The bot's CLI:** saving checks that it can only use the bot identity; if the check passes, the service restarts.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg cli "$HOME/.local/bin/lark-bot" \
      '.sources[] | select(.id == "feishu") | {value: {enabled: true, config: (.value.config + {cli: $cli, directMessages: true})}, revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:feishu" -d @-
```

Wait for the restart to finish:

```bash
cd "$HOME/src/dsh-superagent"
for i in $(seq 1 40); do scripts/dsh-superagent status > /dev/null 2>&1; code=$?; [ "$code" != 1 ] && break; sleep 3; done; echo "status exit: $code"
```

**Groups to listen to:** the default is @ mentions only.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg id '<chat-id>' --arg name '<chat-name>' \
      '.sources[] | select(.id == "feishu") | {value: (.value | .config.chats = (((.config.chats // []) + [{chatId: $id, name: $name, listen: "mentions"}]) | unique_by(.chatId))), revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:feishu" -d @-
```

**Allow list:** only people on the list can give the agent work.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg id '<open-id>' --arg name '<name>' \
      '{value: (.blocks.policy.value | .sources.feishu.allowed = (((.sources.feishu.allowed // []) + [{id: $id, name: $name}]) | unique_by(.id))), revision: .blocks.policy.revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/policy" -d @-
```

**Verify:**

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status | jq '{setup, feishu, errors, health: .health.feishu}'
```

Passes if `setup` and `feishu` are both `null`, `errors` is empty, and `health` is `ready`. A failed Feishu configuration only disables the Feishu source; GitHub keeps working.

### 8. Try it

**[Operator]** In the test group, @ the bot:

```text
@<bot> Add a short project description to the README and open a PR for me
```

**Verify:**

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/tickets?state=open&limit=5" | jq '[.items[] | {id, title, stage, action}]'
```

Passes if the bot replies in the message's thread. In our tests it replied within half a minute, and a worker opened a PR a minute or two later and replied in the thread with the link.

## Done when

- [ ] `status` exits 0, `feishu` is `null`, and the Health page (健康) shows Feishu as working
- [ ] The first Feishu message created a Ticket, and the bot replied in the thread

## Hand over to the operator

Tell the operator in one short message:

- People on the allow list who @ the bot in `<chat-name>` or message it directly are making an explicit request.
- To add groups or people, or to have a group listen to all messages, use the Sources (来源) and Policy (策略) pages in the console.
- When one thread has several Tickets, each new message goes to all of them, and each worker decides whether it is theirs. Start a new thread for a separate task.
- When a worker needs other Feishu abilities (for example creating docs), request the permissions listed in `missing_scopes` in its error, using the link format from step 3.
