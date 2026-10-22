/**
 * `{{cwd}}` 变量兼容层。
 *
 * ## 为什么需要这个文件
 *
 * 0.2.1 的 `dsh-agent-loop` 只注册了两个提示词变量：
 *
 *     ctx.systemPrompt.variable("provider", …)
 *     ctx.systemPrompt.variable("model",    …)
 *
 * `cwd` 在 0.1.x 还有，0.2 拿掉了。而宿主的 `interpolate()` 遇到未注册变量是
 * **硬失败**，不是留空：
 *
 *     unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
 *     registered variables: provider, model
 *
 * 这是每个新装用户都会撞上的错，因为本插件的 `cordis.patch.yml` 给
 * `system-prompt` 配了 `personaSuffix: Your working directory is {{cwd}}.`，
 * 而那条 section 每轮都会参与渲染。装完插件、还没点「应用」就已经炸了。
 *
 * ## 怎么修
 *
 * 两种做法，这里两个都做，因为它们解决不同层面：
 *
 * 1. **注册变量**（首选）。插件在 `systemPrompt` 的全局层补一个 `cwd` provider，
 *    这样任何引用 `{{cwd}}` 的段（包括我们自己的 personaSuffix，也包括用户自己
 *    在 preset 里写的）都能正常解析。宿主已注册同名变量时会抛 "already
 *    registered"，那时直接跳过——说明这份宿主本来就有，不需要我们补。
 *
 * 2. **改写配置**（兜底）。`cordis.patch.yml` 里的 `personaSuffix` 不再发裸
 *    `{{cwd}}`，改成不含变量的静态句。这样即使变量注册失败（比如宿主把
 *    `systemPrompt.variable` 藏起来），那一行也不会再把整轮打挂。
 *
 * 值从哪来：`context.agent.options.cwd` → `session.header.cwd` → `process.cwd()`。
 * 前两个是宿主的真实字段；最后一个只是「别让它是 undefined」的兜底——返回
 * `undefined` 会触发另一条硬失败（`has no value for this assembly`）。
 */

const MIN_SAFE = "";

/** 从一份 assembly context 里取工作目录。取不到返回 ""，永不返回 undefined。 */
export function resolveCwd(context) {
  try {
    const agentCwd = context?.agent?.options?.cwd;
    if (typeof agentCwd === "string" && agentCwd.trim()) return agentCwd.trim();
  } catch { /* 代理对象点属性可能抛 */ }
  try {
    const headerCwd = context?.agent?.session?.header?.cwd;
    if (typeof headerCwd === "string" && headerCwd.trim()) return headerCwd.trim();
  } catch { /* 同上 */ }
  try {
    const direct = context?.cwd;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  } catch { /* 同上 */ }
  try {
    const cwd = process.cwd();
    if (typeof cwd === "string" && cwd.trim()) return cwd.trim();
  } catch { /* 极端受限环境 */ }
  return MIN_SAFE;
}

/**
 * 在 `systemPrompt` 上补注册 `cwd`。
 *
 * @param {object} ctx cordis 上下文（已注入 systemPrompt）
 * @param {object} [options]
 * @param {(tag: string, kv?: object) => void} [options.log]
 * @returns {{ registered: boolean, reason: string, hadAlready: boolean }}
 */
export function registerCwdVariable(ctx, options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  let prompt = null;
  try {
    prompt = ctx?.systemPrompt ?? ctx?.get?.("systemPrompt") ?? null;
  } catch (error) {
    log("cwd-var", { status: "no-service", error: String(error && error.message ? error.message : error) });
    return { registered: false, reason: "no-service", hadAlready: false };
  }
  if (!prompt || typeof prompt.variable !== "function") {
    log("cwd-var", { status: "no-variable-api" });
    return { registered: false, reason: "no-variable-api", hadAlready: false };
  }
  try {
    const dispose = prompt.variable("cwd", (context) => resolveCwd(context));
    if (typeof dispose === "function") {
      try {
        ctx.effect(() => dispose);
      } catch { /* 没有 effect 的旧上下文：disposer 随 context 一起回收 */ }
    }
    log("cwd-var", { status: "registered" });
    return { registered: true, reason: "ok", hadAlready: false };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("already registered")) {
      /* 宿主自己注册了 cwd —— 不需要我们补，也不能算失败。 */
      log("cwd-var", { status: "already" });
      return { registered: true, reason: "already", hadAlready: true };
    }
    log("cwd-var", { status: "failed", error: message });
    return { registered: false, reason: message, hadAlready: false };
  }
}

/**
 * 把一段文本里未注册的 `{{…}}` 变成宿主能接受的形式。
 *
 * 与 `identity.js#escapeDshInterpolation` 的区别：那个是「白名单内保留、其余转义」，
 * 这个允许调用方传入当前**实际**注册的变量集合，未知的一律降级成字面文本。
 * 用在「我们没法保证宿主注册了哪些变量」的路径上。
 *
 * @param {string} text
 * @param {Iterable<string>} known 已知变量名；默认按 0.2.1 的 provider/model + 我们补的 cwd
 */
export function neutralizeUnknownVariables(text, known) {
  const allowed = new Set(known || ["provider", "model", "cwd"]);
  const src = String(text || "");
  if (!src.includes("{{")) return src;
  return src.replace(/\{\{([^{}]*)\}\}/g, (all, name) => (allowed.has(String(name).trim()) ? all : `{ {${name}}}`));
}
