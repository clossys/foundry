#!/usr/bin/env node
/**
 * check:no-consumer-content (foundry-feedback-0022 OWNERSHIP SPLIT, blocking): packages own L0-L3
 * only, so no package file is a consumer's L4 content.
 *
 *   consumer-tree  no tracked file under packages/** sits in a `clossys/agents/` folder, except the
 *                  synthetic fixture consumers (test-fixtures/, __fixtures__/).
 *   consumer-reach no tracked package file climbs out of its package into a `clossys` folder
 *                  (`../../clossys`): a package reads its consumer from configuration, never by path.
 *   pinned-text    no tracked package file outside the fixtures has the bytes of a consumer's pinned
 *                  candidate, or of a file a pinned Designer candidate carries inline. The consumer is
 *                  `--consumer <root>`, else `$CLOSSYS_ROOT` (a root holding clossys/), else the
 *                  repository root when it holds a clossys/ folder; with none, this rule has no input.
 *                  A candidate adopted byte-exact from a registry (`meta.source.kind` "registry")
 *                  carries the package's own vendored bytes, so it is not consumer content; nor is a
 *                  package's references/ mirror of an upstream source, which a composition may copy.
 *
 *   node scripts/check-no-consumer-content.mjs [--repo <repo root>] [--consumer <root>] [--json]
 *
 * Exit 0 when no package file is consumer content, 1 on any finding, 2 on a usage error.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const value = flag => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const repo = resolve(value("--repo") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
const consumerRoot = value("--consumer") !== undefined ? resolve(value("--consumer"))
  : process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT)
  : (existsSync(join(repo, "clossys", "agents")) ? repo : undefined);
if (!existsSync(join(repo, "packages"))) { console.error(`check-no-consumer-content: no packages/ under ${repo}`); process.exit(2); }

export const FIXTURE_ROOT = /(^|\/)(test-fixtures|__fixtures__)\//;
export const CONSUMER_REACH = /\.\.\/(?:\.\.\/)+clossys(?:\/|['"`]|$)/;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

const tracked = execFileSync("git", ["ls-files", "-z", "packages"], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
const findings = [];
for (const path of tracked) {
  if (path.includes("clossys/agents/") && !FIXTURE_ROOT.test(path)) findings.push({ rule: "consumer-tree", path, detail: "a consumer record tree inside a package" });
}

// The pinned bytes of the consumer: every pinned candidate, and every file a pinned Designer candidate carries.
const pinned = new Map();
if (consumerRoot) {
  const agents = join(consumerRoot, "clossys", "agents");
  for (const agent of existsSync(agents) ? readdirSync(agents) : []) {
    const agentDir = join(agents, agent);
    if (!statSync(agentDir).isDirectory()) continue;
    for (const slot of readdirSync(agentDir)) {
      const pinFile = join(agentDir, slot, "pin.json");
      if (!existsSync(pinFile)) continue;
      let pin; try { pin = JSON.parse(readFileSync(pinFile, "utf8")); } catch { continue; }
      if (typeof pin?.candidate !== "string") continue;
      const file = join(agentDir, slot, "candidates", pin.candidate);
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      let doc;
      if (pin.candidate.endsWith(".json")) { try { doc = JSON.parse(bytes.toString("utf8")); } catch { doc = undefined; } }
      if (doc?.meta?.source?.kind === "registry") continue;
      pinned.set(sha(bytes), `${agent}/${slot}/${pin.candidate}`);
      if (doc !== undefined) {
        for (const inline of Array.isArray(doc?.files) ? doc.files : []) {
          // A short inline file (an index re-export, an empty stub) is not distinctive content.
          if (typeof inline?.content === "string" && inline.content.length >= 200) pinned.set(sha(Buffer.from(inline.content, "utf8")), `${agent}/${slot}/${pin.candidate}#${inline.path}`);
        }
      }
    }
  }
}

for (const path of tracked) {
  if (FIXTURE_ROOT.test(path)) continue;
  const vendored = /^packages\/[^/]+\/references\//.test(path);
  const full = join(repo, path);
  let bytes; try { bytes = readFileSync(full); } catch { continue; }
  if (/\.(?:[cm]?[jt]sx?|json|md|css)$/.test(path) && CONSUMER_REACH.test(bytes.toString("utf8"))) findings.push({ rule: "consumer-reach", path, detail: "climbs out of the package into a clossys folder" });
  const from = vendored ? undefined : pinned.get(sha(bytes));
  if (from) findings.push({ rule: "pinned-text", path, detail: `the bytes of the consumer pin ${from}` });
}

const report = { repo, consumer: consumerRoot ?? null, tracked: tracked.length, pinnedFiles: pinned.size, findings };
if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  const byRule = findings.reduce((acc, row) => ({ ...acc, [row.rule]: (acc[row.rule] ?? 0) + 1 }), {});
  for (const row of findings.slice(0, 40)) console.log(`  ${row.rule} ${row.path}: ${row.detail}`);
  if (findings.length > 40) console.log(`  ... and ${findings.length - 40} more`);
  console.log(`check:no-consumer-content: ${findings.length ? `${findings.length} finding(s) ${JSON.stringify(byRule)}` : `no package file is consumer content`} (${tracked.length} package files, ${pinned.size} pinned files from ${consumerRoot ?? "no consumer"})`);
}
process.exit(findings.length ? 1 : 0);
