#!/usr/bin/env node
/**
 * dsh-purge 兼容性自检 / compatibility self-check.
 *
 * 从一个 DSH 构建里只取出「补丁目标文件」，复制到临时目录，再跑完整补丁引擎，
 * 逐个补丁报告 applied / already / skipped。真实安装目录只读，不会被改写。
 *
 * Only the files the patch table targets are copied to a temp tree; the real
 * installation is read-only. Every patch is then applied to that copy.
 *
 * 用法 / Usage:
 *   node scripts/compat-check.mjs --asar "C:\...\resources\app.asar"
 *   node scripts/compat-check.mjs --app  "C:\...\resources\app"
 *   node scripts/compat-check.mjs --asar ... --surface web --json out.json
 *
 * 退出码 / Exit code: 0 = 没有待打补丁；1 = 仍有 pending；2 = 参数错误。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "../lib/core.js";

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node scripts/compat-check.mjs --asar <app.asar> | --app <appDir> [--surface web|desktop] [--json out.json]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let asar = "";
let appDir = "";
let surface = "";
let jsonOut = "";
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === "--asar") asar = next();
  else if (a === "--app") appDir = next();
  else if (a === "--surface") surface = next();
  else if (a === "--json") jsonOut = next();
  else if (a === "-h" || a === "--help") usage();
  else usage(`unknown argument: ${a}`);
}
if (!asar && !appDir) usage("need --asar or --app");
if (asar && appDir) usage("pass only one of --asar / --app");

if (!surface) {
  surface = /deepseek[\s._-]*harness|dsh desktop/i.test(asar || appDir) ? "desktop" : "web";
}
process.env.DSH_SURFACE = surface;

/** 读 app.asar 头，返回 { entries, dataStart }。 */
function readAsarIndex(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(12);
  const raw = Buffer.alloc(headerSize);
  fs.readSync(fd, raw, 0, headerSize, 16);
  let text = raw.toString("utf8");
  const end = text.lastIndexOf("}");
  if (end >= 0) text = text.slice(0, end + 1);
  const index = JSON.parse(text);
  const entries = new Map();
  (function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + "/" + name : name;
      if (entry.files) walk(entry, p);
      else entries.set(p, entry);
    }
  })(index, "");
  return { fd, entries, dataStart: 16 + Buffer.byteLength(text, "utf8") };
}

const realAppDir = appDir
  ? path.resolve(appDir)
  : path.dirname(path.resolve(asar));
const realAiBase = path.join(realAppDir, "dsh", "node_modules", "@deepseek-ai");
if (appDir && !fs.existsSync(realAiBase)) {
  console.error(`not a DSH build (missing dsh/node_modules/@deepseek-ai): ${realAppDir}`);
  process.exit(2);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-compat-"));
const tmpHome = path.join(tmpRoot, "home");
fs.mkdirSync(tmpHome, { recursive: true });
process.env.DSH_HOME = tmpHome;

const tmpAiBase = path.join(tmpRoot, "dsh", "node_modules", "@deepseek-ai");

const asarIndex = asar ? readAsarIndex(path.resolve(asar)) : null;
let copied = 0;
const notFound = [];

if (asarIndex) {
  // 归档没解开：先用归档索引在临时目录铺一层 0 字节骨架，
  // 让补丁表的 firstExisting/allExisting 按真实布局解析出路径，再填真实内容。
  for (const rel of asarIndex.entries.keys()) {
    const dest = path.join(tmpRoot, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.alloc(0));
  }
  const skeletonFiles = core.targetFiles(tmpAiBase, tmpHome);
  const wanted = new Set();
  for (const value of Object.values(skeletonFiles)) {
    for (const fp of Array.isArray(value) ? value : [value]) {
      if (typeof fp !== "string" || !fp) continue;
      const rel = path.relative(tmpRoot, fp).split(path.sep).join("/");
      if (rel.startsWith("..")) continue;
      if (asarIndex.entries.has(rel)) wanted.add(rel);
    }
  }
  for (const rel of wanted) {
    const entry = asarIndex.entries.get(rel);
    const size = Number(entry.size);
    const buf = Buffer.alloc(size);
    if (size > 0) fs.readSync(asarIndex.fd, buf, 0, size, asarIndex.dataStart + Number(entry.offset));
    fs.writeFileSync(path.join(tmpRoot, rel.replace(/\//g, path.sep)), buf);
    copied += 1;
  }
  fs.closeSync(asarIndex.fd);
} else {
  const files = core.targetFiles(realAiBase, tmpHome);
  const wanted = new Set();
  for (const value of Object.values(files)) {
    for (const fp of Array.isArray(value) ? value : [value]) {
      if (typeof fp === "string" && fp.startsWith(realAppDir + path.sep)) wanted.add(fp);
    }
  }
  for (const abs of wanted) {
    const rel = abs.slice(realAppDir.length + 1);
    const src = path.join(realAppDir, rel);
    if (!fs.existsSync(src)) {
      notFound.push(rel);
      continue;
    }
    const dest = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied += 1;
  }
}

const report = await core.applyPatches(tmpAiBase, core.ALL_PATCHES, {});
const byId = new Map(core.ALL_PATCHES.map((p) => [p.id, p]));
const bad = report.filter((r) => !core.isPatchResultSoftOk(r, byId.get(r.patch_id)));

console.log(`target: ${realAppDir}  surface: ${surface}`);
console.log(`copied ${copied} patch-target files${notFound.length ? `, ${notFound.length} not in this build` : ""}`);
for (const r of report.filter((r) => r.status !== "applied")) {
  console.log(`  ${r.status.padEnd(13)} #${String(r.patch_id).padEnd(2)} ${r.name}`);
}
const tally = report.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log(`patches: ${core.ALL_PATCHES.length}  ${JSON.stringify(tally)}`);
if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ report, notFound }, null, 2));

fs.rmSync(tmpRoot, { recursive: true, force: true });

const pending = report.filter((r) => r.status === "pending" || r.status === "pattern_not_found");
if (pending.length) {
  console.log(`\nFAIL: ${pending.length} patch(es) still pending on this build.`);
  process.exit(1);
}
console.log(`\nOK: every applicable patch is settled (${bad.length} unexpected).`);
