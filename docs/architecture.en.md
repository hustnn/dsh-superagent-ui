[中文](architecture.md) | English

# Architecture

```
Browser (apps/console) ──HTTP + SSE──▶ BFF (apps/bff, 127.0.0.1:3090) ──HTTP──▶ dsh-superagent (127.0.0.1:3082/orchestrator/api)
                                         └─ data directory: token, session key, audit log
```

## Why a BFF

Upstream's admin API only accepts requests whose Host is `127.0.0.1:<port>` or `localhost:<port>`, that carry `x-orchestrator-request: 1`, and that have no foreign Origin (`sameOrigin` in upstream's `src/app/http.ts`). A separate page in the browser can't call it across ports, so the BFF calls it instead.

The BFF is not a pass-through proxy. It shapes upstream records into the views each page needs (`packages/contract`), and the browser only knows that contract. As a result:

- changes to upstream fields only affect the BFF's mapping, not the pages;
- a future phone client gets compact, stable views without changes to dsh-superagent;
- the console's own data (audit log, calibration labels, snapshots) has a place to live without writing to upstream's database.

Upstream API types are mirrored by hand in `apps/bff/src/upstream/types.ts`, matching the submodule's current commit (`8c32a9d`). Only fields the console uses are listed. The built-in mock (`apps/bff/src/mock`) answers with the same shapes and runs the same same-origin checks as upstream, so tests go through the real HTTP path.

## Security model (local access mode)

The proxy removes the same-origin protection upstream puts around the agent, and the agent can run commands as your system user, so the BFF puts the protection back itself:

1. **Binds to 127.0.0.1 only.**
2. **Trust check** (`security/trust.ts`): the Host must be the BFF's own loopback address (against DNS rebinding); a browser's Origin must be the BFF itself or a configured dev origin; `sec-fetch-site: cross-site` is always rejected.
3. **Startup token for a session** (`security/session.ts`): the BFF prints a link with a token; the console exchanges it for a signed HttpOnly, SameSite=Strict cookie valid for 7 days, then removes the token from the address bar. The token and signing key live in the data directory (mode 0600), so a restart doesn't invalidate open pages.
4. **Requests that change something must carry `x-console-request: 1`,** which a cross-site form can't send.

## Risk levels and audit

Each route declares its risk level when it is registered (`server.ts`):

| Level | Examples |
| --- | --- |
| `read` | Home, Health, live events |
| `low` | Retry a Ticket, re-evaluate, dismiss an evaluation problem, sync the allow list, refresh the group list, calibration labels, recompute directory sizes |
| `high` | Stop a Ticket (revokes its mandate), pause or resume processing, unsubscribe from a thread, save policy (allow lists, admission table, rules, proactive mode), save prompts, save a source's intake settings, evaluation time limit and model, switch the running main Session's model, apply a recipe, re-check the configuration (restarts dsh-superagent) |
| `local-only` | Execution settings (the prepare command amounts to running commands on this machine); source accounts (which CLI runs with the agent's credentials); revealing a directory in Finder (the window opens on the BFF's machine); adding devices in future |

The access mode (`security/access.ts`) decides by level whether to allow a request. Local mode allows everything, but every operation above `read` is written to the audit log (`audit.ts`, `node:sqlite`), and the Health page shows recent entries. Tests make sure every route that changes something is above `read`.

## Views and routes

| Route | View | Upstream source |
| --- | --- | --- |
| `GET /api/home` | Home | `state`, `overview`, `tickets` |
| `GET /api/board` | Board | `state`, `overview`, `tickets?state=open`, `tickets?state=ended` |
| `GET /api/tickets/:id` | Ticket workbench | `tickets/:id` (Mandate, Decision, Assignment, Input, execution variables) |
| `GET /api/threads?filter=` | Thread list | `threads` |
| `GET /api/thread?key=&around=` | Thread page, with each message's path | `threads/:key` |
| `GET /api/search?q=` | Message path search | `search` |
| `GET /api/health` | Health | `state`, `overview`, `sources` |
| `GET /api/policy`, `PUT /api/policy` | Policy | `settings`, `policy/history`, plus the page of each open Ticket (for its Mandate basis, to preview impact); saving goes through `PUT settings/policy` and `PUT settings/eval` |
| `GET /api/calibration`, `POST /api/calibration/:id` | Calibration | `settings`, `decisions?kind=ignore,accept` (the last two weeks of proactive judgments), plus labels from the console's database |
| `GET /api/prompts`, `PUT /api/prompts`, `POST /api/prompts/preview` | Prompts | `prompts` (optionally with `revision`), `PUT prompts` (with `baseRevision`), `prompts/preview` |
| `GET /api/sources`, `PUT /api/sources/:id` | Sources | `settings`, `sources`, `state`; saving goes through `PUT settings/source:<id>` and only changes intake settings, keeping account and CLI fields as they are |
| `GET /api/execution`, `PUT /api/execution`, `PUT /api/eval` | Execution | `settings` (executor block, eval block, execution variables), `models` |
| `GET /api/insights` | Insights | `overview`, `tickets?state=ended`, `decisions?kind=ignore`, plus hourly samples from the console's database |
| `GET /api/recipes`, `POST /api/recipes/:id/preview|apply` | Recipes | `settings`, `prompts`; applying saves sources, policy and prompts in turn, each with the revision it read |

