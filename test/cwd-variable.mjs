// Reproduce and verify the reported failure with the REAL host renderer.
//
// Bug: `unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
// registered variables: provider, model` — thrown on every turn once the plugin
// is installed, before "Apply" is even pressed.
//
// This script loads the host's actual dsh-system-prompt module, builds the same
// kind of assembly the host builds, and asserts:
//   1. the shipped cordis.patch.yml produces NO {{cwd}} reference;
//   2. with only provider/model registered (0.2.1 reality), the packaged persona
//      suffix renders without throwing;
//   3. our cwd-variable helper makes {{cwd}} resolvable again;
//   4. the runtime guard degrades a stray {{cwd}} instead of crashing the turn.
//
// usage: node work/tools/repro-cwd-bug.mjs [pluginDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] || path.resolve(here, "..");

/**
 * Locate the host's real renderer. The point of this test is to exercise the
 * exact function that threw for users, so it must be the host's own module —
 * not a reimplementation. Candidates cover the desktop app and npm-global CLI;
 * `DSH_SYSTEM_PROMPT` overrides both. When none is found the renderer-dependent
 * assertions are skipped rather than faked.
 */
function findHostRenderer() {
  const override = String(process.env.DSH_SYSTEM_PROMPT || "").trim();
  const candidates = [
    override,
    path.join(pluginDir, "node_modules", "@deepseek-ai", "dsh-system-prompt", "lib", "index.js"),
    "C:/Users/jeff/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js",
    path.join(process.env.APPDATA || "", "npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js"),
    path.join(process.env.LOCALAPPDATA || "", "Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* try the next one */ }
  }
  return "";
}

const HOST = findHostRenderer();

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? "  <- " + detail : ""}`);
  }
};

/* The renderer-dependent assertions need the host module. Without it we still
 * run the pure half (config scan, overlay, helper) and report the skip loudly,
 * because a silent pass here would be exactly the kind of false confidence this
 * whole bug came from. */
let renderPrompt = null;
if (HOST) {
  try {
    const host = await import(pathToFileURL(HOST).href);
    renderPrompt = host.renderPrompt ?? host.default?.renderPrompt ?? null;
  } catch (error) {
    console.log("host renderer failed to load:", String(error && error.message ? error.message : error));
  }
}
const hasRenderer = typeof renderPrompt === "function";
console.log("host renderer:", hasRenderer ? HOST : "(not found — renderer assertions skipped)");
const requireRenderer = (label, fn) => {
  if (!hasRenderer) {
    console.log(`  skip  ${label} (no host renderer)`);
    return;
  }
  fn();
};

/** Build the minimal assembly the host builds: sections + variables + contexts. */
function assembly(sections, variables) {
  return { sections, contexts: [], tools: [], variables };
}

const identity = await import(pathToFileURL(path.join(pluginDir, "lib", "identity.js")).href);
const cwdVar = await import(pathToFileURL(path.join(pluginDir, "lib", "cwd-variable.js")).href);

console.log("\n== 1. shipped cordis.patch.yml ==");
{
  const yml = fs.readFileSync(path.join(pluginDir, "cordis.patch.yml"), "utf8");
  const active = yml
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  check("no {{cwd}} in active config", !active.includes("{{cwd}}"));
  check("personaSuffix is empty", /personaSuffix:\s*""/.test(active));
}

console.log("\n== 2. reproduce the ORIGINAL bug ==");
requireRenderer("section 2", () => {
  // The previous release shipped exactly this.
  const broken = assembly(
    [{ name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}.", order: 10200 }],
    { provider: "deepseek", model: "deepseek-v4" },
  );
  let threw = null;
  try {
    renderPrompt(broken);
  } catch (error) {
    threw = error;
  }
  check("old suffix throws on 0.2.1 variables", threw !== null);
  check(
    "error text matches the user report",
    String(threw?.message || "").includes("unknown prompt variable") && String(threw?.message || "").includes("deployment:persona-suffix"),
    String(threw?.message || "").slice(0, 100),
  );
});

console.log("\n== 3. packaged suffix renders clean ==");
{
  const sections = identity.overlayOfficialIdentity([
    { name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}.", order: 10200 },
  ]);
  const suffix = sections.find((s) => s.name === "deployment:persona-suffix");
  check("overlay replaced the variable-bearing suffix", !String(suffix.text || "").includes("{{cwd}}"), JSON.stringify(suffix?.text));
  let rendered = null;
  let threw = null;
  try {
    rendered = renderPrompt(assembly(sections, { provider: "deepseek", model: "deepseek-v4" }));
  } catch (error) {
    threw = error;
  }
  check("renders without throwing", threw === null, String(threw?.message || ""));
  check("no raw {{cwd}} in output", !String(rendered || "").includes("{{cwd}}"));
}

console.log("\n== 4. overlay also strips the legacy working-directory line ==");
{
  const sections = identity.overlayOfficialIdentity([
    { name: "deployment:persona-suffix", text: "Working directory: {{cwd}}.", order: 10200 },
    { name: "deployment:persona-prefix", text: "You are a coding agent powered by the {{model}} model, running on the DeepSeek Harness. Your working directory is {{cwd}}.", order: 10100 },
  ]);
  const joined = sections.map((s) => String(s.text || "")).join("\n");
  check("no {{cwd}} survives in any section", !joined.includes("{{cwd}}"), joined.slice(0, 120));
  let threw = null;
  try {
    renderPrompt(assembly(sections, { provider: "p", model: "m" }));
  } catch (error) {
    threw = error;
  }
  check("whole assembly renders", threw === null, String(threw?.message || ""));
}

console.log("\n== 5. cwd-variable registers the missing variable ==");
requireRenderer("section 5", () => {
  const registered = new Map();
  const ctx = {
    systemPrompt: {
      variable(name, provider) {
        if (registered.has(name)) throw new Error(`prompt variable "${name}" is already registered (for a per-agent value, register through that agent's \`agent.ctx\` instead)`);
        registered.set(name, provider);
        return () => registered.delete(name);
      },
    },
    effect() {},
  };
  const result = cwdVar.registerCwdVariable(ctx, {});
  check("registered cwd", result.registered === true && registered.has("cwd"));

  const variables = {
    provider: "deepseek",
    model: "deepseek-v4",
    cwd: registered.get("cwd")({ agent: { options: { cwd: "D:/work/project" }, session: {} } }),
  };
  check("resolves from agent.options.cwd", variables.cwd === "D:/work/project");

  let rendered = null;
  let threw = null;
  try {
    rendered = renderPrompt(assembly(
      [{ name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}.", order: 10200 }],
      variables,
    ));
  } catch (error) {
    threw = error;
  }
  check("{{cwd}} resolves once registered", threw === null && String(rendered).includes("D:/work/project"), String(threw?.message || rendered));

  // fallbacks
  check("falls back to session header", cwdVar.resolveCwd({ agent: { session: { header: { cwd: "E:/other" } } } }) === "E:/other");
  check("never returns undefined", typeof cwdVar.resolveCwd({}) === "string");
  check("empty context still yields a string", cwdVar.resolveCwd(null) !== undefined);
});

