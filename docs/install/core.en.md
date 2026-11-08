[中文](core.md) | English

# Install: dsh-superagent + GitHub + console

This guide is written for the agent doing the install; a person can follow it too. It is the minimal install and does not involve Feishu, which has its own guide: [feishu.en.md](feishu.en.md).

| Item | Details |
| --- | --- |
| Goal | The agent takes work on GitHub and opens PRs; the operator manages it from a local console |
| Platform | Tested on macOS; Linux untested; Windows not supported |
| Operator does | Prepares the agent's GitHub account, signs in, provides a model API key, sends the first request |
| Default locations | Console `~/src/dsh-superagent-ui`, service `~/src/dsh-superagent`, profile `superagent`, service port 3082, console port 3090 |

When it is done:

```text
GitHub ──▶ dsh-superagent (DSH superagent profile, 127.0.0.1:3082) ──▶ workers work in their own directories, open PRs, reply in the original conversation
                 ▲
                 │ admin API
    dsh-superagent-ui (BFF 127.0.0.1:3090, opened in a browser)
```

The console UI is in Chinese. Where this guide names a page or button, the Chinese label follows in parentheses.

## Rules

1. **Go in order.** For a step with a check, run the check first and skip to the next step if it passes. That makes this guide safe to stop and run again.
2. **Every code block runs on its own.** None relies on shell state left by an earlier block. Replace `<angle-bracket>` placeholders with real values.
3. **Steps marked [Operator] can only be done by a person.** Send the operator what to do and the full commands in one message, and wait for them to confirm before running the verification.
4. **Do not touch secrets.** Never ask for or print passwords, tokens or API keys in the conversation.
5. **Links with a token go only to the operator.** Do not write them into files, logs or tickets.
6. **Do not overwrite existing configuration.** If `~/.dsh/profiles/superagent` already exists, do not run `--from-default-profile`: it deletes that profile's configuration. Do not edit `~/.dsh/storages` by hand.
7. **Do not skip verification.** If a verification fails, check [Troubleshooting](../operations.en.md#troubleshooting) first. If that does not solve it, stop and tell the operator which step is stuck, with the full output.
8. **Ask before acting in public.** Creating a repository, opening an Issue or posting a comment on GitHub all need the operator's consent.

## Values to ask the operator for

Ask one at a time, and suggest a value for each.

| Placeholder | Meaning | Suggestion |
| --- | --- | --- |
| `<owner>/<repo>` | The github.com repository the agent works in. GitHub Enterprise Server is not supported | A new private sandbox repository for the first time |
| `<agent-login>` | The GitHub account the agent uses | A new account just for the agent. **Must not be the same as `<operator-login>`** |
| `<operator-login>` | The operator's own GitHub account. It goes on the allow list; only people on the list can give the agent work | The output of `gh api user --jq .login` |

Below, `<repo>` means the repository-name part of `<owner>/<repo>`.

Why the accounts must differ: dsh-superagent ignores Issues and comments posted by the agent's own account, so if both are the same account, the operator's @ mentions on GitHub get no response at all. A GitHub App cannot be the agent either, because dsh-superagent reads the account's notifications.

## Steps

### 1. Check the tools

```bash
node -v; pnpm -v; git --version; python3 --version; tmux -V; gh --version | head -1; jq --version; dsh --version
```

| Tool | Required | If missing |
| --- | --- | --- |
| Node.js | 24+ | Ask the operator to install it with the version manager they use |
| pnpm | Any version; the repository switches to its pinned version | `npm install -g pnpm` |
| git | 2.32+ | macOS: `brew install git` |
| Python | 3.8+ | macOS: `brew install python` |
| tmux | 3.2+ | macOS: `brew install tmux` |
| GitHub CLI | 2.48+ | macOS: `brew install gh` |
| jq | 1.6+ | macOS: `brew install jq` |
| DSH | Tested with 0.2.1-rc.5 | `npm install -g @deepseek-ai/dsh@0.2.1-rc.5`. If the DeepSeek Harness desktop app is installed, the `dsh` command is already there |

List the missing tools for the operator and install them only after they agree. If the repository uses Git LFS, `git-lfs` is needed too.

### 2. [Operator] Prepare the account and repository

Send this to the operator:

1. Create a GitHub account for the agent (`<agent-login>`).
2. If there is no repository yet, create `<owner>/<repo>`. A private sandbox repository is a good start.
3. In the repository's Settings → Collaborators, invite `<agent-login>` with Write access.
4. Sign in as `<agent-login>` and accept the invitation.

Continue once the operator confirms.

### 3. Set up the agent's GitHub CLI

**Check:**

```bash
"$HOME/.local/bin/gh-agent" api user --jq .login
```

Passes if it prints `<agent-login>`. If it passes, skip to "Verify".

**Run:** write a wrapper that only uses the agent's credentials. It holds the full path to `gh`, because the service's PATH may differ from the current terminal's.

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/gh-agent" <<EOF
#!/bin/sh
export GH_CONFIG_DIR="\$HOME/.config/gh-agent"
exec "$(command -v gh)" "\$@"
EOF
chmod +x "$HOME/.local/bin/gh-agent"
```

**[Operator]** In their own terminal, run the command below and sign in with the **agent's account**, not their own:

```bash
~/.local/bin/gh-agent auth login
```

**Verify:**

```bash
"$HOME/.local/bin/gh-agent" api user --jq .login
"$HOME/.local/bin/gh-agent" api repos/<owner>/<repo> --jq .permissions.push
```

Passes if the first line is `<agent-login>` and the second is `true`.

### 4. Set up the model

**Check:** this calls the model once and costs very little.

```bash
cd "$HOME" && dsh headless "reply with exactly: ok"
```

Passes if it prints `ok`.

**If it fails:**

- `MISSING_CREDENTIAL`: no key is set up yet. DSH uses the official DeepSeek API by default. Let the operator choose:
  - **Official DeepSeek API:** [Operator] edit `~/.dsh/.env`, add the line `DEEPSEEK_API_KEY=<key>`, then run `chmod 600 ~/.dsh/.env`. Then run the check again.
  - **Another OpenAI-compatible model:** [Operator] edit `~/.dsh/.env`, add the line `<KEY variable name>=<key>`, then run `chmod 600 ~/.dsh/.env`. Ask the operator for the provider name, the API base URL and the model id (none of these are secrets); they go into the configuration in step 6. In this case skip the check here; step 11 confirms that the model works.
- `AUTH`: the key is wrong. Ask the operator for another one.

### 5. Get the code

dsh-superagent has to be at the commit the console expects, with the patches applied. Both directories must stay at fixed locations, because the profile and the plugins remember these paths.

```bash
[ -d "$HOME/src/dsh-superagent-ui/.git" ] || git clone --recurse-submodules https://github.com/hustnn/dsh-superagent-ui.git "$HOME/src/dsh-superagent-ui"
[ -d "$HOME/src/dsh-superagent/.git" ] || git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git "$HOME/src/dsh-superagent"
cd "$HOME/src/dsh-superagent"
git checkout "$(git -C "$HOME/src/dsh-superagent-ui" rev-parse HEAD:upstream/dsh-superagent-prototype)"
git apply --reverse --check "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch 2>/dev/null || git apply "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
pnpm install && pnpm build
```

**Verify:**

```bash
test -f "$HOME/src/dsh-superagent/lib/client.js" && echo built
git -C "$HOME/src/dsh-superagent" apply --reverse --check "$HOME"/src/dsh-superagent-ui/patches/dsh-superagent/*.patch && echo patched
```

Passes if it prints `built` and `patched`.

### 6. Create the superagent profile

**Check:**

```bash
grep -q 'id: dsh-superagent' "$HOME/.dsh/profiles/superagent/cordis.patch.yml" 2>/dev/null && echo exists
```

If it prints `exists`, skip this step and **do not** run the commands below. If another model is needed in that case, only append the model configuration to the existing file.

**Run:**

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

Only when using another OpenAI-compatible model, append this as well:

```bash
cat >> "$HOME/.dsh/profiles/superagent/cordis.patch.yml" <<'EOF'
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      <provider>:
        apiKeyEnv: <KEY variable name>
        api: openai-completions
        baseURL: <API base URL>
        models:
          - id: <model id>
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: <provider>
    model: <model id>
EOF
```

### 7. Clone the repository locally

Each Ticket gets its own worktree from this clone.

```bash
[ -d "$HOME/src/<repo>/.git" ] || "$HOME/.local/bin/gh-agent" repo clone <owner>/<repo> "$HOME/src/<repo>"
```

If `$HOME/src/<repo>` is already used by another project, ask the operator for another directory and use the same path for `CLONE` in step 9.

### 8. Start dsh-superagent

```bash
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent start
```

Passes if, on the first start, the exit code is 3 and `setup.code` in the output is `repositoryUnset`. That means the service is running and waiting for configuration. Exit code 0 means it was already configured.

The service runs in the tmux session `dsh-superagent`. For what the exit codes mean, see [Operations](../operations.en.md#dsh-superagent).

### 9. Save the settings

All three settings are saved through the local admin API.

**GitHub source:** saving checks the account and push access; if the check passes, the service restarts.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg repo '<owner>/<repo>' --arg cli "$HOME/.local/bin/gh-agent" \
      '.sources[] | select(.id == "github") | {value: {enabled: true, config: (.value.config + {repository: $repo, cli: $cli})}, revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/source:github" -d @-
```

Passes if it returns `"saved":true`. On a 400, the `setup` field gives the reason.

Wait for the restart to finish:

```bash
cd "$HOME/src/dsh-superagent"
for i in $(seq 1 40); do scripts/dsh-superagent status > /dev/null 2>&1; code=$?; [ "$code" != 1 ] && break; sleep 3; done; echo "status exit: $code"
```

Passes if it prints `status exit: 0`.

**Allow list:** only people on the list can give the agent work. With an empty list it accepts no requests.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" \
  | jq --arg login '<operator-login>' \
      '{value: (.blocks.policy.value | .sources.github.allowed = (((.sources.github.allowed // []) + [{id: $login}]) | unique_by(.id))), revision: .blocks.policy.revision}' \
  | curl -s -X PUT -H "$h" -H 'content-type: application/json' "$api/settings/policy" -d @-
```

**prepare command:** runs once before a Ticket's first dispatch and creates its own worktree. If step 7 used another directory, change `CLONE`.

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

**Verify:**

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/settings" | jq '{allowed: .blocks.policy.value.sources.github.allowed, prepare: .blocks.executor.value.prepare, github: (.sources[] | select(.id == "github") | .value.config | {repository, cli})}'
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent status
```

Passes if all three settings show the values just saved, `status` exits 0, `setup` is `null` and `errors` is empty.

### 10. Install the console

Build first, then install the companion plugin. The order matters: a plugin installed before the build cannot load. The companion lets the console show each step a worker takes and the messages it sends.

```bash
cd "$HOME/src/dsh-superagent-ui" && pnpm install && pnpm build
dsh plugin --profile superagent add "file:$HOME/src/dsh-superagent-ui/packages/companion"
cd "$HOME/src/dsh-superagent" && scripts/dsh-superagent restart
curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info
```

Passes if the last line returns `{"name":"@dsh-superagent-ui/companion",…}`.

Start the console. `-e "PATH=$PATH"` lets tmux find pnpm and Node 24:

```bash
tmux has-session -t dsh-superagent-ui 2>/dev/null || tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd "$HOME/src/dsh-superagent-ui" && pnpm start'
cd "$HOME/src/dsh-superagent-ui" && pnpm --silent console:url
```

Passes if it prints `http://127.0.0.1:3090/?token=…`. Send the link to the operator.

### 11. Try it

**[Operator]** Using their own account (not the agent's), open a new Issue in `<owner>/<repo>`, or comment on an existing one:

```text
@<agent-login> Add a short project description to the README and open a PR for me
```

It has to be a new Issue or a new comment. An @ mention added by editing an existing Issue's body is not picked up.

**Verify:** by default GitHub is checked once a minute, so the message can take up to about a minute to arrive.

```bash
api=http://127.0.0.1:3082/orchestrator/api; h='x-orchestrator-request: 1'
curl -s -H "$h" "$api/tickets?state=open&limit=5" | jq '[.items[] | {id, title, stage, action}]'
```

Passes if a Ticket appears, the agent replies on GitHub, and then opens a PR. The console's home page and Ticket page show the whole history too.

If nothing happens, see [Troubleshooting](../operations.en.md#troubleshooting).

## Done when

- [ ] `scripts/dsh-superagent status` exits 0 and `errors` is empty
- [ ] The console opens, the Health page (健康) shows GitHub as working, and the companion plugin shows as installed
- [ ] The first request created a Ticket, and the agent replied on GitHub and opened a PR

## Hand over to the operator

When the install is done, tell the operator in one short message:

- **Console:** the link, and that later it opens with `cd ~/src/dsh-superagent-ui && pnpm console:url`.
- **Usage:** people on the allow list @ `<agent-login>` in the repository; anything that needs the operator shows up on the console's home page.
- **Merging:** by default a person merges PRs; the agent does not merge on its own. This and commit attribution can be changed under Delivery requirements on the Prompts page (提示词).
- **Letting go:** proactive work starts in "observe" mode, which only records and does not act. Review its judgments on the Calibration page (校准) first, then decide whether to let it act.
- **Restarts:** neither the service nor the console starts on boot; see [Operations](../operations.en.md).
- **Feishu:** to add Feishu, give the agent the "Add Feishu" prompt from the README.
