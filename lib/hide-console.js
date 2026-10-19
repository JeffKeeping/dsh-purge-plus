import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isAsarSealedPath } from "./desktop.js";
import { diskFs, fsFor } from "./extract-asar.js";

const MARK = "__dshPurgeHideConsole";
const IMPORT_MARK = "dsh-purge-hide-console";

function forceHideOptions(options) {
  if (options == null) return { windowsHide: true };
  if (typeof options !== "object") return options;
  if (options.windowsHide === true) return options;
  return { ...options, windowsHide: true };
}

function wrapSpawn(orig) {
  return function patchedSpawn(file, args, options) {
    if (args != null && !Array.isArray(args)) {
      return orig.call(this, file, forceHideOptions(args));
    }
    return orig.call(this, file, args ?? [], forceHideOptions(options));
  };
}

function wrapExecLike(orig) {
  return function patchedExec(command, options, callback) {
    if (typeof options === "function") {
      return orig.call(this, command, { windowsHide: true }, options);
    }
    return orig.call(this, command, forceHideOptions(options), callback);
  };
}

function wrapExecFile(orig) {
  return function patchedExecFile(file, args, options, callback) {
    if (typeof args === "function") {
      return orig.call(this, file, forceHideOptions(undefined), args);
    }
    if (args != null && !Array.isArray(args)) {
      return orig.call(this, file, forceHideOptions(args), options);
    }
    if (typeof options === "function") {
      return orig.call(this, file, args, { windowsHide: true }, options);
    }
    return orig.call(this, file, args, forceHideOptions(options), callback);
  };
}

function wrapFork(orig) {
  return function patchedFork(modulePath, args, options) {
    if (args != null && !Array.isArray(args)) {
      return orig.call(this, modulePath, forceHideOptions(args));
    }
    return orig.call(this, modulePath, args, forceHideOptions(options));
  };
}

export function isElectronHost(versions = process.versions) {
  return Boolean(versions && versions.electron);
}

/**
 * Windows 非 Electron：包 builtin，给子进程加 windowsHide。
 * Electron（官方桌面 / 第三方 DSH Desktop）整段跳过。
 * macOS、Linux、Kali 不是 win32，调用方直接跳过。
 * 不再 registerHooks 短路 node:child_process（#46）。
 */
export function hideConsoleDecision(platform = process.platform, versions = process.versions) {
  if (platform !== "win32") return "not_win32";
  if (isElectronHost(versions)) return "electron_host";
  return "wrap_builtin";
}

export function installChildProcessImportHook() {
  // #46：Node 24 把 node:child_process 短路到 facade 后，
  // CJS require 会在 loadBuiltinWithHooks 里读到 undefined.exports。
  // Windows / macOS / Linux 都不再注册这个 resolve 钩子。
  return { ok: true, skipped: "no_builtin_short_circuit" };
}

function builtinChildProcess() {
  try {
    if (typeof process.getBuiltinModule === "function") {
      const cp = process.getBuiltinModule("child_process");
      if (cp && typeof cp.spawn === "function") return cp;
    }
  } catch {
    /* Electron 沙箱里 getBuiltinModule 可能抛，下面再试 require */
  }
  try {
    const cp = createRequire(import.meta.url)("node:child_process");
    if (cp && typeof cp.spawn === "function") return cp;
  } catch {
    return null;
  }
  return null;
}

export function installHideConsole() {
  const decision = hideConsoleDecision();
  if (decision !== "wrap_builtin") return { ok: true, skipped: decision };
  const hook = installChildProcessImportHook();
  const cp = builtinChildProcess();
  if (!cp) return { ok: true, skipped: "builtin_unavailable", hook };
  if (cp[MARK]) return { ok: true, already: true, hook };

  cp.spawn = wrapSpawn(cp.spawn);
  cp.spawnSync = wrapSpawn(cp.spawnSync);
  cp.exec = wrapExecLike(cp.exec);
  cp.execSync = wrapExecLike(cp.execSync);
  cp.execFile = wrapExecFile(cp.execFile);
  cp.execFileSync = wrapExecFile(cp.execFileSync);
  if (typeof cp.fork === "function") cp.fork = wrapFork(cp.fork);

  Object.defineProperty(cp, MARK, { value: true, enumerable: false });
  return { ok: true, patched: true, hook };
}

