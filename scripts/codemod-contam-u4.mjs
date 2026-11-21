#!/usr/bin/env node
/**
 * CONTAM-U4 codemod: a shipped file of the five agent packages cites only paths that resolve in the installed
 * package. The decision is the CLASS 1 resolver's own: this script runs `scripts/check-contamination-classes.mjs
 * packages/<pkg> --json --class 1` (the check is a CLI with no exports, so running it is how it is imported; there is
 * no second resolver here) and acts on each UNREACHABLE or ROT finding it reports, by one fixed rule each:
 *
 *   another package's file   the resolver's nearest file is under packages/<other>/: the cited path is replaced by
 *                            that package's name (`@clossys/<other>`), and a possessive naming the same package just
 *                            before it ("Producer's ") is dropped, since the name now says it.
 *   own file, misspelled     the nearest file is this package's own (not a test): the path is respelled relative to
 *                            the citing file (the CONTAM-U3 spelling). If that file does not ship, the next pass
 *                            finds it reachable but unshipped and applies the next rule.
 *   a file that does not ship  a test, a root docs/ or scripts/ file, a producer studio/ file, or this package's
 *                            own unshipped file: the path stays and " (not shipped)" follows it, the inline
 *                            statement the check reads as a stated unavailability.
 *
 * Refused, listed by file and line, never guessed (exit 1 while any remains):
 *   - ROT (the path exists nowhere): fixed by hand to the file that now holds the content, or removed;
 *   - the cited suffix names a file in more than one other package (the resolver's pick is arbitrary);
 *   - the nearest file is a vendored reference (references/**): the text names a reader or registry path, not a
 *     repository file;
 *   - the sentence names a different first-party package just before the path than the one the resolver found;
 *   - the line is forbidden scope: references/**, vendored components (src/components/partners/**), changelogs,
 *     or a generated region (between BEGIN GENERATED and END GENERATED markers), which changes only by its
 *     generator.
 * Findings the CONTAM groups give other units (a package's own `packages/<pkg>/` spelling, consumer-tree and
 * fixture paths) are skipped, not counted.
 *
 *   node scripts/codemod-contam-u4.mjs          rewrite in place until nothing changes, print each rewrite
 *   node scripts/codemod-contam-u4.mjs --check  write nothing; exit 1 when a rewrite or a refusal is pending
 *
 * A second run changes nothing.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGES = ["designer", "director", "producer", "publisher", "writer"];
const CHECK = "scripts/check-contamination-classes.mjs";
const NAMES = ["Bouncer", "Controller", "Designer", "Director", "Launcher", "Producer", "Publisher", "Writer"];
const FORBIDDEN = [/^references\//, /^src\/components\/partners\//, /(^|\/)changelogs?\//i, /(^|\/)CHANGELOG/i];
const QUALIFIER = " (not shipped)";

/** The cited path and the resolver's nearest file of one CLASS 1 finding (undefined `where` for ROT). */
export function parseDetail(detail) {
  const quoted = [...detail.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  return { cited: quoted[0] ?? "", where: quoted[1], rot: /no such path/.test(detail) };
}

/** The CONTAM group of a finding: G13 own-package spelling, G14 consumer tree or fixture, G15, G16, G17. */
export function groupOf(pkg, { cited, where, rot }) {
  const w = where ?? "";
  if (rot) return "G17";
  if (cited.startsWith(`packages/${pkg}/`)) return "G13";
  if (cited.startsWith("clossys/") || w.includes("/clossys/") || w.includes("test-fixtures") || w.includes("__fixtures__/")
    || w.startsWith("governance/release-qualification-fixtures") || w.startsWith("scripts/rules/fixtures")) return "G14";
  if (/\.test\./.test(w)) return "G16";
  if (w.startsWith("packages/") && !w.startsWith(`packages/${pkg}/`)) return "G15";
  return "G16";
}

/** Each occurrence of `cited` in `line` that the check's extraction would take as that whole path. */
function occurrences(line, cited) {
  const out = [];
  for (let at = line.indexOf(cited); at >= 0; at = line.indexOf(cited, at + 1)) {
    const before = line[at - 1] ?? "", after = line[at + cited.length] ?? "";
    if (/[@$\w/]/.test(before)) continue;
    if (/[\w/]/.test(after)) continue;
    out.push(at);
  }
  return out;
}

function inGeneratedRegion(lines, index) {
  for (let i = index; i >= 0; i--) {
    if (/END GENERATED/.test(lines[i]) && i !== index) return false;
    if (/BEGIN GENERATED/.test(lines[i])) return true;
  }
  return false;
}

/**
 * A package name the rewrite put next to the same name says it once: `X (X)`, `X X`, `X in X`, `X and X` and
 * `packages/<dir> X` keep the first `X` (backticked or not).
 */
export function collapse(text, name, owner) {
  const n = `\`?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`?`;
  let out = text;
  for (let before; before !== out;) {
    before = out;
    out = out.replace(new RegExp(`(${n}) \\(${n}\\)`, "g"), "$1")
      .replace(new RegExp(`(${n})(?: | in | and )${n}(?![\\w/-])`, "g"), "$1")
      .replace(new RegExp(`\\bpackages/${owner} (${n})`, "g"), "$1");
  }
  return out;
}

/**
 * The edit one finding asks for, or a refusal. `ctx`: `pkg`, `file` (package-relative), `lines` (the file's lines),
 * `tracked` (repository paths), `names` (package dir -> package.json name).
 */
export function planFinding(finding, ctx) {
  const { pkg, file, lines, tracked, names } = ctx;
  const parsed = parseDetail(finding.detail);
  const group = groupOf(pkg, parsed);
  const at = `packages/${pkg}/${file}:${finding.line}`;
  if (group === "G13" || group === "G14") return { skip: group };
  if (group === "G17") return { refuse: `${at}: ${parsed.cited} is ROT (exists nowhere); fix by hand or remove the citation` };
  if (FORBIDDEN.some(re => re.test(file))) return { refuse: `${at}: ${parsed.cited} sits in forbidden scope (${file})` };
  const index = finding.line - 1;
  const line = lines[index];
  if (line === undefined) return { refuse: `${at}: no such line` };
  if (inGeneratedRegion(lines, index)) return { refuse: `${at}: ${parsed.cited} is in a generated region; change its generator` };
  const where = parsed.where ?? "";
  if (/(^|\/)references\/[^/]+\//.test(where)) return { refuse: `${at}: ${parsed.cited} reaches only a vendored reference (${where}); not a repository citation` };
  const hits = occurrences(line, parsed.cited);
  if (hits.length !== 1) return { refuse: `${at}: ${parsed.cited} occurs ${hits.length} times as a path on the line` };
  const col = hits[0];
  if (group === "G15") {
    const owner = where.split("/")[1];
    const suffix = parsed.cited.replace(/^(?:\.\.?\/)+/, "");
    const owners = new Set(tracked.filter(p => p.startsWith("packages/") && !p.startsWith(`packages/${pkg}/`) && (p.endsWith(`/${suffix}`) || p === suffix)).map(p => p.split("/")[1]));
    if (owners.size > 1) return { refuse: `${at}: ${parsed.cited} names a file in ${owners.size} packages (${[...owners].sort().join(", ")}); the owner is not decidable` };
    const name = names[owner];
    if (!name) return { refuse: `${at}: ${parsed.cited} resolves to packages/${owner}, which has no package name` };
    const lead = line.slice(Math.max(0, col - 40), col);
    const named = [...lead.matchAll(new RegExp(`\\b(${NAMES.join("|")})(?:'s| package's)`, "g"))].map(m => m[1].toLowerCase());
    if (named.length && named.at(-1) !== owner) return { refuse: `${at}: the text names ${named.at(-1)} but ${parsed.cited} resolves to ${owner}` };
    const end = col + parsed.cited.length;
    const tick = line[col - 1] === "`" && line[end] === "`";
    const head = line.slice(0, tick ? col - 1 : col);
    const possessive = new RegExp(`(?:\\bthe )?\\b${owner}(?:'s| package's) $`, "i").exec(head);
    const cut = possessive ? head.length - possessive[0].length : head.length;
    const text = collapse(line.slice(0, cut) + (tick ? "`" : "") + name + line.slice(end), name, owner);
    return { edit: { index, text }, note: `${at}: ${parsed.cited} -> ${name} (G15, resolver: ${where})` };
  }
  if (where.startsWith(`packages/${pkg}/`) && !/\.test\./.test(where)) {
    const target = where.slice(`packages/${pkg}/`.length);
    let rel = posix.relative(posix.dirname(file), target);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    if (rel === parsed.cited) return { refuse: `${at}: ${parsed.cited} is already spelled relative to ${target}` };
    const text = line.slice(0, col) + rel + line.slice(col + parsed.cited.length);
    return { edit: { index, text }, note: `${at}: ${parsed.cited} -> ${rel} (own file, respelled)` };
  }
  let end = col + parsed.cited.length;
  if (line[col - 1] === "`" && line[end] === "`") end += 1;
  if (line.slice(end).startsWith(QUALIFIER)) return { refuse: `${at}: ${parsed.cited} already carries the qualifier` };
  const text = line.slice(0, end) + QUALIFIER + line.slice(end);
  return { edit: { index, text }, note: `${at}: ${parsed.cited} + "${QUALIFIER.trim()}" (G16, resolver: ${where || "-"})` };
}

