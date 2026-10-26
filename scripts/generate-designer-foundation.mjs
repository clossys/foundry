#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = resolve(repository, "scripts/lib/designer-foundation.json");
const git = (cwd, args, options = {}) => execFileSync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, ...options });

function patternMatches(pattern, path) {
  // The package's files field selects directories and slash-separated globs.
  // Unsupported pattern syntax refuses rather than widening the foundation.
  if (/[\[\]{}()!]/.test(pattern)) throw new Error(`Unsupported package file pattern: ${pattern}`);
  let expression = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index++;
      if (pattern[index + 1] === "/") { index++; expression += "(?:.*/)?"; }
      else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[\\^$+.]/g, "\\$&");
  }
  return new RegExp(`^${expression}(?:/.*)?$`).test(path);
}

/** The receipt accepts one immutable package foundation, never the caller's
 * current checkout. Exact component ownership remains the checker's job. */
export function generateDesignerFoundation(cwd, source) {
  if (typeof source !== "string" || !/^[a-f0-9]{40}$/.test(source)) throw new Error("Exact immutable source commit or tree required");
  const tree = git(cwd, ["rev-parse", "--verify", `${source}^{tree}`], { encoding: "utf8" }).trim();
  const rows = git(cwd, ["ls-tree", "-rz", "--full-tree", tree, "--", "packages/designer"]).toString("utf8").split("\0").filter(Boolean).map(row => {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match) throw new Error("Foundation must contain regular Git blobs");
    return { mode: match[1], id: match[2], path: match[3].slice("packages/designer/".length) };
  });
  const packageRow = rows.find(row => row.path === "package.json");
  if (!packageRow) throw new Error("Designer package manifest missing from source");
  const packageJson = JSON.parse(git(cwd, ["cat-file", "blob", packageRow.id], { encoding: "utf8" }));
  if (!Array.isArray(packageJson.files) || packageJson.files.some(value => typeof value !== "string")) throw new Error("Designer package files contract required");
  // Nested ignore files would need their own npm packing semantics. Do not
  // silently invent a receipt if that package contract changes.
  if (rows.some(row => row.path === ".npmignore" || /^src\/.*\/(?:\.npmignore|\.gitignore)$/.test(row.path))) throw new Error("Nested package ignore contract requires explicit support");
  const included = packageJson.files.filter(pattern => !pattern.startsWith("!"));
  const excluded = packageJson.files.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1));
  const selected = rows.filter(row => row.path.startsWith("src/") && included.some(pattern => patternMatches(pattern, row.path)) && !excluded.some(pattern => patternMatches(pattern, row.path))).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!selected.length || ["src/components/index.ts", "src/catalog/slots/components.json", "src/catalog/aliases/components.json", "src/tokens/tokens.ts", "src/tokens/guidance.ts"].some(path => !selected.some(row => row.path === path))) throw new Error("Required Designer foundation blob missing from package source");
  if (selected.some(row => !["100644", "100755"].includes(row.mode))) throw new Error("Foundation requires regular source files");
  const objects = git(cwd, ["cat-file", "--batch"], { input: selected.map(row => row.id).join("\n") + "\n" });
  let offset = 0;
  const files = {};
  for (const row of selected) {
    const end = objects.indexOf(10, offset), header = objects.subarray(offset, end).toString("utf8");
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== row.id) throw new Error("Missing or mismatched immutable Git blob");
    const length = Number(match[2]), start = end + 1, bytes = objects.subarray(start, start + length);
    if (bytes.length !== length || objects[start + length] !== 10) throw new Error("Truncated immutable Git blob");
    files[row.path] = createHash("sha256").update(bytes).digest("hex");
    offset = start + length + 1;
  }
  if (offset !== objects.length) throw new Error("Unexpected immutable Git object output");
  return { schema: "designer-foundation/v1", sourceTree: tree, files };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3 || args[0] !== "--source" || !["--write", "--check"].includes(args[2])) throw new Error("usage: generate-designer-foundation.mjs --source EXACT_COMMIT_OR_TREE --write|--check");
    const receipt = generateDesignerFoundation(repository, args[1]), contents = JSON.stringify(receipt, null, 2) + "\n";
    if (args[2] === "--write") writeFileSync(receiptPath, contents);
    else if (readFileSync(receiptPath, "utf8") !== contents) throw new Error("Designer foundation receipt differs from the exact source");
    console.log(`Designer foundation ${args[2] === "--write" ? "written" : "current"}: ${receipt.sourceTree}, ${Object.keys(receipt.files).length} shipped source blobs`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
