中文 | [English](architecture.en.md)

# 架构

```
浏览器（apps/console） ──HTTP + SSE──▶ BFF（apps/bff，127.0.0.1:3090） ──HTTP──▶ dsh-superagent（127.0.0.1:3082/orchestrator/api）
                                         └─ 数据目录：token、会话密钥、审计日志
```

## 为什么要 BFF

上游的管理 API 只接受 Host 为 `127.0.0.1:<port>` 或 `localhost:<port>`、带 `x-orchestrator-request: 1`、没有外来 Origin 的请求（上游 `src/app/http.ts` 的 `sameOrigin`）。独立页面在浏览器里跨端口调不通，所以由 BFF 代为调用。

BFF 不是透传代理。它把上游记录整理成每个页面需要的视图（`packages/contract`），浏览器只认这份契约。这样：

- 上游字段变化只影响 BFF 的映射，不影响页面；
- 以后手机拿到的是紧凑、稳定的视图，dsh-superagent 不用改；
- 控制台自己的数据（审计、以后的校准标注和快照）有地方存，不写上游的库。

上游 API 的类型手工镜像在 `apps/bff/src/upstream/types.ts`，对应 submodule 当前的提交（`8c32a9d`）。只列控制台用到的字段。内置 mock（`apps/bff/src/mock`）用同样的形状回答，并且像上游一样执行同源检查，所以测试走的是真实的 HTTP 路径。

## 安全模型（本地访问模式）

代理会去掉上游包在 agent 外面的同源保护，而 agent 能以你的系统用户身份执行命令，所以 BFF 自己把保护补回来：

1. **只绑定 127.0.0.1。**
2. **信任检查**（`security/trust.ts`）：Host 必须是 BFF 自己的回环地址（防 DNS rebinding）；浏览器带的 Origin 必须是自己或配置的开发 origin；`sec-fetch-site: cross-site` 一律拒绝。
3. **启动 token 换会话**（`security/session.ts`）：BFF 打印带 token 的链接，控制台用它换一个 HttpOnly、SameSite=Strict 的签名 cookie，有效 7 天，然后把 token 从地址栏去掉。token 和签名密钥存在数据目录里（权限 0600），所以重启不会让已打开的页面失效。
4. **改动类请求必须带 `x-console-request: 1`**，跨站表单发不出这个头。

## 风险分级与审计

每个路由在注册时声明风险等级（`server.ts`）：

| 等级 | 例子 |
| --- | --- |
| `read` | 首页、健康、实时事件 |
| `low` | 重试 Ticket、重新评估、忽略评估问题、同步名单、刷新群列表、校准标注、重新计算工作目录的大小 |
| `high` | 停止 Ticket（撤回授权）、暂停或恢复处理、退订线程、保存策略（名单、准入表、规则、主动接单模式）、保存提示词、保存来源的接收设置、评估时限和模型、切换正在运行的主 Session 的模型、启用场景配方、重新检查配置（会重启 dsh-superagent） |
| `local-only` | 执行设置（prepare 命令等于在本机执行命令）；来源账号（哪个 CLI 带着 agent 的凭据运行）；在访达中显示工作目录（窗口开在 BFF 所在的机器上）；以后的添加设备 |

访问模式（`security/access.ts`）按等级决定放不放行。本地模式全部放行，但所有非 `read` 的操作都写审计日志（`audit.ts`，`node:sqlite`），健康页能看到最近的记录。测试保证每个改动类路由的等级都高于 `read`。

## 视图与路由

| 路由 | 视图 | 上游来源 |
| --- | --- | --- |
| `GET /api/home` | 首页 | `state`、`overview`、`tickets` |
| `GET /api/board` | 看板 | `state`、`overview`、`tickets?state=open`、`tickets?state=ended` |
| `GET /api/tickets/:id` | Ticket 工作台 | `tickets/:id`（Mandate、Decision、Assignment、Input、执行变量） |
| `GET /api/threads?filter=` | 线程列表 | `threads` |
| `GET /api/thread?key=&around=` | 线程页，每条消息带去向 | `threads/:key` |
| `GET /api/search?q=` | 消息去向的搜索 | `search` |
| `GET /api/health` | 健康 | `state`、`overview`、`sources` |
| `GET /api/policy`、`PUT /api/policy` | 策略 | `settings`、`policy/history`，以及每个进行中 Ticket 的页面（取 Mandate 依据，用来预览影响）；保存走 `PUT settings/policy` 和 `PUT settings/eval` |
| `GET /api/calibration`、`POST /api/calibration/:id` | 校准 | `settings`、`decisions?kind=ignore,accept`（最近两周的主动判断），加上控制台库里的标注 |
| `GET /api/prompts`、`PUT /api/prompts`、`POST /api/prompts/preview` | 提示词 | `prompts`（可带 `revision`）、`PUT prompts`（带 `baseRevision`）、`prompts/preview` |
| `GET /api/sources`、`PUT /api/sources/:id` | 来源 | `settings`、`sources`、`state`；保存走 `PUT settings/source:<id>`，只改接收设置，账号和 CLI 字段原样保留 |
| `GET /api/execution`、`PUT /api/execution`、`PUT /api/eval` | 执行 | `settings`（执行块、评估块、执行变量）、`models` |
| `GET /api/insights` | 洞察 | `overview`、`tickets?state=ended`、`decisions?kind=ignore`，加上控制台库里的每小时采样 |
| `GET /api/recipes`、`POST /api/recipes/:id/preview|apply` | 场景配方 | `settings`、`prompts`；启用时依次保存来源、策略、提示词，各自带读取时的 revision |

