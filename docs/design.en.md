[中文](design.md) | English

# Design

This document describes what the console should be and why. To see it in action, run it with sample data by following the [preview guide](install/preview.en.md).

## Who it is for

The console is for the operator: the person who deploys dsh-superagent and answers for what it says. Team members deal with the agent in GitHub and Feishu and don't need a new interface.

That sets one boundary: **the agent looks after the team's attention in the original channels; the console looks after the operator's attention.** The console doesn't repeat what the agent already said in a channel, and only raises system-level problems.

## Where the value comes from

> Its value = the useful work it gets done − the attention it takes (the team's + yours)

The prototype already handles concurrency, routing, context and failure recovery at the system level. What still holds the value back is on the human side:

1. How fast you respond: every moment a Ticket waits for your answer or review is output lost.
2. Whether you dare let it act on its own: proactivity has the highest ceiling of a super agent's value, but the prototype requires starting in observe mode.
3. Whether you can correct it right away when it gets something wrong: behaviour lives in prompts, and the prompt version each Session used is recorded.
4. Whether you can understand it: you won't hand over control to something you don't understand.
5. Whether you can discover what else it can do: many abilities are scattered across different settings blocks.

## Six loops

| Loop | How often | The operator's question | Page |
| --- | --- | --- | --- |
| Unblock | Several times a day | What is waiting on me? | Home |
| Understand | Any time | Why did it do that? Why did it ignore this message? | Ticket workbench, message path |
| Trust | Weekly | Can I let it act on its own? | Calibration, Insights |
| Tune | When something goes wrong | It's too chatty or went too far; how do I change that? | "This went wrong", Prompts, Policy |
| Extend | Monthly | Who else could use it, and where? | Recipes, blocked requests, Sources |
| Assure | When something is off | Is it still working? | Health |

## Principles

- **Quiet by default.** When everything is fine the home page is almost empty; numbers only appear when they would change what you do, and a count equals the length of the list it links to.
- **Plain words first.** Lists say "waiting for your answer" or "waiting for new messages"; terms like Trigger and Mandate go in the details.
- **Every judgment can be explained.** For any Ticket or ignored message, admission, evaluation, rule and conclusion are one step away.
- **Act where you see it.** Actions are inline, and the fix sits on the same screen as the problem.
- **See the impact before changing.** Before saving policy, rules or prompts, the page lists what they will affect.
- **Start from intent.** Recipes combine scattered abilities into "what I want it to do".
- **Confirm dangerous actions.** Stopping revokes a mandate and pausing halts all dispatch; both are confirmed in the page.
- **Prepared for remote use.** The BFF is the only entry point, every operation has a risk level, and the layout works on narrow screens from the start.

## Pages

| Page | What it does | Phase |
| --- | --- | --- |
| Home | Next step; Tickets that need you, longest-waiting first; system problems | M0 |
| Health | Sources, executor, all problems, pause processing, 24-hour traffic, console operation log | M0 |
| Board | All Tickets by stage (queued, running, needs you, waiting for new messages, recently ended) | M1 |
| Ticket workbench | Request, judgment, dispatch, reports, follow-up messages and ending in one timeline; why it may act; threads it follows; execution details; what the worker is doing and what it said | M1 (tuning entry in M2, worker records and messages in M3a) |
| Message path | Paste a link, `#123` or a few words to see every step a message went through; thread list and thread pages; re-evaluate, unsubscribe | M1 |
| Calibration | Review "would have accepted" judgments, see agreement rate and daily volume by rule, preview switching to automatic | M2 |
| Recipes | Start from intent and set up sources, policy, rules and prompts in one go | M2 |
| Policy | Proactive mode, allow lists, admission matrix, rules, bot list, impact before saving | M2 |
| Prompts | Team sections, skills, built-in overrides, diffs against updated defaults, the full prompt, history | M2 |
| Insights | Time waiting on you, Ticket outcomes, blocked requests, queue time; how much it talks | M2 (message volume in M3a) |
| Sources, Execution | Source configuration, accounts, picking groups the bot is in; concurrency, model, prepare command, deployment limits | M2 (accounts, group picking and deployment limits in M3b) |

## Roadmap

**The current focus: make good use of what dsh-superagent can already do.** Handing out work through Feishu (and later GitHub) is enough for now, so "the console as a source of work" (raising requests and answering the agent's questions in the console) is set aside for later, to be built as a new source when needed.

| Phase | Contents | Needs upstream changes? |
| --- | --- | --- |
| M0 | BFF (local access mode, risk levels, audit), upstream type mirror, mock, SSE, shell, Home, Health | No |
| M1 | Board, Ticket workbench, message path, command palette, all operations. A small plugin to open worker Sessions in DSH Web by URL was postponed, and later replaced by "What the worker is doing" in M3a | No |
| M2a | Calibration (labels stored in the console's own database; agreement rate and daily hits per rule), Policy (allow lists, bot list, admission matrix, rules, proactive mode, impact before saving, change history) | No |
| M2b | Prompts (team sections, skills, built-in section overrides, comparison when defaults change, the full prompt assembled per role, history); "This went wrong?" in the Ticket workbench: pick the problem, see the prompt version the worker used, and add a sentence to the responsible section directly | No |
| M2c | Recipes (silent reproduce-and-fix, support group, dependency upgrade follow-up, new issue triage, cross-platform identity), Insights (time waiting on you, outcomes, blocked requests, capacity and a 7-day trend), Sources (intake switches, Feishu groups), Execution (concurrency, model, directory, prepare, blocked commands, evaluation time limit) | No |
| M3a | Companion plugin (a DSH plugin installed in the superagent profile): "What the worker is doing" (session records, refreshed while running) and "What it said" in the Ticket workbench; message volume in Insights (counted per Ticket, because upstream's send records have no time) | No (separate plugin) |
| M3b | Filling in what upstream already has but the console lacked: re-check configuration (`setup/check`), picking groups the bot is in and refreshing the list (`sources/:id/labels`), changing accounts on the Sources page (repository, the agent's GitHub CLI, the bot's lark-cli; checked before saving, restarted after), read-only deployment limits; setup problems worded as in upstream's panel | No |
| M3c | Switching the running main Session's model on the Execution page: upstream only writes a Session's model before its first model call, so the companion calls DSH's `selectModel` | No (separate plugin) |
| M3d | Directories page: how much disk each Ticket directory uses, browsing its files level by level, revealing in Finder. This version is read-only; deleting first needs an answer for directories and branches when a Ticket is resumed | No |
| M4 | Remote and phone: tailnet access mode, passkey device pairing, PWA, push notifications | No |
| Later | The console as a source of work: raising requests and answering the agent's questions in the console. dsh-superagent lets external plugins register sources (that is how the Feishu source works), so the companion could register one | No (separate plugin) |
