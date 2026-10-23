/**
 * 严格 JSON 输出边界。
 *
 * 为什么要有这层：宿主要在渲染前校验工具结果，而 `JSON.stringify` 遇到
 * BigInt 直接抛、遇到 undefined 静默丢字段、遇到循环引用抛、遇到 accessor
 * 触发取值副作用。任何一条都可能让一个本来成功的操作变成 500，或者更糟——
 * 让「看起来成功」的响应其实丢了关键字段。
 *
 * 规则（与 IG5 的 source/json_output.js 同一套判据）：
 *   - 可选对象的 undefined 字段省略；null 保留
 *   - 数字必须有限，且不能是 -0
 *   - 拒绝：BigInt / Symbol / Function / 循环引用 / accessor / 非普通对象 /
 *           数组空洞 / 带额外属性的数组 / 非可枚举字段
 *   - 深度与节点数有上限，超限抛错而不是截断
 *
 * 对外两个入口：
 *   projectJson(value, opts)  —— 严格投影，非 JSON 就抛
 *   safeProject(value, opts)  —— 投影失败时降级成带标记的对象，永不抛
 */

const MAX_DEPTH_DEFAULT = 64;
const MAX_NODES_DEFAULT = 200000;

function fail(at, reason) {
  const error = new TypeError(`dsh-purge JSON at ${at} is not lossless: ${reason}`);
  error.code = "INVALID_PLUGIN_OUTPUT";
  error.at = at;
  return error;
}

/**
 * @param {unknown} value
 * @param {{ maxDepth?: number, maxNodes?: number }} [opts]
 */
export function projectJson(value, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : MAX_DEPTH_DEFAULT;
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : MAX_NODES_DEFAULT;
  const ancestors = new WeakSet();
  let nodes = 0;

  function visit(item, at, depth) {
    if (depth > maxDepth) throw fail(at, `maximum nesting ${maxDepth} exceeded`);
    if (++nodes > maxNodes) throw fail(at, `maximum node count ${maxNodes} exceeded`);
    if (item === null) return null;
    const type = typeof item;
    if (type === "string" || type === "boolean") return item;
    if (type === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw fail(at, "non-lossless number");
      return item;
    }
    if (type !== "object") throw fail(at, `unsupported ${type}`);

    if (ancestors.has(item)) throw fail(at, "circular reference");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) throw fail(at, "non-plain array");
        const own = Reflect.ownKeys(item);
        if (own.length !== item.length + 1) throw fail(at, "sparse or decorated array");
        const out = new Array(item.length);
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor)) throw fail(`${at}[${index}]`, "missing or accessor item");
          out[index] = visit(descriptor.value, `${at}[${index}]`, depth + 1);
        }
        return out;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && prototype !== Object.prototype) throw fail(at, "non-plain object");
      const out = {};
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== "string") throw fail(at, "symbol key");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor.enumerable) throw fail(`${at}.${key}`, "non-enumerable field");
        if (!("value" in descriptor)) throw fail(`${at}.${key}`, "accessor field");
        if (descriptor.value === undefined) continue;
        Object.defineProperty(out, key, {
          value: visit(descriptor.value, `${at}.${key}`, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    } finally {
      ancestors.delete(item);
    }
  }

  return visit(value, "$", 0);
}

/**
 * 永不抛的版本：投影失败时返回 `{ __invalid: true, __reason, __at }`，
 * 让 HTTP 层仍能给出可诊断的 200/500，而不是把异常冒到宿主。
 */
export function safeProject(value, opts = {}) {
  try {
    return { ok: true, value: projectJson(value, opts) };
  } catch (error) {
    return {
      ok: false,
      value: {
        __invalid: true,
        __reason: String(error && error.message ? error.message : error),
        __at: String(error && error.at ? error.at : "$"),
      },
    };
  }
}

/** 把任意值编码成可安全写出的 JSON 文本；绝不抛。 */
export function stringifySafe(value, opts = {}) {
  const projected = safeProject(value, opts);
  try {
    return JSON.stringify(projected.value);
  } catch (error) {
    return JSON.stringify({ __invalid: true, __reason: String(error && error.message ? error.message : error) });
  }
}