Thread keys contain `/` and `:`, so they go in query parameters rather than the path.

A message's path (`messagePath` in `views/threads.ts`) is derived from the disposition upstream recorded and the Decision that consumed it: whether the source filtered it, which Tickets it went to, whether a worker decided directly, whether it was handed back, whether it is queued or being evaluated, and finally accepted, would have accepted (observe mode), ignored, stopped, or evaluation incomplete. The Chinese wording of reason codes follows upstream's own panel (`views/reasons.ts`).

## Saving policy

The console edits a draft. The BFF merges the draft into the stored policy block: admission cells that didn't change aren't written, and fields the console doesn't know (for example the groups a Feishu allow list syncs from) are kept as they are, so an unchanged draft doesn't create a new version. Saving carries the revision that was read; if someone else (the main Session, allow-list sync, another page) saved in the meantime, upstream rejects it, the BFF returns 409, and the console asks you to reload.

The impact preview before saving is computed in the page (`apps/console/src/impact.ts`) with the same rules as upstream's `policyEffects`: the rule a Ticket relies on changed or was disabled, the requester is no longer on the allow list, or proactive work is no longer accepted. Upstream only notifies those Tickets; it doesn't cancel them.

## The console's own data

`console.db` in the data directory (SQLite, migrated by `user_version` in `apps/bff/src/db.ts`) only holds what upstream doesn't have:

- Audit log: every non-read operation the console started.
- Calibration labels: what you thought of each proactive judgment, and the rule it matched when you labelled it. Upstream only records "would have accepted"; only the console knows whether you agree, so a rule's agreement rate can span any length of observation.
- Hourly status samples: upstream only reports how many Tickets are waiting on a person, queued or running right now. While the BFF runs, it records this every 15 minutes (deduplicated by hour), and the 7-day trend on the Insights page comes from here.

With mock data a separate `console-mock.db` is used, so sample data never mixes with a real deployment's records.

## Recipes

A recipe first computes a plan against the current settings (`apps/bff/src/views/recipes.ts`): each step adds a line only if it would actually change something, so an empty plan means everything is already set. Applying saves sources, policy and prompts in that order, each with the revision it read. If any block was changed elsewhere, that save returns 409; blocks already saved aren't rolled back, and the page asks you to reload before applying again (the remaining changes are computed as usual). A recipe never changes the proactive mode.

## Live updates

Upstream can only be polled. While at least one page is connected, the BFF reads upstream every 2 seconds, fingerprints the data each view depends on, and when something changes tells the pages over SSE (`GET /api/events`) which views changed. The pages then fetch again themselves.

Events carry no data, so after a reconnect a page just refetches every view; nothing needs to be replayed. After running an operation, the BFF polls again immediately, so pages don't wait for the next cycle.

When upstream can't be reached, isn't loaded or rejects requests, the BFF pushes the connection state and the page shows a matching notice (`UPSTREAM` in `text.ts`).

## Prepared for remote access (M4)

- **The BFF is the only entry point:** the browser never talks to dsh-superagent or DSH Web directly.
- **Pluggable access modes:** a tailnet mode only needs to implement `AccessMode`: allow `read` and `low`, require a fresh passkey check for `high`, and reject `local-only`. Routes don't change.
- **Audit from day one:** remote access will need to answer "who did what, when", and the records already hold actor, level, action, target and result.
- **Views designed for narrow screens:** no actions that only appear on hover, and lists and details collapse to one column on narrow screens.
- **Core information doesn't depend on DSH Web:** DSH Web needs its own token to open, and the console doesn't hold it. The companion reads each worker step and shows it under "What the worker is doing" in the Ticket workbench; the "View worker" button jumps to that tab.

