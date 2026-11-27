#!/usr/bin/env node
// check:agent-lists: no source file writes out a list of agent ids. Every agent is defined once, in
// docs/contracts/agents.json (check:agents-definition, owned by Controller), and code reads a named list
// from it: root scripts through scripts/lib/agent-lists.mjs `agentList(name)`, a package through its
// generated copy's AGENT_LISTS. A list written out by hand reaches only the agents of the day it was
// written; a new agent never joins its loop.
//
// A literal list of agent ids is any of these, read from the syntax tree (TypeScript compiler API):
//   array  an array literal whose string elements are all agent ids, at least two distinct;
//   union  a union type whose string literal members are all agent ids, at least two distinct;
//   regex  an alternation group, in a regular expression literal or a string or template text,
//          whose alternatives are all agent ids, at least two distinct: `(director|designer)`.
// An agent id is the id of a row of agents.json.
//
// Scanned: every code file (.ts .tsx .mts .cts .js .jsx .mjs .cjs) git tracks or would track
// (`git ls-files --cached --others --exclude-standard`) except test and fixture files, which hold the
// expected values a test compares the read list with (TEST_OR_FIXTURE). agents.json and its generated
// outputs are where the lists are written; the outputs are GENERATED in check-agents-definition.mjs,
// each one the render of agents.json byte for byte, so they are not scanned.
//
// Usage: node scripts/check-agent-lists.mjs [--root DIR] [--json]
// Exit 0 when no source file holds a list, 1 on any finding, 2 on a usage error or an unreadable source.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_PATH, GENERATED } from "./check-agents-definition.mjs";

const ts = createRequire(import.meta.url)("typescript");

export const CODE = /\.[cm]?[jt]sx?$/;
export const TEST_OR_FIXTURE = /(?:^|\/)(?:test|tests|__tests__|fixtures|__fixtures__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** The generated outputs of agents.json: written by `node scripts/check-agents-definition.mjs --write`. */
export const GENERATED_OUTPUTS = Object.freeze(GENERATED.map((copy) => copy.path));
const ALTERNATION = /\((?:\?:|\?<[A-Za-z]\w*>)?([a-z][a-z-]*(?:\|[a-z][a-z-]*)+)\)/g;

const scriptKind = (path) => (/x$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/** The literal agent lists in one file's text: [{ line, kind, members }]. Pure. */
export function findLists(path, text, ids) {
  const found = [];
  const isList = (members) => members.length >= 2 && members.every((member) => ids.has(member)) && new Set(members).size >= 2;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const add = (node, kind, members) => found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, members });
  const visit = (node) => {
    if (ts.isArrayLiteralExpression(node)) {
      const members = node.elements.filter((item) => ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)).map((item) => item.text);
      if (isList(members)) add(node, "array", members);
    } else if (ts.isUnionTypeNode(node)) {
      const members = node.types.filter((item) => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal)).map((item) => item.literal.text);
      if (isList(members)) add(node, "union", members);
    } else if (node.kind === ts.SyntaxKind.RegularExpressionLiteral || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const match of node.text.matchAll(ALTERNATION)) {
        const members = match[1].split("|");
        if (isList(members)) add(node, "regex", members);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every scanned file's findings: [{ rule, subject, message }]. Pure. */
export function evaluate(sources) {
  const findings = [];
  for (const file of sources.files) {
    for (const item of findLists(file.path, file.text, sources.ids)) {
      findings.push({ rule: "agent-list", subject: `${file.path}:${item.line}`, message: `${item.kind} of agent ids ${item.members.join(", ")} written out; read a named list of ${AGENTS_PATH} (scripts/lib/agent-lists.mjs, or the package's generated copy)` });
    }
  }
  return findings;
}

/** The agent ids and every scanned file under `root`. Throws when a source cannot be read. */
export function readSources(root) {
  const ids = new Set(JSON.parse(readFileSync(join(root, AGENTS_PATH), "utf8")).agents.map((row) => row.id));
  const generated = new Set(GENERATED_OUTPUTS);
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((path) => CODE.test(path) && !TEST_OR_FIXTURE.test(path) && !generated.has(path))
    .sort();
  const files = [];
  for (const path of paths) {
    let text;
    try { text = readFileSync(join(root, path), "utf8"); } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    files.push({ path, text });
  }
  return { ids, files };
}

function parseArgs(argv) {
  const args = { root: resolve(fileURLToPath(new URL("..", import.meta.url))), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") args.json = true;
    else if (argv[index] === "--root" && argv[index + 1]) args.root = resolve(argv[(index += 1)]);
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  let sources;
  try {
    args = parseArgs(process.argv.slice(2));
    sources = readSources(args.root);
  } catch (error) {
    console.error(`check-agent-lists: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const findings = evaluate(sources);
  if (args.json) console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  else {
    for (const item of findings) console.log(`${item.rule} ${item.subject}: ${item.message}`);
    console.log(`check-agent-lists: ${sources.files.length} source files, ${findings.length} finding(s)`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
