/** Classification evidence only; these pinned upstream styles never ship as product CSS. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, basename, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import * as cssTree from "css-tree";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const commit = "daaf156ee00ed91cc7e6bdd937c1b4973152d141";
const fixture = "src/importers/__fixtures__/shadcn-aria";
const common = "scripts/__fixtures__/proc3-upstream";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const group = /^group(?:\/(?:--|-?[_a-zA-Z\u0080-\u{10ffff}])[_a-zA-Z0-9\u0080-\u{10ffff}-]*)?$/u;

// PostCSS understands Tailwind's raw @apply and nesting grammar. css-tree parses
// selectors independently, so comments, substrings and negations are not rules.
export function upstreamStyleRules(css, file) {
  const ast = postcss.parse(css, { from: file }), rules = new Map();
  const allowed = new Set(["import", "source", "custom-variant", "theme", "layer", "apply", "supports", "utility", "media", "variant", "slot", "property", "keyframes"]);
  const selectors = new Map();
  ast.walkAtRules(node => { if (!allowed.has(node.name)) throw new Error(`${file}: unsupported upstream @${node.name}`); });
  function classes(node, found = new Set()) {
    if (node.type === "PseudoClassSelector" && !["is", "where", "has", "nth-child", "nth-last-child"].includes(node.name.toLowerCase())) return found;
    if (node.type === "PseudoElementSelector") return found;
    if (node.type === "ClassSelector") found.add(cssTree.ident.decode(node.name));
    if (node.type === "AttributeSelector" && node.name?.name === "class" && ["=", "~="].includes(node.matcher)) {
      const value = node.value?.type === "String" ? node.value.value : node.value?.name;
      for (const token of (value ?? "").split(/\s+/).filter(Boolean)) found.add(cssTree.ident.decode(token));
    }
    node.children?.forEach(child => classes(child, found));
    return found;
  }
  ast.walkRules(node => {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (ancestor.type === "atrule" && /(?:^|-)keyframes$/.test(ancestor.name)) return;
    selectors.set(node, classes(cssTree.parse(node.selector, { context: "selectorList" })));
  });
  function record(node, kind) {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type === "atrule" && /(?:^|-)keyframes$/.test(ancestor.name)) return;
      for (const token of selectors.get(ancestor) ?? []) {
        const evidence = { file, line: ancestor.source.start.line, selector: ancestor.selector, kind };
        if (!rules.has(token)) rules.set(token, []);
        if (!rules.get(token).some(row => row.line === evidence.line && row.kind === kind)) rules.get(token).push(evidence);
      }
    }
  }
  ast.walkDecls(node => record(node, "declaration"));
  ast.walkAtRules("apply", node => {
    if (!node.params.trim() || node.nodes) throw new Error(`${file}: invalid upstream @apply`);
    record(node, "apply");
  });
  return rules;
}

export function upstreamMarkers(sourceClasses, read = readFileSync) {
  const inputHashes = [];
  function verified(file, expected) {
    const path = resolve(root, file), bytes = read(path);
    const sha256 = digest(bytes);
    if (sha256 !== expected) throw new Error(`Pinned upstream reference hash mismatch: ${file}`);
    inputHashes.push({ file: path, sha256 });
    return bytes.toString("utf8");
  }
  const provenance = JSON.parse(verified(`${fixture}/provenance.json`, "20e04f0fb613e489694a670c1da6706ca738e35524d076495cb253038bbc0cce"));
  const repository = provenance.repository;
  if (typeof repository !== "string" || provenance.commit !== commit || provenance.style !== "nova" || provenance.base !== "aria") throw new Error("Pinned upstream source identity mismatch");
  verified(`${fixture}/LICENSE.md`, "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f");
  const references = [
    { file: `${fixture}/style-nova.css`, path: "apps/v4/registry/styles/style-nova.css", sha256: "fd9803ec398290c306b377a46a769cad0c7ff024bf6a626993c113cacc20f16e", gitBlob: "293204b2bf08ddfd86dbc49b75dc4749cd2135ed" },
    { file: `${common}/globals.css`, path: "apps/v4/app/globals.css", sha256: "c5e271374236f23bcfd559ce64aaf6b8641ee7276156c0f803dd9cb24277af12", gitBlob: "00c2223f05d5ef295cc4849d4ccb716466b82ee4" },
    { file: `${common}/legacy-themes.css`, path: "apps/v4/app/legacy-themes.css", sha256: "b53f086328b730f0330d1d0eee6301564811511fa38cdbd3832db55ee3e32f85", gitBlob: "4e450a7911a4be94b04db5c68274e5d9fd2b0e17" },
    { file: `${common}/tailwind.css`, path: "packages/shadcn/src/tailwind.css", sha256: "4c371f7a1ff5d219ae2f7ff28bd256b4346fd546fe46fbae22092e57db2f0fae", gitBlob: "067bfc56fc086420835582f469e2c78d3942c69a" },
  ];
  const styling = new Map(), imports = [];
  for (const row of references) {
    const css = verified(row.file, row.sha256);
    for (const [token, evidence] of upstreamStyleRules(css, row.path)) styling.set(token, [...(styling.get(token) ?? []), ...evidence]);
    postcss.parse(css).walkAtRules("import", node => imports.push({ file: row.path, import: node.params }));
  }
  const sources = provenance.files.filter(row => /^apps\/v4\/registry\/bases\/aria\/ui\/[^/]+\.tsx$/.test(row.path)).map(row => {
    const file = `${fixture}/${basename(row.path, ".tsx")}.json`, bytes = read(resolve(root, file));
    const data = JSON.parse(bytes);
    if (data.repository !== repository || data.commit !== commit || data.files?.length !== 1) throw new Error(`Unverified pinned upstream source: ${file}`);
    const source = data.files[0];
    if (source.path !== row.path || source.sha256 !== row.sha256 || digest(source.content) !== row.sha256) throw new Error(`Pinned upstream source hash mismatch: ${file}`);
    inputHashes.push({ file: resolve(root, file), sha256: digest(bytes), upstreamPath: row.path, upstreamSha256: row.sha256 });
    return { path: row.path, content: source.content };
  });
  if (!sources.length) throw new Error("No verified pinned upstream class sources");
  const source = sourceClasses([], sources), markers = new Map();
  for (const [token, occurrences] of source.classes) if (/^cn-[a-zA-Z0-9_-]+$/.test(token) && !styling.has(token)) markers.set(token, { kind: "upstream-hook", occurrences: occurrences.map(row => ({ ...row, file: relative(root, row.file) })) });
  const frameworkPath = require.resolve("tailwindcss"), frameworkSha256 = "934fd25eee4dc84b2bb168b751816bba4c29cc6ed665a86ef6d6594c54da80d8";
  verified(frameworkPath, frameworkSha256);
  if (require("tailwindcss/package.json").version !== "4.3.3") throw new Error("Unverified Tailwind group semantics version");
  const framework = { package: "tailwindcss", version: "4.3.3", sha256: frameworkSha256, semantics: "compound group selects :where(.group[/modifier]) as a structural ancestor" };
  return { markers, styling, classify(token) { return group.test(token) ? { kind: "structural-group", framework } : markers.get(token); }, provenance: { repository, commit, style: "nova", base: "aria", references, imports, framework, scope: "Selected Nova and common upstream CSS; imports are recorded, not used as shipped coverage" }, inputHashes };
}
