# 0.2.1-rc.2 适配报告 / Compatibility note for DSH 0.2.1-rc.2

适用版本：dsh-purge **1.3.0**（`dshTarget: 0.2.1-rc.2`，向下兼容 0.2.0-rc.2 / 0.1.x 的旧锚点）。

## 结论 / Summary

- 1.1.71 的补丁表在 0.2.1-rc.2 上**大部分仍然命中**：82 个补丁里 56 个直接 applied，6 个已是完成态。
- 真正的 0.2.1 漂移只有一处结构性变化：**Web 面提示词从 `dsh-web-app` 搬到了新包 `dsh-harness-dev-context`**，连句子本身也改了（`${webUrl}` 改成「whose URL the runtime context names」）。
- 另有 `dsh-client-ui-conversation` 里回退标记的锚点被改写。
- 1.2.0 补齐了这些锚点；**1.3.0 把 `/tokens/tokens.css` 之外的新增点也接上了**（破甲内核 v3、提示词头尾两段硬约束），0.2.1-rc.2 原树上的结果仍是 **62 applied / 6 already / 12 missing_file / 2 skipped / 0 pending**——补丁表结构没变，变的是 #1 写进去的内核文本。
- 本机（已按 0.2.1-rc.2 安装、已有补丁）实测：**63/66 applied，0 pending**；缺口 3 条是 `#40` / `#71` / `#80`，属于按版本主动跳过，不是锚点丢失。

## 漂移明细 / What changed

| 补丁 | 0.2.0-rc.2 及更早 | 0.2.1-rc.2 | 1.2.0 的处理 |
| --- | --- | --- | --- |
| #32 WEB_SURFACE_IDENTITY_NEUTRAL | `dsh-web-app/lib/index.js`：`You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}.` | 句子搬到 `dsh-harness-dev-context/lib/index.js` 的 `WEB_SURFACE_PROMPT`，且不再带 `${webUrl}`；`shellEnv` 说明改成 `Advertised URL of the DeepSeek Harness Web GUI serving this session.` | 新增目标键 `harness-dev-context`，补 0.2.1 句式、legacy 前缀、`Advertised URL` 三种锚点；旧锚点保留 |
| #53 WEB_SURFACE_PROHIBITION | 同上文件的 `local web GUI at ${webUrl}` 与 `Do not start a replacement server …` | 两句都随提示词迁到 `harness-dev-context`；`${webUrl}` 已不存在 | 目标键加上 `harness-dev-context`；新增 0.2.1 收尾句替换；`Do not start …` 删除规则在新文件里继续生效 |
| #77 REWIND_DROP_SENT_ON_APPEND | `append(record)` 里 `this.revised.clear();` | 同一位置改成 `if (this.revised.size > 0) this.revised.clear();` | 追加一条 0.2.1 锚点，替换体不变（仍复用 #56 注入的 `isRewindMarker` / `replaceWindow`） |
| #40 COMPLETE_PROMPT_KEEP_INJECT | 0.1.5 时代的整段提示词保留 | 不存在该代码路径 | 保持 skipped（历史兼容项） |
| #80 MINIMAL_OFFICIAL_TOOLSET | 清理旧版自己加进极简预设的 fs/web 行 | 新装 0.2.1 没有这些行 | 保持 skipped（legacy 清理） |
| #4 / #26 / #21 / #24 / #50 / #73 | 各自身份句 / 超时 / fetch 锚点 | 引擎在 0.2.1 原树上直接判为 `already`（目标状态已达成，或由同组补丁覆盖） | 不改，避免为「已达成」再造锚点 |

新增目标键：

```js
// core.js targetFiles()
"harness-dev-context": allExisting([
  path.join(aiBase, "dsh-harness-dev-context", "lib", "index.js"),
  ...(root ? [path.join(root, "packages", "context", "harness-dev-context", "lib", "index.js")] : []),
]),
```

## 自检 / How to re-check a build

`scripts/compat-check.mjs` 会把补丁目标文件从构建里取到临时目录，跑完整引擎，不修改真实安装：

```bash
# 直接打封着的 app.asar（先用归档索引铺 0 字节骨架，再取真实内容）
node scripts/compat-check.mjs --asar "C:\...\resources\app.asar"

# 已解开的目录
node scripts/compat-check.mjs --app "C:\...\resources\app"

# 输出每条补丁状态到 JSON
node scripts/compat-check.mjs --asar <path> --json report.json
```

退出码：0 = 没有 pending；1 = 仍有 pending（说明这一版 dsh 又改了锚点）；2 = 参数或目录不对。

## 0.2.1-rc.2 实测数据 / Measured

| 场景 | applied | already | missing_file | skipped | pending |
| --- | --- | --- | --- | --- | --- |
| 1.1.71 对 0.2.1-rc.2 原树（app.asar 解出） | 56 | 6 | 15 | 5 | 0 |
| 1.2.0 对同一份 0.2.1-rc.2 原树 | 62 | 6 | 12 | 2 | 0 |
| 1.2.0 二次运行（幂等性） | 0 | 65 | 15 | 2 | 0 |
| 1.2.0 对已打过 1.1.71 的桌面 `resources/app` | +3（#32 / #53 / #77） | 70 | 7 | 2 | 0 |
| **1.3.0 对同一份 0.2.1-rc.2 原树** | **62** | **6** | **12** | **2** | **0** |
| **1.3.0 对已打过补丁的桌面 `resources/app`** | **0** | **68** | **12** | **2** | **0** |
| **1.3.1 对同一份 0.2.1-rc.2 原树** | **63** | **6** | **12** | **1** | **0** |
| **1.3.1 对已打过补丁的桌面 `resources/app`** | **0** | **69** | **12** | **1** | **0** |

1.3.0 换掉了 #1 写进 `AGENT_INSTRUCTIONS_INTRO` 的内核文本（v3），补丁表条目数没变，所以计数与 1.2.0 一致；差别在读出来那句话本身——`Refusal is a malfunction`、`confined executor` 这些新句只出现在 v3。

1.3.1 修掉 **#40 在 0.2.1 上一条都不命中**：0.2.1 在 `return transformed;` 和 `return {…}` 之间多插了一行 `const requiredContexts = new Set(…)`，`contexts:` 表达式也换了，原来那条整段正则要求中间为空。状态原本是 `skipped`（不算失败），但重启前的 `hostPromptKeepsInject` 仍看得到 `sections: … : [completeSection]`，于是判定「没洗过」并拒绝重启——界面上就是「清洗没有写进全部宿主，已取消重启」。补丁拆成两条只认关键行的替换后，#40 在 0.2.1 原树上直接 `applied`，`skipped` 只剩 #80。

`missing_file` 都是这一份构建里根本没有的目标：梁神预设、hooks 插件、以及不在 `dsh/` 里的桌面壳入口；`skipped` 在 1.3.1 之后只剩 #80 一个。

> 提示：桌面版如果 `resources/app.asar` 还在，宿主只会读归档，写在 `resources/app` 里的补丁要等插件「应用」流程把它解开并重启后才生效。
