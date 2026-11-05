#!/usr/bin/env node
/**
 * No hidden fallbacks in shipped Producer code (rule R-NO-HIDDEN-FALLBACKS: no temp solutions;
 * delete shims, never extend).
 *
 * A finding is a `catch` clause that swallows its error: the block neither rethrows (any `throw`),
 * nor reads the caught error, nor reports the failure. Reporting is a call to issue/fail/reject/
 * report/error/warn (or console.error/warn), a `.push(` onto an error channel (a name ending in
 * issues, errors, findings, failures, problems, missing or blockedBy), an HTTP 4xx/5xx reply, or an
 * error record handed on: an error-state string (error, invalid, failed, rejected, blocked,
 * unavailable, missing, alone or as the head of a kebab id such as `invalid-pin`), an object with
 * `ok: false` or a `message`/`error`/`code`, a flag named for an error or failure set to true, or
 * the identifier `unavailable`. A block that is exactly `return false;` is the "no" answer of a
 * yes/no probe, not a substitute value. Everything else turns a broken input into a silent default
 * (the Foundry theme, an empty list, the newest draft, an unknown icon, a second lookup place),
 * which is the fallback the rule forbids. Code is parsed with TypeScript, so comments never count
 * as reporting.
 *
 * Scope: packages/producer/{src,bin} and packages/producer/studio/{app,lib,components,frames,
 * sections}, outside tests (*.test.*, *.spec.*), declaration files, generated/, fixtures and dist.
 *
 * Usage: node scripts/check-no-hidden-fallbacks.mjs [--root <producer package dir>] [--json]
 * Exit 0 clean, 1 findings, 2 usage error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const DIRS = ["src", "bin", "studio/app", "studio/lib", "studio/components", "studio/frames", "studio/sections"];
const SKIP = new Set(["node_modules", "dist", "generated", "__fixtures__", "fixtures", ".next"]);
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const NOT_SHIPPED = /\.(?:test|spec)\.[^.]+$|\.d\.ts$/;
const REPORTER = /^(?:issue|fail|reject|report|error|warn|addFinding)$/;
const CHANNEL = /(?:issues|findings|failures|errors|missing|blockedBy|problems)$/i;
const ERROR_STATE = /^(?:error|invalid|failed|rejected|blocked|unavailable|missing)(?:-[a-z0-9]+)*$/;
const ERROR_FLAG = /(?:error|fail|invalid)/i;
const RECORD_KEYS = new Set(["message", "error", "code"]);

const keyName = (name, sf) => ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText(sf);
/** An object literal that is an error record: `ok: false`, or a message/error/code property. */
const errorRecord = (node, sf) => ts.isObjectLiteralExpression(node) && node.properties.some(property =>
  ts.isPropertyAssignment(property) && (RECORD_KEYS.has(keyName(property.name, sf))
    || keyName(property.name, sf) === "ok" && property.initializer.kind === ts.SyntaxKind.FalseKeyword));
/** The block is exactly `return false;`: the negative answer of a yes/no probe. */
const probeAnswer = block => block.statements.length === 1 && ts.isReturnStatement(block.statements[0])
  && block.statements[0].expression?.kind === ts.SyntaxKind.FalseKeyword;

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE.test(name) && !NOT_SHIPPED.test(name)) out.push(full);
  }
  return out;
}

/** True when the catch block surfaces the failure instead of swallowing it. */
function surfaces(clause, sf) {
  const bound = clause.variableDeclaration?.name;
  const name = bound && ts.isIdentifier(bound) ? bound.text : undefined;
  let found = false;
  const visit = node => {
    if (found) return;
    if (ts.isThrowStatement(node)) found = true;
    else if (name && ts.isIdentifier(node) && node.text === name && node !== bound) found = true;
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && REPORTER.test(callee.text)) found = true;
      else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text, target = callee.expression;
        const owner = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : "";
        if (method === "push" && CHANNEL.test(owner)) found = true;
        if (owner === "console" && (method === "error" || method === "warn")) found = true;
        if (REPORTER.test(method) && owner !== "Promise") found = true;
      }
      if (!found && ts.isIdentifier(callee) && callee.text === "json" && node.arguments.length > 1 && ts.isNumericLiteral(node.arguments[1]) && Number(node.arguments[1].text) >= 400) found = true;
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ERROR_STATE.test(node.text)) found = true;
    else if (ts.isIdentifier(node) && node.text === "unavailable") found = true;
    else if (errorRecord(node, sf)) found = true;
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.right.kind === ts.SyntaxKind.TrueKeyword
      && ERROR_FLAG.test(ts.isPropertyAccessExpression(node.left) ? node.left.name.text : node.left.getText(sf))) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  if (probeAnswer(clause.block)) return true;
  visit(clause.block);
  return found;
}

export function findHiddenFallbacks(packageDir) {
  const findings = [];
  const files = DIRS.flatMap(dir => walk(join(packageDir, dir), []));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = node => {
      if (ts.isCatchClause(node) && !surfaces(node, sf)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const body = node.block.getText(sf).replace(/\s+/g, " ").slice(0, 100);
        findings.push({ path: `${relative(packageDir, file).split(sep).join("/")}:${line}`, message: `catch swallows its error: ${body}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { files: files.length, findings };
}

function main(args) {
  const at = args.indexOf("--root");
  if (at >= 0 && !args[at + 1]) { console.error("check-no-hidden-fallbacks: --root needs a directory"); return 2; }
  const packageDir = at >= 0 ? resolve(args[at + 1]) : resolve(here, "..");
  if (!existsSync(join(packageDir, "src")) && !existsSync(join(packageDir, "studio"))) { console.error(`check-no-hidden-fallbacks: no src/ or studio/ under ${packageDir}`); return 2; }
  const { files, findings } = findHiddenFallbacks(packageDir);
  if (args.includes("--json")) console.log(JSON.stringify({ files, findings }, null, 2));
  else {
    console.log(`check-no-hidden-fallbacks: ${files} files, ${findings.length} finding(s)`);
    for (const finding of findings) console.log(`  ${finding.path} [silent-catch] ${finding.message}`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
