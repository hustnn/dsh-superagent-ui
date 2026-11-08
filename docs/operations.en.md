[中文](operations.md) | English

# Operations

Starting, stopping, updating, upgrading and troubleshooting after the install. For installing, see [`docs/install/`](install). Paths here use the default locations: console `~/src/dsh-superagent-ui`, service `~/src/dsh-superagent`.

The console UI is in Chinese. Where this page names a page or button, the Chinese label follows in parentheses.

Upstream's full notes are in [`docs/006-deployment.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md).

## dsh-superagent

```bash
cd ~/src/dsh-superagent
scripts/dsh-superagent status      # 0 running; 1 not running; 2 a part has failed (restarting won't help); 3 waiting for configuration
scripts/dsh-superagent restart     # waits up to 5 minutes for busy workers to finish
scripts/dsh-superagent stop
```

- **Logs:** `~/src/dsh-superagent/.artifacts/dsh-superagent-superagent-*.log`. The service runs in the tmux session `dsh-superagent`.
- **Does not start on boot:** after a reboot, run `start` again.
- **Hourly check:** in the DSH profile you normally use (not superagent), have the agent create an hourly scheduled task from the Hourly check prompt in upstream's [`docs/006-deployment.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md). If the service is down, it brings it back with `restart`.

## Console

```bash
tmux attach -t dsh-superagent-ui                  # watch the output; Ctrl-b then d to detach without stopping it
tmux kill-session -t dsh-superagent-ui            # stop
cd ~/src/dsh-superagent-ui && pnpm console:url    # print the link to open it
```

Start:

```bash
tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd ~/src/dsh-superagent-ui && pnpm start'
```

- **Why `-e "PATH=$PATH"`:** commands inside tmux don't read `~/.zshrc`, which is usually where pnpm is added to the PATH.
- **Token:** stored in `~/.dsh-superagent-ui` and kept across restarts. For 7 days the same browser can open `http://127.0.0.1:3090` directly; after that, open it once with the link from `pnpm console:url`.

Update:

```bash
cd ~/src/dsh-superagent-ui && git pull && git submodule update && pnpm install && pnpm build
tmux kill-session -t dsh-superagent-ui; tmux new -d -s dsh-superagent-ui -e "PATH=$PATH" 'cd ~/src/dsh-superagent-ui && pnpm start'
```