/** Apply the plans of one file's findings; two findings on one line apply right to left by column. */
export function rewriteFile(pkg, file, text, findings, ctx) {
  const lines = text.split("\n");
  const notes = [], refusals = [], skipped = [];
  const byLine = new Map();
  for (const finding of findings) {
    const plan = planFinding(finding, { ...ctx, pkg, file, lines });
    if (plan.skip) { skipped.push(plan.skip); continue; }
    if (plan.refuse) { refusals.push(plan.refuse); continue; }
    if (byLine.has(plan.edit.index)) { notes.push(`${plan.note} (next pass)`); continue; }
    byLine.set(plan.edit.index, plan.edit.text);
    notes.push(plan.note);
  }
  for (const [index, line] of byLine) lines[index] = line;
  return { text: lines.join("\n"), notes: notes.filter(n => !n.endsWith("(next pass)")), deferred: notes.length - byLine.size, refusals, skipped };
}

/** One scoped CLASS 1 run of the check. Its JSON goes to a file: a pipe loses what the check has not flushed when it exits. */
function scan(repo, pkg) {
  const dir = mkdtempSync(join(tmpdir(), "codemod-contam-u4-"));
  const out = join(dir, `${pkg}.json`);
  const fd = openSync(out, "w");
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(repo, CHECK), `packages/${pkg}`, "--json", "--class", "1"], { cwd: repo, stdio: ["ignore", fd, "pipe"] });
    let err = "";
    child.stderr.on("data", d => { err += d; });
    child.on("close", code => {
      closeSync(fd);
      const text = readFileSync(out, "utf8");
      rmSync(dir, { recursive: true });
      if (code !== 0 && code !== 1) return fail(new Error(`${CHECK} packages/${pkg} exited ${code}: ${err.trim()}`));
      try { done(JSON.parse(text)); } catch (error) { fail(new Error(`${CHECK} packages/${pkg}: unreadable JSON (${error.message})`)); }
    });
  });
}

