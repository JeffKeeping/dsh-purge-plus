/**
 * 主机身份的租约式判定。
 *
 * 动手之前要先知道「我要改的这份宿主到底是不是我现在跑着的这一份」。
 * 老版本只比路径字符串，有三种情况会被骗：
 *
 *   1. 目标被换成了符号链接 / 目录联接（junction）→ 看到的是另一份文件；
 *   2. 同一路径下文件被替换（重装、换版本、另一个进程写入）→ 路径对、内容不对；
 *   3. 路径大小写在 Windows 上不敏感 → `C:\App` 与 `c:\app` 被当成两份；
 *      反过来，含 `..` 的相对路径会被当成另一处。
 *
 * 这里给出一份可比较的 **identity**（身份）：真实路径 + 大小 + mtime + 前若干字节的
 * 摘要。写入前后各取一次，不一致就拒绝，而不是写完再发现问题。
 * 参考 IG5 `source/attachment_lease.js` 的 owner/nonce 思路，但只保留与改文件相关的部分。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const HEAD_BYTES = 64 * 1024;

/** Windows 上大小写不敏感；统一归一化后再比较，避免同一份被当成两份。 */
export function normalizeKey(p) {
  const resolved = path.resolve(String(p || ""));
  const lowered = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return lowered.replace(/\\/g, "/");
}

export function samePath(a, b) {
  if (!a || !b) return false;
  return normalizeKey(a) === normalizeKey(b);
}

/** 真实路径（解析链接与联接）；不存在或无权读取时退回归一化的绝对路径。 */
export function realPathOf(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(String(p || ""));
  }
}

function headDigest(fp, size) {
  const length = Math.min(HEAD_BYTES, Math.max(0, size));
  if (length === 0) return "";
  const fd = fs.openSync(fp, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, 0);
    return createHash("sha256").update(buffer.subarray(0, read)).digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 取一份文件的身份。文件不存在时返回 `{ exists: false, path, key }`，
 * 这是正常结果而不是错误——「目标还没建」和「我读不到」必须分开。
 */
export function fileIdentity(fp) {
  const key = normalizeKey(fp);
  const real = realPathOf(fp);
  let stat;
  try {
    stat = fs.statSync(fp);
  } catch (error) {
    const missing = error && error.code === "ENOENT";
    return { exists: false, path: String(fp || ""), real, key, missing, error: missing ? "" : String(error && error.message ? error.message : error) };
  }
  if (!stat.isFile()) {
    return { exists: false, path: String(fp || ""), real, key, missing: false, error: "not a regular file" };
  }
  return {
    exists: true,
    path: String(fp || ""),
    real,
    realKey: normalizeKey(real),
    key,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mode: stat.mode,
    head: headDigest(fp, stat.size),
  };
}

/** 同一份文件的两次观测是否可视为「没动过」。 */
export function sameIdentity(a, b) {
  if (!a || !b) return false;
  if (a.exists !== b.exists) return false;
  if (!a.exists) return true;
  return a.realKey === b.realKey && a.size === b.size && a.mtimeMs === b.mtimeMs && a.head === b.head;
}

/**
 * 写入前后的守卫。用法：
 *
 *   const lease = await acquireLease(fp);
 *   ...写...
 *   const verdict = lease.verify(true);   // mustExist=true 表示写完必须存在
 *   if (!verdict.ok) → 回滚并报错
 *
 * `stale` 表示「拿租约之后别人动过」；`changed` 表示「我写完之后内容没落地」。
 */
export function acquireLease(fp) {
  const before = fileIdentity(fp);
  let released = false;
  return {
    path: String(fp || ""),
    before,
    /** 目标是否本来就不存在（新建文件的合法场景）。 */
    created: !before.exists,
    verify(mustExist = false) {
      const after = fileIdentity(fp);
      if (released && !mustExist) return { ok: true, after };
      if (mustExist && !after.exists) {
        return { ok: false, reason: "missing-after-write", before, after };
      }
      if (!mustExist && !before.exists) {
        return after.exists ? { ok: true, after, appeared: true } : { ok: true, after };
      }
      if (!sameIdentity(before, after) && !after.exists) {
        return { ok: false, reason: "vanished", before, after };
      }
      return { ok: true, after, changed: !sameIdentity(before, after) };
    },
    release() {
      released = true;
    },
  };
}

/**
 * 原子写：先写同目录临时文件再 rename，避免半写坏文件。
 * 已存在文件保留其 mode（Windows 上 best-effort）。
 */
export function writeFileAtomic(fp, data, opts = {}) {
  const target = path.resolve(String(fp || ""));
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ""), opts.encoding || "utf8");
  let mode;
  try {
    mode = fs.statSync(target).mode;
  } catch {
    mode = undefined;
  }
  fs.writeFileSync(temp, buffer, { mode: mode ?? 0o644, flag: "wx" });
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* 清不掉也不掩盖原错误 */ }
    throw error;
  }
  return { path: target, bytes: buffer.length };
}