## The companion plugin (M3a)

Upstream's admin API doesn't provide three things the console needs: worker Session records, every message the agent sends, and switching the running main Session's model. `packages/companion` is a DSH plugin installed in the same profile as dsh-superagent, serving `/superagent-ui/api/` from the same DSH Web server:

```
BFF ──HTTP──▶ DSH Web (127.0.0.1:3082)
               ├─ /orchestrator/api/   dsh-superagent's admin API
               └─ /superagent-ui/api/  companion: info, transcript/<session>, outbox?ticket=, outbox/summary, main-session/model (POST)
```

- **Injected services:** `orchestrator` (dsh-superagent's Runtime, which Source plugins also use to register sources), `webServer` (registers routes), `sessionPersistence` (opens a Session's event log read-only, without disturbing the writer), and `sessionController` and `agentDefaultModel` (switching the model). These interfaces are mirrored by hand in `packages/companion/src/host.ts`, the same way the BFF mirrors the admin API.
- **Reads are read-only:** session records go through DSH's session storage API, which handles storage format migrations; messages are queried directly from dsh-superagent's `outbox` table with SELECT only.
- **The one write: switching the main Session's model (since 0.3.0).** Upstream only writes a Session's model before its first model call, and the main Session keeps the same one, so upstream's setting never reaches a running main Session. The companion calls DSH's `selectModel` (the same interface as picking a model by hand in the DSH UI), which takes effect from the next model call. `selectModel` also saves the choice as the profile's default model, so the companion then writes the previous default back; only the main Session changes model, and workers left on "default" don't follow. It writes to DSH's Session and profile and never touches dsh-superagent's own data. The BFF calls it when the model setting changes, and so does the button on the Execution page when the setting and the actual model differ (for example a setting saved before an upgrade).
- **The projection lives in the plugin:** the plugin's `src/transcript.ts` turns DSH's event format into readable steps (the work given to it, reasoning, what it said, tool calls and results, turns) and the models used (each model call records its route). Context DSH injects itself (instructions, runtime environment, skill list, time) doesn't count as work given to it. The BFF only handles the Chinese wording and reads dsh-superagent's dispatch JSON as "dispatch / new message".
- **Same-origin rules:** like the admin API, only loopback Hosts are accepted and the `x-superagent-ui-request: 1` header is required.
- **Optional:** without it, DSH returns an empty 404 for these paths, the BFF treats that as "not installed", and the relevant places show an install hint. Companion errors never mark dsh-superagent as unreachable.
- **Messages have no time:** upstream's send records carry no timestamp, so message volume is counted per Ticket, with the Ticket's time defining the period (the Insights page uses Tickets opened or ended in the last 30 days).
- **The mock runs the real code:** the mock dsh-superagent answers these paths with the companion's own `answer()`, backed by an in-memory event log and `outbox` table, so development and tests run the real projection code.

## Working directories

Each Ticket has one directory (under the execution root, which upstream calls `execution.directory`). Threads and Tickets are many-to-many: a thread can open several Tickets and so map to several directories, and a Ticket can follow several threads. So the page lists directories by Ticket, not by thread.

- **The BFF reads the file system directly:** upstream's admin API only gives each Ticket's directory path; the BFF reads sizes and file lists itself, without the companion. This relies on the BFF and dsh-superagent being on the same machine.
- **Sizes are computed in the background:** a directory can hold hundreds of thousands of files (500,000 files took over ten seconds in testing), so `apps/bff/src/disk.ts` runs `du` in the background, at most two at a time, and caches results in memory. An ended Ticket is only recomputed after it is resumed; an open one at most every 5 minutes, or on demand. The cache goes four folder levels deep; deeper levels are computed when opened.
- **Paths stay inside the directory:** a path from the console has its symbolic links resolved first, then is checked to still be inside the directory; links pointing outside are shown but can't be entered.
- **Read-only:** this version deletes nothing. Revealing in Finder uses `open -R`, which selects without opening, so a folder that is actually an app isn't launched.

## Known limits

- Upstream types are mirrored by hand and need checking by a person when the submodule moves. A future check could install upstream's dependencies and compare types.
- "Waiting for" is estimated from the Ticket's `updatedAt`, which in nearly all cases is when it started waiting on a person.
- `scripts/dev.ts` and the root scripts run TypeScript directly with Node, which needs Node 24+.
- Each time the companion reads a session record it reads the whole event log, then projects and paginates. Very long Sessions (thousands of steps) are slower; this could change to reading by offset when needed.