线程的 key 里有 `/` 和 `:`，所以放在查询参数里而不是路径里。

一条消息的“去向”（`views/threads.ts` 的 `messagePath`）由上游记录的 disposition 和消费它的 Decision 推出：来源是否过滤、送到了哪些 Ticket、是否由 worker 直接决定、是否被交回、是否在排队或评估中，最后是接单、本会接单（观察模式）、忽略、停止或评估没完成。原因码的中文沿用上游面板自己的措辞（`views/reasons.ts`）。

## 策略的保存

控制台编辑的是一份草稿。BFF 把草稿合并进当前存的策略块：草稿里没变的准入格子不写，控制台不认识的字段（例如飞书名单同步的群）原样保留，所以没改的草稿不会生成新版本。保存时带上读取时的 revision，别人（主 Session、名单同步、另一个页面）在这期间保存过，上游会拒绝，BFF 回 409，控制台提示重新载入。

保存前的影响预览在页面里算（`apps/console/src/impact.ts`），规则与上游的 `policyEffects` 一致：Ticket 依据的规则改了或停用了、发起人不在名单了、不再接受主动工作。上游只通知这些 Ticket，不取消它们。

## 控制台自己的数据

数据目录里的 `console.db`（SQLite，`apps/bff/src/db.ts` 按 `user_version` 迁移）只放上游没有的东西：

- 审计日志：控制台发起的每个非读操作；
- 校准标注：你对每条主动判断的看法，以及标注时它命中的规则。上游只记录“本会接单”，只有控制台知道你同不同意，所以规则的一致率可以跨越任意长的观察期。

- 每小时的状态采样：上游只报告“现在”有多少 Ticket 在等人、排队、运行，BFF 运行时每 15 分钟记一次（按小时去重），洞察页的 7 天趋势就来自这里。

用 mock 时用单独的 `console-mock.db`，示例数据不会混进真实部署的记录。

## 场景配方

一个配方先在当前设置上算出计划（`apps/bff/src/views/recipes.ts`）：每一步只在真的会改东西时记一句话，所以计划为空就说明已经配好了。启用时按来源、策略、提示词的顺序分别保存，每块都带读取时的 revision；任何一块被别处改过都会 409，已经保存的块不回滚，页面提示重新载入后再启用（剩下的改动会照常算出来）。配方从不改主动接单模式。

## 实时更新

上游只能轮询。BFF 在至少有一个页面连着时，每 2 秒读一次上游，给每个视图依赖的数据算指纹，变了就通过 SSE（`GET /api/events`）告诉页面“哪些视图变了”。页面收到后自己重新拉取。

事件里不带数据，所以断线重连后页面把所有视图重拉一遍就行，不需要补发。BFF 执行完一个操作会立刻再轮询一次，页面不用等下一个周期。

上游连不上、没加载或拒绝请求时，BFF 推送连接状态，页面显示对应的提示（`text.ts` 的 `UPSTREAM`）。

## 为远程访问预留的部分（M4）

- **BFF 是唯一入口**：浏览器从不直接访问 dsh-superagent 或 DSH Web。
- **访问模式可插拔**：tailnet 模式只要实现 `AccessMode`：`read`、`low` 放行，`high` 要求重新做一次 passkey 验证，`local-only` 拒绝。路由不用改。
- **审计从第一天开始**：远程以后要回答“谁在什么时候做了什么”，现在的记录已经包含主体、等级、动作、对象、结果。
- **视图为窄屏设计**：没有只能悬停触发的操作，列表和详情在窄屏上收成一栏。
- **核心信息不依赖 DSH Web**：DSH Web 要带它自己的 token 才能打开，控制台不持有这个 token。worker 的每一步由 companion 读出、显示在 Ticket 工作台的“worker 在做什么”里，“查看 worker”按钮就是跳到这个标签。

## companion 插件（M3a）

上游的管理 API 不提供三样控制台需要的东西：worker Session 的记录、agent 发出的每条消息，以及切换正在运行的主 Session 的模型。`packages/companion` 是一个 DSH 插件，和 dsh-superagent 装在同一个 profile 里，在同一个 DSH Web 服务器上提供 `/superagent-ui/api/`：

