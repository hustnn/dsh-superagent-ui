[中文](preview.md) | English

# Install: preview (sample data)

This guide is written for the agent doing the install; a person can follow it too.

| Item | Details |
| --- | --- |
| Goal | Open the console locally with the built-in sample data |
| Requires | Node.js 24+, pnpm, git |
| Does not need | dsh-superagent, DSH, a GitHub account, a model |
| Changes | Only writes files in `~/src/dsh-superagent-ui` and `~/.dsh-superagent-ui` |

## Rules

1. Go in order. Every code block runs on its own and does not rely on shell state left by an earlier block.
2. If a tool is missing, tell the operator what you would install and install it only after they agree.
3. Send the console link with its token only to the operator. Do not write it into files, logs or tickets.

## Steps

### 1. Check the tools

```bash
node -v; pnpm -v; git --version
```

Passes if Node.js is 24 or later. Any pnpm version works: the repository pins 10.18.3 and switches to it automatically.

- No pnpm: `npm install -g pnpm`.
- No Node.js 24: ask the operator to install it with the version manager they use.

### 2. Get the code and install dependencies

```bash
[ -d "$HOME/src/dsh-superagent-ui/.git" ] || git clone --recurse-submodules https://github.com/hustnn/dsh-superagent-ui.git "$HOME/src/dsh-superagent-ui"
cd "$HOME/src/dsh-superagent-ui" && pnpm install
```

The message `Ignored build scripts: esbuild` is expected and needs no action.

### 3. Start

This is a long-running process; run it in the background:

```bash
cd "$HOME/src/dsh-superagent-ui" && pnpm dev:mock
```

Passes if the output has a line `Superagent 控制台  http://127.0.0.1:5173/?token=…`.

If it reports a port already in use, first check whether a console is already running on this machine (the BFF uses port 3090 by default). Set `CONSOLE_PORT` to use another BFF port.

### 4. Hand over to the operator

Send the link to the operator and tell them:

- Open the link in a browser. The sample data moves one step every 20 seconds, so the pages update live.
- The console UI is in Chinese.
- Anything done here only affects the sample data.
- To use it for real, give the agent the "Connect GitHub" prompt from the README.

To stop, stop this process. The sample data has its own database (`~/.dsh-superagent-ui/console-mock.db`) and never mixes with real data.