export function hideConsoleEntrySource() {
  return `// ${IMPORT_MARK} — auto-installed by dsh-purge; do not edit
const MARK = ${JSON.stringify(MARK)};

const isElectron = typeof process.versions !== "undefined" && !!process.versions.electron;
const cp = !isElectron && process.platform === "win32" && typeof process.getBuiltinModule === "function"
  ? process.getBuiltinModule("child_process")
  : null;
if (cp && typeof cp.spawn === "function" && !cp[MARK]) {
  const hide = (options) => {
    if (options == null) return { windowsHide: true };
    if (typeof options !== "object") return options;
    if (options.windowsHide === true) return options;
    return { ...options, windowsHide: true };
  };
  const wrapSpawn = (orig) => function (file, args, options) {
    if (args != null && !Array.isArray(args)) return orig.call(this, file, hide(args));
    return orig.call(this, file, args ?? [], hide(options));
  };
  const wrapExec = (orig) => function (command, options, callback) {
    if (typeof options === "function") return orig.call(this, command, { windowsHide: true }, options);
    return orig.call(this, command, hide(options), callback);
  };
  const wrapExecFile = (orig) => function (file, args, options, callback) {
    if (typeof args === "function") return orig.call(this, file, hide(undefined), args);
    if (args != null && !Array.isArray(args)) return orig.call(this, file, hide(args), options);
    if (typeof options === "function") return orig.call(this, file, args, { windowsHide: true }, options);
    return orig.call(this, file, args, hide(options), callback);
  };
  const wrapFork = (orig) => function (modulePath, args, options) {
    if (args != null && !Array.isArray(args)) return orig.call(this, modulePath, hide(args));
    return orig.call(this, modulePath, args, hide(options));
  };
  cp.spawn = wrapSpawn(cp.spawn);
  cp.spawnSync = wrapSpawn(cp.spawnSync);
  cp.exec = wrapExec(cp.exec);
  cp.execSync = wrapExec(cp.execSync);
  cp.execFile = wrapExecFile(cp.execFile);
  cp.execFileSync = wrapExecFile(cp.execFileSync);
  if (typeof cp.fork === "function") cp.fork = wrapFork(cp.fork);
  Object.defineProperty(cp, MARK, { value: true, enumerable: false });
}
`;
}

function requirePath() {
  return createRequire(import.meta.url)("node:path");
}

function ioFor(explicit, targetPath) {
  return explicit ?? fsFor(targetPath);
}