If the update changed `packages/companion`, reinstall it as in [Updating the companion](#updating-the-companion). If it changed `upstream/`, upgrade as in [Upgrading dsh-superagent](#upgrading-dsh-superagent).

### Environment variables

The defaults suit a dsh-superagent running on the same machine.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPERAGENT_URL` | `http://127.0.0.1:3082` | Address of the DSH Web server running dsh-superagent; must be the loopback address it listens on |
| `CONSOLE_PORT` | `3090` | BFF port, bound to 127.0.0.1 only |
| `CONSOLE_DATA_DIR` | `~/.dsh-superagent-ui` | Startup token, session key, and the console's own database (audit log, calibration labels, hourly status samples; with mock data it is a separate `console-mock.db`) |
| `CONSOLE_POLL_MS` | `2000` | How often the BFF polls dsh-superagent while a console page is open |
| `CONSOLE_MOCK` | unset | Set to `1` to use the built-in sample data |

## Changing settings in the console

The install guides save settings through the admin API so an agent can run them. A person can change the same settings in the console:

| Setting | Where |
| --- | --- |
| GitHub repository, the agent's CLI | Sources (来源) → GitHub → Account |
| The bot's CLI, groups to listen to | Sources (来源) → Feishu |
| Who can give it work | Policy (策略) → the source → allow list |
| prepare command, concurrency, model | Execution (执行) |
| Commit attribution, auto-merge, PR requirements | Prompts (提示词) → Delivery requirements |

Saving an account or repository checks it first. If the check fails, nothing is saved and the page shows why; if it passes, the service restarts and the page recovers after a dozen seconds or so. If you fixed a problem outside the console (for example signed the CLI in again), click "Check again" (重新检查) on the home or Sources page.

## Disk usage

dsh-superagent never cleans up Ticket working directories; they stay after a Ticket ends. The Directories page (工作目录) in the console shows how much disk each one uses and lets you browse its files level by level. The page is read-only.

To free space, **delete large files inside a directory, not the whole directory**. A new message in a thread can resume an ended Ticket: if its directory is still there, the worker carries on in it; if the whole directory is gone, prepare runs again, `git worktree add -b` fails because the branch already exists, and the Ticket fails. Before deleting, also check the Ticket's conversation to make sure those files were delivered or really aren't needed.

## Upgrading dsh-superagent

The console's hand-copied API types match the commit `upstream/` points at, so the deployment follows that commit rather than upstream's latest code.

```bash
cd ~/src/dsh-superagent
cp ~/.dsh/state/superagent/orchestrator.sqlite ~/.dsh/state/superagent/orchestrator.sqlite.bak   # an older version can't open a database the new one has migrated
git apply --reverse ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
git fetch && git checkout "$(git -C ~/src/dsh-superagent-ui rev-parse HEAD:upstream/dsh-superagent-prototype)"
git apply ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch
pnpm install && pnpm build
scripts/dsh-superagent restart
```

If a patch no longer applies, upstream changed that code. Check whether upstream has fixed the problem; if not, redo the change following the patch's description and update it in `patches/`.

When maintainers move `upstream/`, they also check `apps/bff/src/upstream/types.ts` against upstream.

### Patches

Upstream does not accept PRs at the moment, so the changes we need are kept as patches in [`patches/dsh-superagent/`](../patches/dsh-superagent):

| Patch | What it fixes |
| --- | --- |
| `0001-status-desktop-app.patch` | With `dsh` from the DeepSeek Harness desktop app, the service process is called `DeepSeek Harness` rather than `node`, with a space in the name. Upstream's script then can't see the running service: `status` always reports it as not running (exit code 1), and the hourly check starts a second copy. `dsh` installed from npm is not affected, and the patch is harmless there |

To check whether the patches are applied: `git apply --reverse --check ~/src/dsh-superagent-ui/patches/dsh-superagent/*.patch` succeeds without errors when they are.

## The companion plugin

The companion is a DSH plugin in this repository's `packages/companion`. It is installed into the superagent profile and runs alongside dsh-superagent. It adds what upstream's admin API does not provide:

- **What the worker is doing:** the Ticket workbench shows each step the worker takes: its reasoning, the tools it calls (commands, files read and written, exit codes, durations) and their results, plus the model this Ticket actually used. While the worker runs, it refreshes every 4 seconds.
- **The main Session's model:** the Execution page shows the model the main Session actually uses (since 0.2.0). Saving the model setting switches the running main Session directly, starting from its next model call; workers and the profile's default model stay as they are (since 0.3.0). When the setting and the actual model differ, a button on the Execution page switches it to the configured model. The first call after a switch can't reuse the cache from the earlier conversation; only that one call is affected.
- **What it said:** in each Ticket's conversation, every message the agent sent, still has queued, or dropped.
- **How much it talks:** the Insights page counts acknowledgements, replies and notifications per Ticket, and which Ticket talks the most.

The console works without it; those places then say the companion plugin needs to be installed (装上 companion 插件后可以看到). Install steps are in [step 10 of core.en.md](install/core.en.md#10-install-the-console).

### Updating the companion

When the path hasn't changed, `add` doesn't update the installed copy, so `remove` it first and then `add` it:

```bash
cd ~/src/dsh-superagent-ui
pnpm install && pnpm build
dsh plugin --profile superagent remove @dsh-superagent-ui/companion
dsh plugin --profile superagent add "file:$HOME/src/dsh-superagent-ui/packages/companion"
cd ~/src/dsh-superagent && scripts/dsh-superagent restart
curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info   # should show the new version
```

- **The profile runs a copy but remembers the source path:** `file:` copies the plugin into the profile, and dsh-superagent only runs that copy. But the profile's `package.json` records the source path and reads it again on every later `dsh plugin add` or `remove` in this profile. So install from a clone at a fixed location; if you move it, `add` it again from the new location.
- **Switching the model is the only write:** worker records are opened read-only through DSH's session storage; messages are queried from dsh-superagent's send records with SELECT only. Switching the model goes through DSH's own interface, the same as picking a model by hand in the DSH UI.
- **Same access rules as the admin API:** only loopback addresses, and the `x-superagent-ui-request: 1` header is required.
- **Uninstall:** `dsh plugin --profile superagent remove @dsh-superagent-ui/companion`, then `restart`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `status` says it isn't running, but `http://127.0.0.1:3082` opens | The patch isn't applied; see [Patches](#patches) |
| `git checkout` reports `reference is not a tree` | Upstream rewrote its history, and the commit `upstream/` points at is no longer on an upstream branch. Run `git -C ~/src/dsh-superagent-ui pull && git -C ~/src/dsh-superagent-ui submodule update` first; if that doesn't help, open an Issue |
| Home page says setup isn't finished (配置没完成): the GitHub source has no repository to watch | See [step 9 of core.en.md](install/core.en.md#9-save-the-settings). It is required even when only using Feishu |
| Saving the GitHub source reports missing push access | The agent's account hasn't accepted the repository invitation, or its access isn't Write. Confirm with `~/.local/bin/gh-agent api repos/<owner>/<repo> --jq .permissions.push` |
| No response to an @ mention on GitHub | Check in order: are you on the allow list; is the agent's account the same as yours (it ignores its own posts); was the @ added by editing an Issue body (it needs a new comment); does the Health page show GitHub as working |
| After a restart the source's account check fails, with `exec: gh: not found` (or `lark-cli`) in the details | The CLI path in the wrapper is stale, often after switching Node versions with nvm. Regenerate the wrapper with the full path as in the install guide, then click "Check again" (重新检查) on the Sources page |
| `tmux new-session` fails, or tmux reports `unknown option -- e` | tmux is older than 3.2; upgrade it |
| `The bot lark-cli allows user identities` | The bot's configuration doesn't have `strict-mode bot`, or the source points at your personal `lark-cli`; see [step 2 of feishu.en.md](install/feishu.en.md#2-configure-the-bots-cli) |
| `app_scope_not_applied`, or error 230027 when reading group messages | Missing permissions; see [step 3 of feishu.en.md](install/feishu.en.md#3-operator-grant-permissions) |
| No response to an @ mention in a Feishu group | Check in order: is the bot in the group; is the group in the source's list; are you on the Feishu allow list; does the Health page show Feishu as working |
| Home page keeps saying the allow list is empty (名单是空的) | Add at least one person for Feishu or GitHub under Policy |
| The Feishu console says a permission is restricted by the organization's policy | Ask an organization admin to allow it, or use a narrower permission instead. Do not work around it with a personal identity |
| A worker reports model errors, or evaluations never reach a conclusion | Check the key with `dsh headless "reply with exactly: ok"`. With another provider, check that `~/.dsh/.env` and `apiKeyEnv` in the profile match |
| A Ticket says the companion plugin needs to be installed (装上 companion 插件后可以看到) | Check whether `curl -s -H 'x-superagent-ui-request: 1' http://127.0.0.1:3082/superagent-ui/api/info` responds. If not, reinstall as in [Updating the companion](#updating-the-companion) (`remove` reporting `Cannot remove` means it was never installed; just run `add`) |
| The companion reports a missing module in the logs | The plugin was installed before building. Run `pnpm build` first, then reinstall as in [Updating the companion](#updating-the-companion) |
| The companion is still the old version after an update | When the path hasn't changed, `add` doesn't update the installed copy; `remove` then `add` as in [Updating the companion](#updating-the-companion) |
| The console at `http://127.0.0.1:3090/` returns 404 | It hasn't been built yet; run `pnpm build` |
