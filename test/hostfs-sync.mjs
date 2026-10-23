// Regression tests for two silent-failure bugs found on Windows 0.2.1-rc.2.
//
// Bug A — `hostFs` never exposed the fd-based sync methods.
//   `lib/core.js` does `const fs = hostFs`, so every `fs.closeSync(fd)` threw
//   `TypeError: hostFs.closeSync is not a function`. Most call sites sit inside
//   `finally` or an empty `catch`, so nothing crashed — it failed silently:
//     * `makeHostBackups` opens a placeholder with `openSync(bak, "wx")`, fails to
//       close it, and `rename(tmp, bak)` then fails with EPERM on Windows, so no
//       `.dshpurge.bak` is produced at all. The placeholder is already on disk, so
//       the next run hits EEXIST and `continue`s — that file is never backed up.
//     * `isTextShim` could never read the 512-byte head, so it always returned
//       false and `shimFileStatus` reported a real text shim as "binary".
//
// Bug B — `atomicCopyFile` is `async` but `desktop.repairOfficialCliAfterUnpack`
//   called it without `await` inside a sync `try`. The rejection escapes the
//   `catch` entirely and terminates the host on Node >= 15.
//
// usage: node test/hostfs-sync.mjs [pluginDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] || path.resolve(here, "..");
const load = (name) => import(pathToFileURL(path.join(pluginDir, "lib", name)).href);

let pass = 0;
let fail = 0;
function check(label, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? "  <- " + detail : ""}`);
  }
}

const { hostFs } = await load("extract-asar.js");
const core = await load("core.js");

console.log("\n== hostFs exposes the fd-based sync surface ==");
// Every fs.* call site in these modules must resolve on hostFs, because
// lib/core.js aliases `const fs = hostFs` and index.js/desktop call into it.
for (const file of ["core.js", "index.js", "hooks-deny.js", "host-lease.js"]) {
  const src = fs.readFileSync(path.join(pluginDir, "lib", file), "utf8");
  const used = new Set([...src.matchAll(/\bfs\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  const missing = [...used].filter((m) => typeof hostFs[m] !== "function");
  check(`${file}: no fs.* call resolves to undefined`, missing.length === 0, missing.join(", "));
}

check("closeSync is a function", typeof hostFs.closeSync === "function");
check("readSync is a function", typeof hostFs.readSync === "function");
check("fsyncSync is a function", typeof hostFs.fsyncSync === "function");

console.log("\n== fd args never reach the asar probe ==");
// `route()` resolves the fs backend from the first argument as a PATH. If fd
// methods went through it, `fsFor(3)` would probe "3" and always pick node:fs —
// that is why they are wired to diskFs() directly. Assert the wiring works.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-hostfs-"));
  try {
    const file = path.join(tmpDir, "probe.txt");
    const fd = hostFs.openSync(file, "w");
    check("openSync returns an fd", Number.isInteger(fd) && fd >= 0);
    hostFs.writeSync(fd, "hello", 0, "utf8");
    hostFs.fsyncSync(fd);
    check("closeSync actually closes (no throw)", (() => {
      try { hostFs.closeSync(fd); return true; } catch { return false; }
    })());

    // A closed fd must be rejected, which proves the handle really was released.
    let closedRejected = false;
    try { hostFs.closeSync(fd); } catch { closedRejected = true; }
    check("double close is rejected (fd was really released)", closedRejected);

    const rfd = hostFs.openSync(file, "r");
    const buf = Buffer.allocUnsafe(16);
    const n = hostFs.readSync(rfd, buf, 0, 16, 0);
    hostFs.closeSync(rfd);
    check("readSync reads the written bytes", buf.subarray(0, n).toString("utf8") === "hello");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== placeholder backup path no longer leaks an fd ==");
// This is the exact `makeHostBackups` sequence: wx placeholder, close, then an
// atomic rename over it. Before the fix the rename failed with EPERM on Windows.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-bak-"));
  try {
    const src = path.join(tmpDir, "target.js");
    fs.writeFileSync(src, "original");
    const bak = src + ".dshpurge.bak";

    const placeholderFd = hostFs.openSync(bak, "wx");
    let closed = false;
    try { hostFs.closeSync(placeholderFd); closed = true; } catch { /* pre-fix path */ }
    check("placeholder fd closed", closed);

    let renamed = false;
    try {
      await core.atomicCopyFile(src, bak);
      renamed = true;
    } catch { /* pre-fix: EPERM while the fd was open */ }
    check("atomicCopyFile succeeds over the closed placeholder", renamed);
    check("backup content matches source", fs.readFileSync(bak, "utf8") === "original");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== isTextShim reads shim text again ==");
// shimFileStatus returning "binary" for a plain .cmd was the user-visible symptom.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-shim-"));
  try {
    const cmd = path.join(tmpDir, "dsh.cmd");
    fs.writeFileSync(cmd, "@echo off\r\nsetlocal\r\n");
    check("text shim is not reported as binary", core.shimFileStatus(cmd) !== "binary");
    check("unpatched shim reports original", core.shimFileStatus(cmd) === "original");

    const patched = path.join(tmpDir, "patched.cmd");
    fs.writeFileSync(patched, "@echo off\r\nrem dsh-purge shim\r\n");
    check("patched shim is detected", core.shimIsPatched(patched) === true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== repairOfficialCliAfterUnpack stays awaitable ==");
// Bug B: the function must be async so its internal atomicCopyFile is awaited.
{
  const desktop = await load("desktop.js");
  check("desktop.repairOfficialCliAfterUnpack is async",
    desktop.repairOfficialCliAfterUnpack.constructor.name === "AsyncFunction");
  check("core.repairOfficialCliAfterUnpack is async",
    core.repairOfficialCliAfterUnpack.constructor.name === "AsyncFunction");

  let threw = null;
  try {
    const result = await core.repairOfficialCliAfterUnpack(null);
    check("returns a report instead of throwing for a null exe",
      result && typeof result === "object" && result.ok === false, JSON.stringify(result));
  } catch (error) {
    threw = error;
    check("returns a report instead of throwing for a null exe", false, String(threw && threw.message));
  }
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
