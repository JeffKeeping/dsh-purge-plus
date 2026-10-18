// 针对 1.4.0 新增四个模块的单元测试。不启动宿主、不碰真实工程。
//
// usage: node work/tools/test-1.4.0.mjs [pluginDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] || path.resolve(here, "..");
const load = (name) => import(pathToFileURL(path.join(pluginDir, "lib", name)).href);

const jsonSafe = await load("json-safe.js");
const lease = await load("host-lease.js");
const revision = await load("revision.js");
const gateModule = await load("tool-gate.js");

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
function throws(label, fn) {
  try {
    fn();
    check(label, false, "expected a throw");
  } catch {
    check(label, true);
  }
}

console.log("\n== json-safe ==");
{
  const { projectJson, safeProject, stringifySafe } = jsonSafe;

  check("plain round-trip", JSON.stringify(projectJson({ a: 1, b: "x", c: true, d: null })) === '{"a":1,"b":"x","c":true,"d":null}');
  check("undefined field omitted", !("a" in projectJson({ a: undefined, b: 1 })));
  check("null preserved", projectJson({ a: null }).a === null);
  check("nested arrays ok", JSON.stringify(projectJson({ a: [1, [2, 3]] })) === '{"a":[1,[2,3]]}');

  throws("-0 rejected", () => projectJson({ a: -0 }));
  throws("NaN rejected", () => projectJson({ a: NaN }));
  throws("Infinity rejected", () => projectJson({ a: Infinity }));
  throws("BigInt rejected", () => projectJson({ a: 1n }));
  throws("function rejected", () => projectJson({ a: () => 1 }));
  throws("symbol rejected", () => projectJson({ a: Symbol("s") }));

  const circular = { a: 1 };
  circular.self = circular;
  throws("circular rejected", () => projectJson(circular));

  const sparse = [1, , 3];
  throws("sparse array rejected", () => projectJson({ a: sparse }));

  const decorated = [1, 2];
  decorated.extra = "x";
  throws("decorated array rejected", () => projectJson({ a: decorated }));

  const withAccessor = {};
  Object.defineProperty(withAccessor, "a", { enumerable: true, get: () => 1 });
  throws("accessor rejected", () => projectJson(withAccessor));

  class Custom { constructor() { this.a = 1; } }
  throws("class instance rejected", () => projectJson({ a: new Custom() }));

  const deep = {};
  let cursor = deep;
  for (let i = 0; i < 80; i += 1) { cursor.next = {}; cursor = cursor.next; }
  throws("depth cap enforced", () => projectJson(deep));

  const bad = safeProject({ a: 1n });
  check("safeProject never throws", bad.ok === false && bad.value.__invalid === true);
  check("safeProject keeps reason", String(bad.value.__reason).length > 0);
  check("stringifySafe on bad value returns JSON", (() => {
    const text = stringifySafe({ a: 1n });
    return typeof text === "string" && JSON.parse(text).__invalid === true;
  })());

  // 64 位地址必须保持字符串精度（IG5 的同一条约束）。
  const big = "0x7FF6A1B2C3D4E5F6";
  check("64-bit address survives as string", projectJson({ ea: big }).ea === big);
}

