// Bring the drill console onto the harness's own tokens.
//
// The drill bundle is embedded into client.js from lib/redteam/client.js, so the
// fix belongs in the source and then has to be re-embedded with
// scripts/build-client.mjs. This script only edits the source file.
//
// Two substitutions, both mechanical:
//   · >1px coloured side/top border → 1px hairline (a colour stripe that thick is
//     the "generated card" tell; 1px still encodes severity without shouting)
//   · raw state hex → the harness state token, so dark/light both stay readable
//
// usage: node scripts/drill-skin.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, "lib", "redteam", "client.js");

const STATE_TOKEN = {
  "#10b981": "var(--dsw-alias-state-success-primary,#22c55e)",
  "#f59e0b": "var(--dsw-alias-state-warn-primary,#f59e0b)",
  "#ef4444": "var(--dsw-alias-state-error-primary,#ef4444)",
  "#64748b": "var(--dsw-alias-border-l3,#64748b)",
};

const src = fs.readFileSync(file, "utf8");
let changed = 0;

function count(re) {
  return (src.match(re) || []).length;
}

const remaining = count(/border-(left|right|top|bottom):[2-9]px solid (?:#[0-9a-fA-F]{3,8}|var\([^)]*\))/g);
if (process.argv.includes("--check")) {
  // 只统计「裸的」硬编码色：var(--token, #fallback) 里的兜底色是有意保留的。
  const bare = src.replace(/var\([^)]*\)/g, "");
  const hex = (bare.match(/#(?:10b981|f59e0b|ef4444|64748b)\b/gi) || []).length;
  console.log(remaining === 0 && hex === 0 ? "clean" : `${remaining} thick accent borders, ${hex} bare state hex`);
  process.exit(remaining === 0 && hex === 0 ? 0 : 1);
}

let out = src.replace(/border-(left|right|top|bottom):([2-9])px solid (#[0-9a-fA-F]{3,8}|var\([^)]*\))/g, (all, side, width, color) => {
  changed += 1;
  const tone = STATE_TOKEN[color.toLowerCase()] || color;
  return `border-${side}:1px solid ${tone}`;
});

for (const [hex, token] of Object.entries(STATE_TOKEN)) {
  const withAlpha = new RegExp(hex + "([0-9a-fA-F]{2})\\b", "gi");
  out = out.replace(withAlpha, () => {
    changed += 1;
    return `color-mix(in srgb,${token} 53%,transparent)`;
  });
  const plain = new RegExp(hex + "\\b", "gi");
  out = out.replace(plain, () => {
    changed += 1;
    return token;
  });
}

if (out === src) {
  console.log("no changes");
  process.exit(0);
}
fs.writeFileSync(file, out, "utf8");
console.log(`rewrote ${changed} declarations in lib/redteam/client.js; now run scripts/build-client.mjs`);