```
BFF ──HTTP──▶ DSH Web（127.0.0.1:3082）
               ├─ /orchestrator/api/   dsh-superagent 的管理 API
               └─ /superagent-ui/api/  companion：info、transcript/<session>、outbox?ticket=、outbox/summary、main-session/model（POST）
```

- **注入的服务：** `orchestrator`（dsh-superagent 的 Runtime，Source 插件也是拿它注册来源）、`webServer`（注册路由）、`sessionPersistence`（以只读方式打开 Session 的事件日志，不影响正在写入的一方）、`sessionController` 和 `agentDefaultModel`（切换模型）。这些接口在 `packages/companion/src/host.ts` 里手工镜像，和 BFF 镜像管理 API 的做法一样。
- **读的部分只读：** 会话记录走 DSH 的会话存储 API，存储格式迁移由 DSH 处理；消息直接查 dsh-superagent 的 `outbox` 表，只执行 SELECT。
- **唯一的写：切换主 Session 的模型（0.3.0 起）。** 上游只在 Session 第一次调用模型前写入它的模型，主 Session 又一直沿用同一个，所以上游的设置到不了正在运行的主 Session。companion 调 DSH 的 `selectModel`（和在 DSH 界面里手动选模型是同一个接口），从下一次模型调用开始生效。`selectModel` 还会把选择存成 profile 的默认模型，companion 随后把原来的默认值存回去，所以只有主 Session 换了模型，留在“默认”上的 worker 不会跟着变。它写的是 DSH 的 Session 和 profile，不碰 dsh-superagent 自己的数据。BFF 在模型设置变化时调用它；设置和实际不一致时（比如设置是升级前保存的），执行页的按钮也调用它。
- **投影在插件里：** DSH 的事件格式由插件 `src/transcript.ts` 转成阅读用的步骤（交给它的工作、思考、说的话、工具调用及结果、轮次）和用过的模型（每次模型调用都记着它的路由），DSH 自己注入的上下文（指令、运行时环境、skill 目录、时间）不算交给它的工作。BFF 只负责中文措辞，以及把 dsh-superagent 派工的 JSON 读成"派工 / 新消息"。
- **同源规则：** 和管理 API 一样，只接受回环地址的 Host，并要求请求头 `x-superagent-ui-request: 1`。
- **可选：** 没装时 DSH 对这些路径回空的 404，BFF 视为"未安装"，相应位置显示安装提示；companion 的错误不会把 dsh-superagent 标成连不上。
- **消息没有时间：** 上游的发送记录不带时间，所以发言量按 Ticket 统计：以 Ticket 的时间划定统计区间（洞察页用近 30 天开过或结束的 Ticket）。
- **mock 用真实代码：** mock 的 dsh-superagent 用 companion 自己的 `answer()` 处理这些路径，背后是内存里的事件日志和 `outbox` 表，开发和测试跑的都是真实的投影代码。

## 工作目录

一个 Ticket 一个目录（在执行根目录下，上游叫 `execution.directory`）。线程和 Ticket 是多对多：一个线程里可以开多个 Ticket，也就对应多个目录；一个 Ticket 也可以跟多个线程。所以页面按 Ticket 列目录，不按线程。

- **BFF 直接读文件系统：** 上游的管理 API 只给出每个 Ticket 的目录路径，大小和文件列表由 BFF 自己读，不经过 companion。这依赖 BFF 和 dsh-superagent 在同一台机器上。
- **大小在后台计算：** 一个目录可能有几十万个文件（实测 50 万个文件要算十几秒），所以 `apps/bff/src/disk.ts` 用 `du` 在后台计算，同时最多两个，结果缓存在内存里。已结束的 Ticket 只在被恢复后才重算，进行中的最多隔 5 分钟重算一次，也可以手动重新计算。缓存记到第 4 层文件夹，更深的打开时现算。
- **路径不出目录：** 控制台传来的路径先解析符号链接，再检查是否还在这个目录里；指向外面的链接只显示，不能进入。
- **只看不改：** 这一版不删除任何文件。在访达中显示用 `open -R`，只选中不打开，文件夹其实是 app 时也不会被启动。

## 已知限制

- 上游类型是手工镜像的，升级 submodule 时需要人工核对；以后可以加一个安装上游依赖后做类型比对的检查。
- “已等多久”用 Ticket 的 `updatedAt` 估算，绝大多数情况就是它开始等人的时间。
- `scripts/dev.ts` 和根目录脚本用 Node 直接运行 TypeScript，需要 Node 24+。
- companion 每次读会话记录都会读整份事件日志再投影、分页。记录很长的 Session（上千步）会慢一些，需要时可以改成按偏移量读取。
