function builtinChildProcess() {
  try {
    if (typeof process.getBuiltinModule !== "function") return null;
    const mod = process.getBuiltinModule("child_process");
    if (!mod || typeof mod.spawn !== "function") return null;
    return mod;
  } catch {
    return null;
  }
}

const MARK = "__dshPurgeHideConsole";
const electron = typeof process.versions !== "undefined" && Boolean(process.versions.electron);

function hide(options) {
  if (options == null) return { windowsHide: true };
  if (typeof options !== "object") return options;
  return { ...options, windowsHide: true };
}

function wrapSpawn(orig) {
  return function patchedSpawn(file, args, options) {
    if (args != null && !Array.isArray(args)) return orig.call(this, file, hide(args));
    return orig.call(this, file, args ?? [], hide(options));
  };
}

function wrapExec(orig) {
  return function patchedExec(command, options, callback) {
    if (typeof options === "function") return orig.call(this, command, { windowsHide: true }, options);
    return orig.call(this, command, hide(options), callback);
  };
}

function wrapExecFile(orig) {
  return function patchedExecFile(file, args, options, callback) {
    if (typeof args === "function") return orig.call(this, file, hide(undefined), args);
    if (args != null && !Array.isArray(args)) return orig.call(this, file, hide(args), options);
    if (typeof options === "function") return orig.call(this, file, args, { windowsHide: true }, options);
    return orig.call(this, file, args, hide(options), callback);
  };
}

function wrapFork(orig) {
  return function patchedFork(modulePath, args, options) {
    if (args != null && !Array.isArray(args)) return orig.call(this, modulePath, hide(args));
    return orig.call(this, modulePath, args, hide(options));
  };
}

function live() {
  const cp = builtinChildProcess();
  if (!cp) return null;
  if (process.platform !== "win32" || electron || cp[MARK]) return cp;
  cp.spawn = wrapSpawn(cp.spawn);
  cp.spawnSync = wrapSpawn(cp.spawnSync);
  cp.exec = wrapExec(cp.exec);
  cp.execSync = wrapExec(cp.execSync);
  cp.execFile = wrapExecFile(cp.execFile);
  cp.execFileSync = wrapExecFile(cp.execFileSync);
  if (typeof cp.fork === "function") cp.fork = wrapFork(cp.fork);
  Object.defineProperty(cp, MARK, { value: true, enumerable: false });
  return cp;
}

function method(name) {
  return function bound(...args) {
    const cp = live();
    const fn = cp && cp[name];
    if (typeof fn !== "function") {
      throw new TypeError(`node:child_process.${name} is unavailable`);
    }
    return fn.apply(this, args);
  };
}

const cp = live();

export default cp;
export const spawn = method("spawn");
export const spawnSync = method("spawnSync");
export const exec = method("exec");
export const execSync = method("execSync");
export const execFile = method("execFile");
export const execFileSync = method("execFileSync");
export const fork = method("fork");
export const ChildProcess = cp ? cp.ChildProcess : undefined;