/** 源码 monorepo 的 apps/cli（tsdown 构建产物）。往这里注入/还原会动构建输出，缺 bak 时无法自愈（#41）。 */
export function looksLikeSourceCliRoot(root, { fs, path: nodePath } = {}) {
  const p = nodePath ?? requirePath();
  if (!root) return false;
  const n = String(root).replace(/\\/g, "/").toLowerCase();
  if (/\/apps\/cli\/?$/.test(n)) return true;
  if (/\/node_modules\//.test(n)) return false;
  try {
    const nodeFs = ioFor(fs, root);
    const libDir = p.join(root, "lib");
    if (nodeFs.existsSync(p.join(libDir, "tsconfig.tsbuildinfo"))) return true;
    if (nodeFs.existsSync(p.join(root, "tsdown.config.ts")) || nodeFs.existsSync(p.join(root, "tsdown.config.mjs"))) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function resolveDshBinRoot(hint, { fs, path: nodePath } = {}) {
  const p = nodePath ?? requirePath();
  const tries = [];
  const push = (x) => {
    if (x && !tries.includes(x)) tries.push(x);
  };
  if (hint) {
    push(hint);
    push(p.join(hint, "dsh"));
    push(p.join(hint, "@deepseek-ai", "dsh"));
    if (p.basename(hint) === "@deepseek-ai") {
      push(p.dirname(hint));
      push(p.join(p.dirname(hint), "dsh"));
      push(p.dirname(p.dirname(hint)));
    }
    if (p.basename(hint) === "dsh") push(hint);
  }
  if (typeof process.argv[1] === "string" && /[\\/]bin\.js$/i.test(process.argv[1])) {
    push(p.dirname(p.dirname(process.argv[1])));
  }
  for (const root of tries) {
    try {
      const binJs = p.join(root, "lib", "bin.js");
      if (isAsarSealedPath(root) || isAsarSealedPath(binJs)) continue;
      // 源码树只作探测候选的最后手段；优先 node_modules 包，避免改写 apps/cli/lib（#41）。
      if (looksLikeSourceCliRoot(root, { fs, path: p })) continue;
      if (ioFor(fs, binJs).existsSync(binJs)) return p.normalize(root);
    } catch {}
  }
  // 没有包装配路径时，才回退到 argv 指向的源码 cli（仍禁止注入，见 installHideConsoleIntoBin）。
  for (const root of tries) {
    try {
      const binJs = p.join(root, "lib", "bin.js");
      if (isAsarSealedPath(root) || isAsarSealedPath(binJs)) continue;
      if (ioFor(fs, binJs).existsSync(binJs)) return p.normalize(root);
    } catch {}
  }
  return null;
}

const IMPORT_LINE = `import "./${IMPORT_MARK}.js"; // [dsh-purge] hide-console`;

export function installHideConsoleIntoBin(aiBase, { fs, path: nodePath } = {}) {
  if (process.platform !== "win32") return "skipped_not_win32";
  const p = nodePath ?? requirePath();
  const root = resolveDshBinRoot(aiBase, { fs, path: p });
  if (!root) return "missing_bin";
  // 源码部署的 apps/cli/lib 是 tsdown 产物：只准读、不准写 sidecar / 改 bin.js（#41）。
  if (looksLikeSourceCliRoot(root, { fs, path: p })) return "skipped_source_cli";
  const nodeFs = ioFor(fs, root);
  const binJs = p.join(root, "lib", "bin.js");
  const side = p.join(root, "lib", `${IMPORT_MARK}.js`);
  const facadeSide = p.join(root, "lib", "dsh-purge-child-process-hide.mjs");
  if (isAsarSealedPath(root) || isAsarSealedPath(binJs)) return "sealed_asar";

  const facadeSrc = diskFs().readFileSync(
    fileURLToPath(new URL("./child-process-hide.mjs", import.meta.url)),
    "utf8",
  );
  nodeFs.writeFileSync(facadeSide, facadeSrc, "utf8");
  nodeFs.writeFileSync(side, hideConsoleEntrySource(), "utf8");

  let text = nodeFs.readFileSync(binJs, "utf8");
  if (text.includes(IMPORT_MARK) && text.includes(IMPORT_LINE.split(" //")[0])) {
    return "already_injected";
  }
  text = text.replace(/^import "\.\/dsh-purge-hide-console\.js";.*\r?\n/m, "");
  if (/^#!/.test(text)) {
    const nl = text.indexOf("\n");
    text =
      nl >= 0
        ? text.slice(0, nl + 1) + IMPORT_LINE + "\n" + text.slice(nl + 1)
        : text + "\n" + IMPORT_LINE + "\n";
  } else {
    text = IMPORT_LINE + "\n" + text;
  }
  nodeFs.writeFileSync(binJs, text, "utf8");
  return "injected";
}

export function revertHideConsoleFromBin(aiBase, { fs, path: nodePath } = {}) {
  const p = nodePath ?? requirePath();
  const root = resolveDshBinRoot(aiBase, { fs, path: p });
  if (!root) return "missing_bin";
  // 源码 cli：只清理本插件留下的 sidecar，绝不改/删 bin.js 或其它构建产物（#41）。
  const sourceCli = looksLikeSourceCliRoot(root, { fs, path: p });
  const nodeFs = ioFor(fs, root);
  const binJs = p.join(root, "lib", "bin.js");
  const side = p.join(root, "lib", `${IMPORT_MARK}.js`);
  const facadeSide = p.join(root, "lib", "dsh-purge-child-process-hide.mjs");
  let changed = false;
  if (!sourceCli && nodeFs.existsSync(binJs)) {
    try {
      const text = nodeFs.readFileSync(binJs, "utf8");
      const next = text.replace(/^import "\.\/dsh-purge-hide-console\.js";.*\r?\n/gm, "");
      if (next !== text) {
        nodeFs.writeFileSync(binJs, next, "utf8");
        changed = true;
      }
    } catch (e) {
      return `error:${e}`;
    }
  }
  for (const fp of [side, facadeSide]) {
    try {
      if (nodeFs.existsSync(fp)) {
        nodeFs.unlinkSync(fp);
        changed = true;
      }
    } catch {
      // 重启后再删
    }
  }
  return changed ? "reverted" : "absent";
}

installHideConsole();
