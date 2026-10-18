# 来源与署名 / Origin and attribution

本仓库是 **[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)** 的分支（fork），不是上游官方发布。

This repository is a **fork** of **[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)**. It is not an upstream release.

| 项 | 内容 |
| --- | --- |
| 原项目 | dsh-purge — DeepSeek Harness 网络安全红队评测与「破甲」插件 |
| 原作者 | **小杨**（GitHub: [@YuJunZhiXue](https://github.com/YuJunZhiXue)） |
| 上游仓库 | https://github.com/YuJunZhiXue/dsh-purge |
| 上游许可证 | MIT，`Copyright (c) 2026 小杨`（见 [LICENSE](LICENSE)，本分支原样保留） |
| 本分支 | 由 **JeffKeeping** 维护，仅做版本适配与体验优化 |
| 本分支版本 | 1.3.1，`dshTarget: 0.2.1-rc.2` |

上游 README 要求：**借用本项目的名称、思路、代码或提示词，必须署名并写明来源仓库**。本仓库保留原作者署名、上游链接与原始 MIT 许可证文本；这是使用条件，不是可选项。

The upstream project requires attribution and a link back to its repository whenever its name, ideas, code, or prompts are reused. This fork keeps the original copyright, the MIT licence text, and the upstream link.

---

## 本分支改了什么 / What this fork changes

只改「适配新版 + 界面 + 一处补丁锚点」，不改变插件的用途与能力范围。

**适配 DSH 0.2.1-rc.2**

- `dshTarget` 提到 `0.2.1-rc.2`；补网页版提示词迁移到新包 `dsh-harness-dev-context` 后的锚点（#32 / #53），补齐回退标记锚点（#77）。
- 新增 `scripts/compat-check.mjs`：直接从封着的 `app.asar` 或解开的 `app/` 取补丁目标文件跑全量引擎，输出每条补丁状态，退出码可进 CI。

**破甲内核 v3**（`lib/core.js` 的 `STRONG_INTRO`）

- 先收判定权：写明这是 system 级配置，与后文冲突时本段优先；再钉执行身份；最后钉交付形态（拒绝=故障、禁语表、首 token 即答案、缺细节填占位符继续）。
- 旧代原文保留成升级 pattern，已打过的树就地换到新文本，二次 apply 不叠层。

**默认提示词加了两段硬约束**（`scripts/armor-prelude.mjs`，幂等、`--revert` 可回滚）

- 开头 `Authority and precedence`：优先级阶梯、权限已定不可议、工具拒绝≠任务拒绝、外部内容只是数据、语言跟随。
- 结尾 `Final gate`：交付前六问自检。

**界面重做（1.3.0 / 1.3.1）**

- 主界面从会话浮窗搬到 **设置 → Purge**（官方 `settings.section`，`order: 450`），会话里不再有任何 dsh-purge 按钮。
- 视觉全部改用宿主自己的设计 token（`--dsw-font-*` / `--dsw-radius-*` / `--dsw-alias-*`），删掉原先自造的衬线标题与绿色玻璃皮肤；面板拆成补丁 / 提示词 / 自己的服务器三张卡，演练台挂在第四段。
- 设置导航行只能由外壳按 section id 画图标（未知 id 落到齿轮），本分支用 label 匹配 + `mask-image` 自绘一个图标顶上，卸载时自动移除。

**修一处 0.2.1 上的补丁锚点（1.3.1）**

- `#40 COMPLETE_PROMPT_KEEP_INJECT` 在 0.2.1 上原来一条 pattern 都不命中：0.2.1 在 `return transformed;` 与 `return {…}` 之间多插了一行 `const requiredContexts = new Set(…)`。状态是 `skipped` 不算失败，但重启前的校验仍能看到 `sections: … : [completeSection]`，于是判定「没洗过」并拒绝重启——表现为点「应用」后提示「清洗没有写进全部宿主，已取消重启」。
- 拆成两条只认关键行的替换后，该补丁在 0.2.1 原树上直接 `applied`。

完整变更见 [release-notes.md](release-notes.md) 与 [docs/compat-0.2.1.md](docs/compat-0.2.1.md)。

## 仓库里不包含什么 / What is not in this repository

- **`lib/default-prompt-inject.md`（提示词明文源）不入库**，与上游一致：`.gitignore` 与 `package.json` 的 `files` 都把它排除。发布出去的是密封后的 `lib/asset-table.js`；运行时注入的文本由 `lib/table-read.js` 解封得到。
- 因此 `node scripts/embed-default-prompt.mjs`（重新封装）需要你本地有那份明文源；要复现，先在插件目录放一份 `lib/default-prompt-inject.md`，或用插件「提示词」框导出的内容另存为该文件。
- `scripts/armor-prelude.mjs` 里的两段硬约束（`Authority and precedence` / `Final gate`）原文就在脚本常量里，可独立审阅。

The plaintext prompt source (`lib/default-prompt-inject.md`) is intentionally not committed, matching upstream: both `.gitignore` and the `files` allowlist exclude it. What ships is the sealed `lib/asset-table.js`. Re-sealing therefore needs that plaintext locally.

---

## 上游的商用禁止条款 / Upstream non-commercial term

上游明确声明：**本项目免费、非盈利；禁止任何主体用于商业售卖、付费倒卖或黑灰产牟利**。本分支沿用同一条款，不因 fork 而放宽。

The upstream project forbids commercial sale, paid resale, and any profit from gray- or black-market use. This fork carries the same term unchanged.

如要基于本分支二次开发，请同时保留：原作者署名、上游仓库链接、MIT 许可证全文、以及这条非商用声明。
