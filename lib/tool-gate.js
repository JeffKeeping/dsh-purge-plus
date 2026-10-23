/**
 * 破坏性操作的 审计流 + 可选审批门。
 *
 * 两个诉求不能混在一起：
 *   1. **审计**永远要有。谁在什么时候调了 apply / revert / uninstall、批没批、
 *      结果如何 —— 这些必须可回溯，否则长任务里出了问题只能靠记忆。
 *   2. **审批**不能默认强制。dsh-purge 的主入口是人自己点「应用」——人就是
 *      审批者，再弹一次只是多一次点击；而且本机策略可能把 approval 一律自动
 *      拒绝，那么强制审批等于把插件锁死。
 *
 * 所以这里有两档：
 *   mode: "audit"   （默认）记流水，放行。行为与旧版一致，只多一份记录。
 *   mode: "enforce" 记流水 + 必须拿到 allowed-once，否则 deny 不派发。
 *
 * enforce 只对**模型发起的工具调用**有意义：人能直接点的按钮走 HTTP 路由，
 * 那条路径不该二次审批。
 *
 * 失败方向统一是「拒绝」：缺 agent、缺 approval 服务、抛错、未知结果、
 * signal 已 abort —— enforce 下一律不派发。audit 下这些只写进流水。
 */

const DEFAULT_GATED_TOOLS = ["purge_apply", "purge_revert", "purge_uninstall"];

/** 只有明确的 allowed-once 才算批准；其余一律不批准。 */
export function decisionFromOutcome(outcome) {
  if (outcome === "allowed-once") return { allow: true, why: "allowed-once" };
  if (outcome === "cancelled") return { allow: false, kind: "cancel", why: "cancelled" };
  if (outcome === "rejected") return { allow: false, kind: "deny", why: "rejected" };
  return { allow: false, kind: "deny", why: "unavailable" };
}

function normalizeMode(mode) {
  return String(mode || "").toLowerCase() === "enforce" ? "enforce" : "audit";
}

/**
 * @param {object} ctx cordis 上下文
 * @param {object} options
 * @param {"audit"|"enforce"} [options.mode="audit"]
 * @param {string[]} [options.tools]
 * @param {() => string} [options.auditPath]   惰性求值，避免过早绑定 DSH_HOME
 * @param {object} [options.fs]                注入便于测试
 * @param {object} [options.path]
 * @param {(tag: string, kv?: object) => void} [options.log]
 */
export function installToolGate(ctx, options = {}) {
  const mode = normalizeMode(options.mode);
  const gated = new Set(Array.isArray(options.tools) && options.tools.length ? options.tools : DEFAULT_GATED_TOOLS);
  const auditPath = typeof options.auditPath === "function" ? options.auditPath : () => "";
  const log = typeof options.log === "function" ? options.log : () => {};
  const fs = options.fs;
  const path = options.path;
  const disposers = [];

  const appendAudit = (record) => {
    let fp = "";
    try {
      fp = auditPath();
    } catch {
      return;
    }
    if (!fp || !fs || !path) return;
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.appendFileSync(fp, JSON.stringify(record) + "\n", "utf8");
    } catch {
      /* 审计写不进去，绝不影响结果路径 */
    }
  };

  const resolveApproval = () => {
    try {
      return ctx.get?.("approval", false) ?? ctx.get?.("approval") ?? null;
    } catch {
      return null;
    }
  };

  try {
    const dispose = ctx.on("tools/pre-execute", async (exec, next) => {
      const name = String(exec?.name || "");
      if (!gated.has(name)) return next();
      if (exec?.signal?.aborted) return { kind: "cancel" };

      const args = exec?.arguments ?? {};
      const what = String(args?.action ?? args?.id ?? args?.path ?? args?.mode ?? "").slice(0, 200);

      if (mode === "audit") {
        appendAudit({ ts: new Date().toISOString(), tool: name, what, phase: "intent", mode });
        return next();
      }

      const approval = resolveApproval();
      const agent = exec?.agent;
      if (!agent || typeof approval?.request !== "function") {
        appendAudit({ ts: new Date().toISOString(), tool: name, what, decision: "deny", why: "no-approval-service", mode });
        return { kind: "deny", reason: `dsh-purge: ${name} requires an active agent and an available approval service.` };
      }

      let outcome;
      try {
        outcome = await approval.request({
          agent,
          toolName: name,
          callId: exec?.callId,
          reason: `dsh-purge 写操作待批准: ${name}${what ? ` @ ${what}` : ""}`,
          displayReason: {
            en: `dsh-purge operation "${name}" changes this install's host files and needs one-time approval.`,
            zh: `dsh-purge 操作「${name}」会修改本机宿主文件，需要你批准一次。`,
          },
          signal: exec.signal,
        });
      } catch (error) {
        if (exec?.signal?.aborted) return { kind: "cancel" };
        appendAudit({
          ts: new Date().toISOString(),
          tool: name,
          what,
          decision: "deny",
          why: "approval-threw",
          error: String(error && error.message ? error.message : error).slice(0, 300),
          mode,
        });
        return { kind: "deny", reason: `dsh-purge: ${name} approval could not be confirmed; nothing was dispatched.` };
      }

      if (exec?.signal?.aborted) return { kind: "cancel" };
      const verdict = decisionFromOutcome(outcome);
      appendAudit({
        ts: new Date().toISOString(),
        tool: name,
        what,
        decision: verdict.allow ? "allow" : verdict.kind === "cancel" ? "cancel" : "deny",
        why: verdict.why,
        mode,
      });
      if (!verdict.allow) {
        if (verdict.kind === "cancel") return { kind: "cancel" };
        return { kind: "deny", reason: `dsh-purge: ${name} approval was ${verdict.why}; nothing was dispatched.` };
      }
      return next();
    });
    if (typeof dispose === "function") disposers.push(dispose);
  } catch (error) {
    log("gate", { status: "pre-unavailable", error: String(error && error.message ? error.message : error) });
  }

  try {
    const dispose = ctx.on("tools/post-execute", async (exec, result, next) => {
      const name = String(exec?.name || "");
      if (gated.has(name)) {
        appendAudit({
          ts: new Date().toISOString(),
          tool: name,
          phase: "result",
          mode,
          isError: result?.isError === true,
          detail: result?.isError
            ? String(result?.error?.message ?? "").slice(0, 500)
            : String(result?.value?.text ?? "").slice(0, 500),
        });
      }
      return next();
    });
    if (typeof dispose === "function") disposers.push(dispose);
  } catch (error) {
    log("gate", { status: "post-unavailable", error: String(error && error.message ? error.message : error) });
  }

  return {
    mode,
    gated: [...gated],
    installed: disposers.length,
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try { dispose(); } catch { /* 单个 disposer 失败不影响其余 */ }
      }
    },
  };
}

/**
 * 路由侧的显式确认。**不做强制审批**——点按钮的人就是审批者。
 *
 * 只提供一个可选的「二次确认」通道：请求头带 `x-dsh-purge-confirm: once`
 * 时放行。这是给自动化脚本/CI 用的显式意图标记，不是安全边界；
 * 真正的边界是 `allowPluginRequest` 的同源校验。
 */
export function requestRouteApproval(request) {
  const header = String(request?.headers?.["x-dsh-purge-confirm"] ?? "").trim().toLowerCase();
  if (header === "once") return { ok: true, via: "header" };
  return { ok: true, via: "human", implicit: true };
}
