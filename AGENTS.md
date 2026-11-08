# AGENTS.md

## 安装

要帮操作者安装时，读取对应的指南，严格按里面的规则和步骤执行：

| 操作者想要 | 指南 | English |
| --- | --- | --- |
| 用示例数据看效果 | [docs/install/preview.md](docs/install/preview.md) | [preview.en.md](docs/install/preview.en.md) |
| 真正用起来（最小安装，只需要 GitHub） | [docs/install/core.md](docs/install/core.md) | [core.en.md](docs/install/core.en.md) |
| 在 GitHub 之外再接飞书 | [docs/install/feishu.md](docs/install/feishu.md) | [feishu.en.md](docs/install/feishu.en.md) |

中英文两份的步骤相同，按操作者用的语言选一份。安装好之后的启停、升级和排错见 [docs/operations.md](docs/operations.md)（英文：[operations.en.md](docs/operations.en.md)）。

## 开发

- 提交前运行 `pnpm check`（类型检查 + 测试 + 构建）。
- 用 `pnpm dev:mock` 看界面改动，不需要 dsh-superagent。
- `upstream/` 是只读的 submodule，只用来对照接口类型，不要改。对 dsh-superagent 的修改放进 `patches/`。
- 文档都有中英文两份（`x.md` 和 `x.en.md`），改一份时同步改另一份。
- 改安装步骤时，同步更新 `docs/install/` 和 `docs/operations.md`，并在隔离环境里实际运行一遍：`HOME=<临时目录> TMUX_TMPDIR=<短路径> dsh ...`。只换 profile 不算隔离，`~/.dsh/storages` 和 `~/.dsh/sessions` 是所有 profile 共用的。
- 文档、测试数据和提交信息里不要放真实的 App ID、open_id、chat_id、token、内部地址或内部模型名。