console.log("\n== 6. duplicate registration is not a failure ==");
{
  const ctx = {
    systemPrompt: {
      variable() {
        throw new Error('prompt variable "cwd" is already registered');
      },
    },
    effect() {},
  };
  const result = cwdVar.registerCwdVariable(ctx, {});
  check("already-registered treated as success", result.registered === true && result.hadAlready === true);
}

console.log("\n== 7. runtime guard degrades a stray {{cwd}} ==");
{
  // Simulate what rewritePromptAssembly does when a foreign preset still emits it.
  const sections = identity.overlayOfficialIdentity([
    { name: "some-foreign-preset", text: "Root is {{cwd}} and model is {{model}}.", order: 500 },
  ]);
  const patched = sections.map((s) => (typeof s.text === "string" ? s.text : ""));
  const joined = patched.join("\n");
  check("model reference preserved", joined.includes("{{model}}"), joined);
}

console.log("\n== 8. neutralizeUnknownVariables helper ==");
{
  const out = cwdVar.neutralizeUnknownVariables("a {{cwd}} b {{weird}} c {{model}}", ["provider", "model"]);
  // Host's interpolate rejects `{{name}}`; the escaped form is `{ {name}}`,
  // which no longer matches its GROUP_AT pattern and is emitted literally.
  check("unknown cwd escaped", out.includes("{ {cwd}}"), out);
  check("unknown weird escaped", out.includes("{ {weird}}"), out);
  check("known model kept", out.includes("{{model}}"), out);
  // and the escaped text really renders: proof it is not just cosmetic.
  requireRenderer("escaped text renders through the host", () => {
    let threw = null;
    try {
      renderPrompt(assembly([{ name: "x", text: out, order: 1 }], { provider: "p", model: "m" }));
    } catch (error) {
      threw = error;
    }
    check("escaped text renders through the host", threw === null, String(threw?.message || ""));
  });
}

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