console.log("\n== host-lease ==");
{
  const { fileIdentity, sameIdentity, acquireLease, writeFileAtomic, normalizeKey, samePath } = lease;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-lease-"));
  const fp = path.join(dir, "target.txt");

  const missing = fileIdentity(fp);
  check("missing file reports exists=false", missing.exists === false && missing.missing === true);

  fs.writeFileSync(fp, "hello", "utf8");
  const first = fileIdentity(fp);
  check("existing file has size/mtime/head", first.exists && first.size === 5 && first.head.length === 64);

  check("same content same identity", sameIdentity(first, fileIdentity(fp)));

  fs.writeFileSync(fp, "hellp", "utf8");
  const changed = fileIdentity(fp);
  check("content change breaks identity", !sameIdentity(first, changed), `${first.head} vs ${changed.head}`);

  const sameMtime = { ...first, mtimeMs: 0 };
  fs.utimesSync(fp, 1, 1);
  check("mtime-only change breaks identity", !sameIdentity(sameMtime, fileIdentity(fp)));

  const l1 = acquireLease(fp);
  fs.writeFileSync(fp, "modified after lease", "utf8");
  const v1 = l1.verify(true);
  check("lease verify reports changed", v1.ok === true && v1.changed === true);

  const l2 = acquireLease(fp);
  fs.unlinkSync(fp);
  const v2 = l2.verify(true);
  check("lease catches vanish", v2.ok === false && v2.reason === "missing-after-write");

  const fresh = path.join(dir, "new.txt");
  const l3 = acquireLease(fresh);
  writeFileAtomic(fresh, "atomic", {});
  const v3 = l3.verify(true);
  check("atomic write on new file verifies", v3.ok === true && fs.readFileSync(fresh, "utf8") === "atomic");
  check("lease knows it created the file", l3.created === true);

  writeFileAtomic(fresh, "second", {});
  check("atomic write overwrites", fs.readFileSync(fresh, "utf8") === "second");
  check("no temp files left behind", fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")).length === 0);

  check("normalizeKey lowercases on win32", process.platform !== "win32" || normalizeKey("C:\\A\\B") === normalizeKey("c:/a/b"));
  check("samePath matches separators", process.platform !== "win32" || samePath("C:/A", "C:\\a"));

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n== revision ==");
{
  const { currentRev, bumpRev, checkRev, lastActionInfo, resetRevForTests } = revision;
  resetRevForTests();
  check("starts at 0", currentRev() === 0);

  const first = checkRev(undefined);
  check("omitted rev passes", first.ok === true && first.rev === 0);

  checkRev("not-a-number");
  check("garbage rev passes leniently", checkRev("abc").ok === true);

  bumpRev("apply");
  check("bump increments", currentRev() === 1);
  check("last action recorded", lastActionInfo().action === "apply");

  check("matching rev passes", checkRev(1).ok === true);
  const stale = checkRev(0);
  check("stale rev rejected", stale.ok === false && stale.stale === true);
  check("stale rev carries current", stale.rev === 1 && stale.last.action === "apply");

  const ahead = checkRev(99);
  check("future rev rejected but not stale", ahead.ok === false && ahead.stale === false);

  bumpRev("revert");
  check("second bump", currentRev() === 2 && lastActionInfo().action === "revert");
  resetRevForTests();
  check("reset for tests", currentRev() === 0);
}

console.log("\n== tool-gate ==");
{
  const { installToolGate, requestRouteApproval, decisionFromOutcome } = gateModule;
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-audit-"));
  const auditFile = path.join(auditDir, "audit.jsonl");

  function makeCtx(outcome, opts = {}) {
    const { withService = true, throwOnRequest = false } = opts;
    const handlers = { "tools/pre-execute": [], "tools/post-execute": [] };
    let requests = 0;
    return {
      handlers,
      requests: () => requests,
      ctx: {
        get(name) {
          if (name !== "approval") return undefined;
          if (!withService) return undefined;
          return {
            async request() {
              requests += 1;
              if (throwOnRequest) throw new Error("approval backend down");
              return outcome;
            },
          };
        },
        on(event, handler) {
          handlers[event].push(handler);
          return () => {
            const at = handlers[event].indexOf(handler);
            if (at >= 0) handlers[event].splice(at, 1);
          };
        },
      },
    };
  }

  const readAudit = () => (fs.existsSync(auditFile)
    ? fs.readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []);
  const runPre = (harness, exec) => harness.handlers["tools/pre-execute"][0](exec, async () => "next");

  // ---- audit 模式（默认）：记意图、放行、绝不请求审批 ----
  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("rejected", { withService: false });
    const gate = installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    check("default mode is audit", gate.mode === "audit");
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("audit mode passes through", out === "next");
    check("audit mode never asks approval", h.requests() === 0);
    check("audit mode records intent", readAudit().some((r) => r.phase === "intent" && r.tool === "purge_apply"));
    gate.dispose();
  }

  // ---- enforce 模式：allowed-once 放行 ----
  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    const out = await h.handlers["tools/pre-execute"][0](
      { name: "purge_apply", agent: {}, signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("enforce + allowed-once calls next", nextCalled && out === "next");
    check("allow audited", readAudit().some((r) => r.decision === "allow" && r.tool === "purge_apply"));
  }

  // ---- enforce 模式：拒绝不派发 ----
  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("rejected");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    const out = await h.handlers["tools/pre-execute"][0](
      { name: "purge_apply", agent: {}, signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("enforce + rejected does not dispatch", nextCalled === false && out.kind === "deny");
    check("deny audited with reason", readAudit().some((r) => r.decision === "deny" && r.why === "rejected"));
  }

  // ---- enforce 模式：各种失败都 fail closed ----
  {
    const h = makeCtx("cancelled");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_revert", agent: {}, signal: { aborted: false } });
    check("enforce + cancelled maps to cancel", out.kind === "cancel");
  }
  {
    const h = makeCtx("something-else");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + unknown outcome denies", out.kind === "deny" && /unavailable/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once", { withService: false });
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + missing service denies", out.kind === "deny" && /approval service/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", signal: { aborted: false } });
    check("enforce + missing agent denies", out.kind === "deny");
  }
  {
    const h = makeCtx("allowed-once", { throwOnRequest: true });
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + throwing approval denies", out.kind === "deny" && /could not be confirmed/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: true } });
    check("aborted signal cancels before requesting", out.kind === "cancel" && h.requests() === 0);
  }

  // ---- 未受管工具两种模式都直接放行 ----
  {
    const h = makeCtx("rejected");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    await h.handlers["tools/pre-execute"][0](
      { name: "purge_status", signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("ungated tool passes through even in enforce", nextCalled === true && h.requests() === 0);
  }

  // ---- 一次批准不缓存 ----
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", agent: {}, signal: { aborted: false } });
    await runPre(h, exec());
    await runPre(h, exec());
    check("each call requests approval again", h.requests() === 2, "requests=" + h.requests());
  }

  // ---- post-execute 记结果，且不影响 next ----
  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    const out = await h.handlers["tools/post-execute"][0](
      { name: "purge_apply" },
      { isError: false, value: { text: "done" } },
      async () => "next",
    );
    check("post-execute passes result through", out === "next");
    check("result audited", readAudit().some((r) => r.phase === "result" && r.detail === "done"));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { auditPath: () => path.join("Z:\\nope\\nested", "audit.jsonl"), fs, path });
    const out = await h.handlers["tools/post-execute"][0]({ name: "purge_apply" }, { value: {} }, async () => "next");
    check("unwritable audit path does not break result", out === "next");
  }

  // ---- dispose 撤钩子 ----
  {
    const h = makeCtx("allowed-once");
    const gate = installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    check("two hooks installed", gate.installed === 2);
    gate.dispose();
    check("dispose removes hooks", h.handlers["tools/pre-execute"].length === 0 && h.handlers["tools/post-execute"].length === 0);
  }

  // ---- 路由确认：不强制审批，只认显式意图头 ----
  {
    const once = requestRouteApproval({ headers: { "x-dsh-purge-confirm": "once" } });
    check("route header once is explicit", once.ok === true && once.via === "header");
    const human = requestRouteApproval({ headers: {} });
    check("route without header is implicit human", human.ok === true && human.via === "human");
  }

  // ---- 结果映射 ----
  {
    check("allowed-once maps to allow", decisionFromOutcome("allowed-once").allow === true);
    check("cancelled maps to cancel", decisionFromOutcome("cancelled").kind === "cancel");
    check("rejected maps to deny", decisionFromOutcome("rejected").kind === "deny");
    check("unavailable maps to deny", decisionFromOutcome("unavailable").kind === "deny");
  }

  fs.rmSync(auditDir, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
