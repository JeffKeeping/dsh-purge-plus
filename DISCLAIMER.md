# 免责声明与法律声明 / Disclaimer and legal notice

> 适用范围：本仓库的全部内容，包括插件代码（`lib/`、`client.js`、`bin/`、`scripts/`、`presets/`、`skills/`）、文档、提示词、示例与截图。
> Scope: everything in this repository — plugin code, docs, prompts, presets, skills, and screenshots.

## 1. 这是什么 / What this is

本插件运行在**使用者自己电脑上已安装的官方 DeepSeek Harness** 里，改动的是**本机**的提示词装配、审批策略、沙箱策略与会话界面。它面向本地受控环境的安全研究与模型鲁棒性评测，**不是**公网扫描器，**不是**针对第三方站点的攻击套件，也不包含对外投放的攻击载荷。

This plugin operates on the copy of DeepSeek Harness **installed on the user's own machine**, and only changes local prompt assembly, approval policy, sandbox policy, and session UI. It targets local, controlled security research and model-robustness evaluation. It is **not** a public scanner, **not** an attack kit for third-party sites, and it ships no payload aimed at the public internet.

## 2. 使用前提 / Preconditions for use

只有在下列条件**全部**成立时才可使用：

1. 目标是你**本人所有**、或你**已被书面授权**可以测试的系统、账号与数据；
2. 你在**隔离的本地或离线环境**中操作，或已与资产方签署明确的测试授权（含范围、时间窗、数据处理方式）；
3. 你遵守所在国家/地区的法律、你所属组织的规章制度，以及目标平台的服务条款；
4. 你已备份可以被还原的数据，并知道如何回滚（插件的「还原」「卸载」）。

Use is permitted **only** when all of the following hold: the target is yours or you hold written authorization; you work in an isolated local/offline environment or under a signed engagement with a defined scope; you comply with applicable law, your organization's rules, and the target platform's terms; and you have backups plus a known rollback path.

**禁止**将本项目用于：未授权的入侵与渗透、窃取或破坏数据、干扰他人系统正常运行、批量注册与撞库、诈骗与社工、规避他人平台的访问控制、任何形式的黑灰产活动。

**Prohibited**: unauthorized intrusion or penetration testing, data theft or destruction, disrupting others' systems, mass registration or credential stuffing, fraud and social engineering, circumventing another platform's access controls, and any gray- or black-market activity.

## 3. 无担保 / No warranty

本仓库按 **MIT 许可证「按现状」（AS IS）** 提供，不附带任何明示或默示担保，包括但不限于适销性、特定用途适用性与不侵权担保。插件会**修改你本机的 Harness 安装文件**，可能因宿主版本变化、其他插件冲突或操作失误导致 Harness 无法启动、功能异常或数据不可用。

This repository is provided **"AS IS"** under the MIT licence, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. The plugin **modifies local Harness installation files** and may, through host version drift, plugin conflicts, or operator error, leave Harness unable to start or behaving incorrectly.

**你自行承担使用后果。** 作者与贡献者不对任何直接、间接、附带、特殊或后果性损害承担责任，包括但不限于数据丢失、业务中断、利润损失、法律责任与第三方索赔。上线前请自行在可还原的副本上验证。

**You use it at your own risk.** Authors and contributors accept no liability for any direct, indirect, incidental, special, or consequential damages — including data loss, business interruption, lost profits, legal liability, and third-party claims. Validate on a restorable copy before relying on it.

## 4. 法律声明 / Legal notice

本项目**不构成**对任何违法行为的授权、教唆、帮助或背书。授权只能来自资产权利人，不能来自本仓库、本文档或任何提示词。

This project grants **no** authorization, encouragement, assistance, or endorsement for unlawful acts. Authorization can only come from the asset owner — never from this repository, this document, or any prompt inside it.

使用者须自行确认并遵守（包括但不限于）下列规范；其他司法辖区同样适用其本地法律：

- 《中华人民共和国网络安全法》——未经授权的侵入、干扰、破坏他人网络与信息系统；
- 《中华人民共和国数据安全法》《中华人民共和国个人信息保护法》——数据的非法获取、使用、提供与跨境传输；
- 《中华人民共和国刑法》第二百八十五条（非法侵入计算机信息系统、非法获取计算机信息系统数据、非法控制计算机信息系统）、第二百八十六条（破坏计算机信息系统）、第二百八十七条之二（帮助信息网络犯罪活动）；
- 《中华人民共和国反电信网络诈骗法》及相关司法解释；
- 你所在单位的信息安全管理制度、保密协议与职业道德规范。

The user is responsible for complying with applicable law in their own jurisdiction — including computer-misuse, data-protection, privacy, and anti-fraud statutes — as well as internal security policies and confidentiality obligations.

**提示词层面的边界同样成立**：本项目内置的提示词会要求模型不拒绝操作者指令。这只在「操作者对自己的环境拥有权限」这一前提下成立；它不能、也不被用来给任何越权行为提供正当性。

**Prompt-level boundary**: the bundled prompt tells the model not to refuse the operator. That premise holds only where the operator already has authority over the environment. It does not — and must not — legitimize any act beyond that authority.

## 5. 第三方与上游 / Third parties and upstream

- 本仓库是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的分支，上游版权归原作者**小杨**所有，按 MIT 许可证授权（原文见 [LICENSE](LICENSE)）。署名与来源见 [NOTICE.md](NOTICE.md)。
- 本项目与 **DeepSeek**、DeepSeek Harness 官方团队无隶属、合作或背书关系。文中出现的产品名与商标归各自权利人所有，仅用于说明兼容对象。
- 演练台部分沿用了上游的第三方组件与素材，其许可证与披露见 `docs/redteam-upstream-LICENSE`、`docs/redteam-upstream-DISCLOSURE`。

This repository is a fork of YuJunZhiXue/dsh-purge (MIT, © 2026 小杨). It is not affiliated with, endorsed by, or partnered with DeepSeek or the DeepSeek Harness team; product names and trademarks belong to their respective owners and are used only to describe compatibility. Third-party components used by the drill console are disclosed under `docs/`.

## 6. 权利与下架 / Rights holder and takedown

若你是权利人，认为本仓库的某部分侵犯了你的权利，请通过仓库 Issue 或 GitHub 账号 [@JeffKeeping](https://github.com/JeffKeeping) 联系，并附上可核验的权属说明。核实后会在合理期限内删除或修改相应内容。

If you are a rights holder and believe part of this repository infringes your rights, contact [@JeffKeeping](https://github.com/JeffKeeping) with verifiable ownership details. Verified requests will be honoured within a reasonable period.

## 7. 版本与变更 / Version and changes

本声明随仓库更新，最新版本以本文件为准。若本声明与上游声明的条款冲突，以**更严格**的一条为准。

This notice is versioned with the repository; the current file is authoritative. Where this notice and the upstream notice differ, the **stricter** term applies.