async function pass(repo, { check }) {
  const tracked = execFileSync("git", ["ls-files", "packages"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const names = {};
  for (const dir of new Set(tracked.map(p => p.split("/")[1]))) {
    try { names[dir] = JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8")).name; } catch { /* not a package */ }
  }
  const reports = await Promise.all(PACKAGES.map(pkg => scan(repo, pkg)));
  const notes = [], refusals = [], changes = [];
  let deferred = 0;
  PACKAGES.forEach((pkg, i) => {
    const report = reports[i];
    if (report.indeterminate?.length) refusals.push(`packages/${pkg}: ${report.indeterminate.length} indeterminate result(s); nothing is decided`);
    const byFile = new Map();
    for (const finding of report.findings) if (finding.class === 1) (byFile.get(finding.file) ?? byFile.set(finding.file, []).get(finding.file)).push(finding);
    for (const [file, findings] of [...byFile].sort()) {
      const path = join(repo, "packages", pkg, file);
      if (!existsSync(path)) {
        for (const finding of findings) {
          const group = groupOf(pkg, parseDetail(finding.detail));
          if (group !== "G13" && group !== "G14") refusals.push(`packages/${pkg}/${file}:${finding.line}: ${parseDetail(finding.detail).cited} is in a packed file with no tracked copy at that path`);
        }
        continue;
      }
      const before = readFileSync(path, "utf8");
      const result = rewriteFile(pkg, file, before, findings, { tracked, names });
      notes.push(...result.notes); refusals.push(...result.refusals); deferred += result.deferred;
      if (result.text !== before) changes.push([path, result.text]);
    }
  });
  if (!check) for (const [path, text] of changes) writeFileSync(path, text);
  return { notes, refusals, changes: changes.length, deferred };
}

export async function run(repo, { check = false } = {}) {
  const notes = [];
  let last;
  for (let round = 0; round < 4; round++) {
    last = await pass(repo, { check });
    notes.push(...last.notes);
    if (check || (last.changes === 0 && last.deferred === 0)) break;
  }
  const refused = last.refusals.length ? `\n${last.refusals.length} refused (fix by hand):\n${last.refusals.join("\n")}` : "";
  if (check) {
    const pending = last.notes.length + last.deferred;
    return { code: pending || last.refusals.length ? 1 : 0, text: `codemod-contam-u4 --check: ${pending} rewrite(s) pending${notes.length ? `\n${notes.join("\n")}` : ""}${refused}\n` };
  }
  return { code: last.refusals.length || last.changes ? 1 : 0, text: `codemod-contam-u4: ${notes.length} rewrite(s)${notes.length ? `\n${notes.join("\n")}` : ""}${refused}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== "--check");
  if (unknown.length) { process.stderr.write(`codemod-contam-u4: unknown argument ${unknown[0]}\nUsage: node scripts/codemod-contam-u4.mjs [--check]\n`); process.exit(2); }
  const result = await run(resolve(dirname(fileURLToPath(import.meta.url)), ".."), { check: args.includes("--check") });
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
