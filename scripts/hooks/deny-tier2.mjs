#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Bash matcher): deny the
// always-human (tier-2) command shapes described in docs/HITL-HOOKS.md
// and docs/HITL.md's "Where each tier is enforced" section, in
// clossys/foundry, PLUS a best-effort write-protection pass over a fixed
// list of protected paths. Reads the tool-call JSON Claude Code passes on
// stdin; exits 2 (block) with a reason on stderr for a match, exit 0
// (allow) otherwise. This is OPTIONAL, best-effort defence in depth --
// the control that actually matters is the tier-2 PR gate
// (governance/review-tiers.json + scripts/land-stack.mjs): a local write
// only matters once it is pushed, and a push goes through tier-2
// classification regardless of whether this hook is installed at all.
// See docs/HITL-HOOKS.md's "What it does and does not block" for the
// full, honestly-incomplete list of gaps text analysis of Bash can never
// close.
//
// THIS FILE ITSELF IS TIER-2 -- see docs/HITL-HOOKS.md's own header.
//
// #1187 escalation-rule round 6, both reviewers, blocking: rounds 3-4
// tried to enumerate every DANGEROUS write verb and flag combination.
// Every round, two independent reviewers found another one the
// enumeration missed. Round 6 replaced that model for PROTECTED-PATH
// write-detection with an allowlist: does this command reference a
// protected path AT ALL, and if so, is its verb one of the SMALL, closed
// set known to be safe -- failing closed on anything else, including a
// verb this hook has never seen before. Round 7 narrows several
// remaining gaps (multi-spelling ancestor directories, brace expansion,
// allowlisted verbs that can still write via a flag, a protected path
// used as the command itself) and several false positives the
// unresolved-variable rule caused on ordinary commands. It does NOT
// chase every remaining text-analysis gap -- see docs/HITL-HOOKS.md for
// what is deliberately left as a documented, undetectable bypass.

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";

// ---------------------------------------------------------------------
// Always-tier-2 command shapes (unrelated to protected-path write
// detection below) -- unchanged from round 4.
// ---------------------------------------------------------------------
const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  /\bgh\s+api\b[^\n]*\/branches\/\S+\/protection\b/i,
  /\bgh\s+api\b[^\n]*(?:-X|--method)\s+DELETE[^\n]*\/git\/refs\/heads\/\S+/i,
  /\bgh\s+secret\s+set\b/i,
  /\bgh\s+repo\s+edit\b/i,
  /\bgh\s+pr\s+merge\b[^\n]*--admin\b/i,
  /\bnpm\s+publish\b/i,
  /\bnpm\s+unpublish\b/i,
  /\bnpm\s+dist-tag\b/i,
  /\bgit\s+push\b[^\n]*(--force(?!-with-lease)\b|(?:^|\s)-f\b)/i,
  /\bgit\s+push\b[^\n]*\s\+\S+/,
  /\bgit\s+push\b[^\n]*(--delete\b|\s:\S+)/i,
];

// ---------------------------------------------------------------------
// Protected paths.
// ---------------------------------------------------------------------
const PROTECTED_BASENAME_PATTERNS = [
  /^hitl-escalation-rule[\w.-]*\.json$/i,
  /^HITL-RULE\.md$/i,
  /^HITL-HOOKS\.md$/i,
  /^deny-tier2\.mjs$/i,
  /^deny-tier2-edit\.mjs$/i,
  /^deny-tier2\.test\.mjs$/i,
  /^deny-tier2-edit\.test\.mjs$/i,
  /^settings\.json$/i,
  /^settings\.local\.json$/i,
];

const CONCRETE_PROTECTED_BASENAMES = [
  "hitl-escalation-rule.json",
  "hitl-escalation-rule-owner-chat.json",
  "hitl-escalation-rule-v2.json",
  "HITL-RULE.md",
  "HITL-HOOKS.md",
  "deny-tier2.mjs",
  "deny-tier2-edit.mjs",
  "deny-tier2.test.mjs",
  "deny-tier2-edit.test.mjs",
  "settings.json",
  "settings.local.json",
];

// Directories one level (or more) above a protected path, in every
// spelling this hook recognizes as equivalent (#1187 escalation-rule
// round 7, both reviewers, blocking B2: the exact-string comparison
// missed "docs/", "./docs", an absolute path, and the home-directory
// forms of the settings/hooks directory).
const ANCESTOR_DIRS = new Set(["docs", "governance", "governance/decisions", "scripts", "scripts/hooks", ".claude", "~/.claude", "~/.claude/hooks"]);

const HOME_DIR = (() => {
  try {
    return homedir();
  } catch {
    return null;
  }
})();

const RECURSIVE_FLAG = /^-[A-Za-z]*[rR][A-Za-z]*$/;
const FORCE_FLAG = /^-[A-Za-z]*f[A-Za-z]*$/;

const GIT_GLOBAL_FLAGS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const GIT_GLOBAL_FLAGS_BARE = new Set(["-p", "--paginate", "--no-pager", "--no-replace-objects", "--literal-pathspecs", "--bare"]);

// Strips git's own global flags (-C <dir>, -c <cfg>, --git-dir, ...) so
// the real subcommand can be read from args[0] -- without this, `git -C
// "$WT" status` sees "-C" as the "subcommand" and neither the read-only
// nor the ancestor-directory check recognizes plain `status` at all
// (#1187 escalation-rule round 7, fresh final reviewer, B4).
function stripGitGlobalFlags(args) {
  const rest = args.slice();
  while (rest.length) {
    const t = rest[0];
    if (GIT_GLOBAL_FLAGS_WITH_ARG.has(t)) {
      rest.shift();
      rest.shift();
      continue;
    }
    if (/^--(git-dir|work-tree|namespace|c)=/.test(t)) {
      rest.shift();
      continue;
    }
    if (GIT_GLOBAL_FLAGS_BARE.has(t)) {
      rest.shift();
      continue;
    }
    break;
  }
  return rest;
}

// The small, closed set of verbs allowed to reference a protected path
// at all when the reference is a real (literal/glob) match. Everything
// else -- including a verb this hook has never seen before -- is
// BLOCKED. "cp"/"rsync"/"mv"/"install" are deliberately NOT here (#1187
// escalation-rule round 7, both reviewers, blocking B1): every operand
// of any of these can be a destination (a directory target, `-t`, a
// flag placed after the real destination, `--remove-source-files`
// deleting the source), so round 6's "only the LAST argument is the
// destination" rule was wrong. If you need to read a protected file with
// one of these tools, use `cat`/`less`/`head`/`tail`/`grep` instead.
function isReadOnlyInvocation(verb, args) {
  switch (verb) {
    case "cat":
    case "less":
    case "more":
    case "head":
    case "tail":
    case "grep":
    case "egrep":
    case "fgrep":
    case "rg":
    case "wc":
    case "cmp":
    case "file":
    case "stat":
    case "ls":
      return true;
    case "jq":
      return !args.some((a) => a === "-i" || a === "--in-place");
    case "node":
      // #1187 escalation-rule round 7, fresh final reviewer, B1: node
      // stops parsing its OWN flags at the script path, so a trailing
      // `-c`/`--check` is passed to the SCRIPT, not consumed by node --
      // only the flag in the FIRST position is a real syntax-check.
      // `node --test` (running this repository's own hook tests) is
      // explicitly allowed too.
      if (args[0] === "--check" || args[0] === "-c") return true;
      if (args.includes("--test")) return true;
      return false;
    case "find":
      // Read-only UNLESS it can act on what it finds.
      return !args.some((a) => ["-exec", "-execdir", "-delete", "-fprint", "-fprintf", "-ok", "-okdir"].includes(a));
    case "diff":
    case "git": {
      // `diff` alone, and `git diff`/`log`/`show`/`blame`/`cat-file`,
      // are read-only UNLESS `--output`/`--output=...` is present, which
      // writes the result to a file instead of stdout (#1187
      // escalation-rule round 7, fresh final reviewer, B1).
      let rest = args;
      let sub = null;
      if (verb === "git") {
        const gitArgs = stripGitGlobalFlags(args);
        sub = gitArgs[0];
        if (!sub || !["show", "log", "diff", "blame", "cat-file"].includes(sub)) return false;
        rest = gitArgs.slice(1);
      }
      if (rest.some((a) => a === "--output" || a.startsWith("--output="))) return false;
      return true;
    }
    default:
      return false;
  }
}

// Verbs an UNRESOLVED variable (or unresolvable `$( )`/backtick
// expansion) should still be treated as risky for -- i.e. we don't know
// what the token resolves to, but this verb is generically capable of
// writing or deleting whatever path it's given. For every OTHER verb
// (gh, npm, node, python, an unrecognized one, ...), an unresolved
// variable alone is not enough to block -- only a real literal/glob
// match is (#1187 escalation-rule round 7, both reviewers, B4: this is
// what stops `gh pr view $N`, `node ... --dir "$S/x"`, and `git -C "$R"
// status` from false-positiving while `rm $F` still blocks).
const GENERIC_WRITE_SENSITIVE_VERBS = new Set(["rm", "mv", "cp", "tee", "sed", "perl", "dd", "truncate", "install", "ln", "rsync"]);
const GIT_WRITE_SENSITIVE_SUBCOMMANDS = new Set(["rm", "mv", "clean", "checkout", "restore", "reset", "stash", "apply"]);

function isWriteSensitiveVerb(verb, args) {
  if (GENERIC_WRITE_SENSITIVE_VERBS.has(verb)) return true;
  if (verb === "git") {
    const gitArgs = stripGitGlobalFlags(args);
    return GIT_WRITE_SENSITIVE_SUBCOMMANDS.has(gitArgs[0]);
  }
  return false;
}

// Normalizes one operand for the ancestor-directory check: strips a
// trailing "/" or "/.", a leading "./", collapses doubled slashes,
// recognizes both "~"/"$HOME"-relative and the real, resolved home
// directory as the same thing, resolves "." and ".." against the
// tracked `cd` state, and -- for a still-relative operand -- ALSO checks
// it joined onto the tracked `cd` state (`cd scripts && rm -rf hooks`),
// and -- for an absolute path -- ALSO checks its last one or two path
// components (#1187 escalation-rule round 7, both reviewers, blocking
// B2).
function normalizeAncestorSpelling(s) {
  let n = s;
  n = n.replace(/\/\.$/, "");
  n = n.replace(/\/+$/, "");
  while (n.startsWith("./")) n = n.slice(2);
  n = n.replace(/\/{2,}/g, "/");
  if (n === "") n = ".";
  return n;
}

function ancestorCandidates(rawToken, state) {
  if (!rawToken) return [];
  // Build a "~"-relative alternate spelling WITHOUT discarding the
  // original absolute form -- an absolute path under the real home
  // directory still needs its own last-1/2-component check below (#1187
  // escalation-rule round 7, fresh final reviewer, B2: overwriting the
  // token with the tilde form broke that check for every path under
  // $HOME, not just ~/.claude itself).
  let tildeForm = null;
  if (HOME_DIR && (rawToken === HOME_DIR || rawToken.startsWith(HOME_DIR + "/"))) {
    tildeForm = "~" + rawToken.slice(HOME_DIR.length);
  } else if (/^\$HOME\b/.test(rawToken)) {
    tildeForm = rawToken.replace(/^\$HOME\b/, "~");
  }

  const t = normalizeAncestorSpelling(rawToken);
  const out = new Set();
  if (t === ".") {
    out.add(state.impliedDir);
  } else if (t === "..") {
    out.add(parentOf(state.impliedDir));
  } else {
    out.add(t);
    if (!t.startsWith("/") && !t.startsWith("~") && state.impliedDir !== ".") {
      out.add(`${state.impliedDir}/${t}`.replace(/\/{2,}/g, "/"));
    }
    if (t.startsWith("/")) {
      const parts = t.split("/").filter(Boolean);
      if (parts.length >= 1) out.add(parts.slice(-1).join("/"));
      if (parts.length >= 2) out.add(parts.slice(-2).join("/"));
    }
  }
  if (tildeForm) out.add(normalizeAncestorSpelling(tildeForm));
  return [...out];
}

// Part (c): recursive/destructive operations on an ANCESTOR directory of
// a protected path, independent of whether any protected basename is
// itself named on the command line. `git rm`, `git checkout --`, `git
// restore`, and `git clean` all route through the SAME
// ancestorCandidates() normalization as plain `rm`/`mv` (#1187
// escalation-rule round 7, coordinator instruction: use the same check).
function checkAncestorDirectoryAttack(verb, args, state) {
  const resolved = args.map((a) => resolveVar(a, state.knownVars).value ?? a);
  const hitsAncestor = (list) => list.some((a) => ancestorCandidates(a, state).some((c) => ANCESTOR_DIRS.has(c)));

  if (verb === "rm") {
    const recursive = args.some((a) => RECURSIVE_FLAG.test(a) || a === "--recursive");
    if (recursive && hitsAncestor(resolved)) return "rm -r on an ancestor directory of a protected path";
    return null;
  }
  if (verb === "mv") {
    if (hitsAncestor(resolved)) return "mv of an ancestor directory of a protected path";
    return null;
  }
  if (verb === "ln") {
    if (args.includes("-s") && hitsAncestor(resolved)) {
      return "ln -s aliasing an ancestor directory of a protected path";
    }
    return null;
  }
  if (verb === "rsync") {
    if (args.includes("--delete") && hitsAncestor(resolved)) {
      return "rsync --delete into an ancestor directory of a protected path";
    }
    return null;
  }
  if (verb === "git") {
    const gitArgs = stripGitGlobalFlags(args);
    const sub = gitArgs[0];
    const rest = gitArgs.slice(1).map((a) => resolveVar(a, state.knownVars).value ?? a);
    if (sub === "rm") {
      const recursive = gitArgs.slice(1).some((a) => RECURSIVE_FLAG.test(a) || a === "--recursive");
      if (recursive && hitsAncestor(rest)) return "git rm -r on an ancestor directory of a protected path";
      return null;
    }
    if (sub === "mv") {
      if (hitsAncestor(rest)) return "git mv of an ancestor directory of a protected path";
      return null;
    }
    if (sub === "clean") {
      const forced = gitArgs.slice(1).some((a) => FORCE_FLAG.test(a) || a === "--force");
      const pathArgs = rest.filter((a) => !a.startsWith("-"));
      const cwdIsAncestor = ancestorCandidates(".", state).some((c) => ANCESTOR_DIRS.has(c));
      if (forced && (hitsAncestor(pathArgs) || (pathArgs.length === 0 && cwdIsAncestor))) {
        return "git clean on an ancestor directory of a protected path";
      }
      return null;
    }
    if (["checkout", "restore", "reset", "stash"].includes(sub)) {
      if (hitsAncestor(rest)) return `git ${sub} of an ancestor directory of a protected path`;
      return null;
    }
    return null;
  }
  return null;
}

function parentOf(dir) {
  const parts = dir.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

// ---------------------------------------------------------------------
// Command splitting: every line; ; && || | ( ) and backticks; after
// then/do/else; with leading whitespace stripped; and prefixes like
// sudo, env VAR=, time, command, nohup, xargs and absolute or
// \escaped binary paths peeled off. "{"/"}" are a command-group boundary
// only at a genuine word boundary -- glued onto a word (brace expansion,
// `HITL-{RULE,X}.md`) they are kept as literal characters instead
// (#1187 escalation-rule round 7, both reviewers, blocking: an earlier
// version treated every "{"/"}" as a boundary, shattering brace
// expansion into meaningless fragments and letting the reconstructed
// filename slip past basename matching entirely). This is deliberately
// NOT a full POSIX shell parser -- see docs/HITL-HOOKS.md for what that
// limits.
// ---------------------------------------------------------------------
function varBraceOpen(current) {
  const lastOpen = current.lastIndexOf("${");
  if (lastOpen === -1) return false;
  return current.lastIndexOf("}") < lastOpen;
}

function splitCommand(raw) {
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) segments.push(trimmed);
    current = "";
  };
  while (i < raw.length) {
    const ch = raw[i];
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && i + 1 < raw.length) {
        current += ch + raw[i + 1];
        i += 2;
        continue;
      }
      current += ch;
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < raw.length) {
      current += ch + raw[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      push();
      i++;
      continue;
    }
    // "${VAR}" is variable expansion, not a command group.
    if (ch === "{" && current.endsWith("$")) {
      current += ch;
      i++;
      continue;
    }
    if (ch === "}" && varBraceOpen(current)) {
      current += ch;
      i++;
      continue;
    }
    // Brace EXPANSION ("HITL-{RULE,X}.md") is glued directly onto a
    // word, with no preceding whitespace/separator; a brace GROUP
    // ("{ cmd; }") always has one. Only treat "{"/"}" as a boundary when
    // nothing but whitespace precedes it in the current segment.
    if (ch === "{" || ch === "}") {
      if (current.trim() === "") {
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "(" || ch === ")") {
      push();
      i++;
      continue;
    }
    if (ch === "&" && raw[i + 1] === "&") {
      push();
      i += 2;
      continue;
    }
    if (ch === "|" && raw[i + 1] === "|") {
      push();
      i += 2;
      continue;
    }
    // ">|" (noclobber-override) is not a pipe.
    if (ch === "|" && current.endsWith(">")) {
      current += ch;
      i++;
      continue;
    }
    if (ch === "|") {
      push();
      i++;
      continue;
    }
    // ">&file" / "&>file" (merge stdout+stderr to a file) are redirects,
    // not a background operator or a command separator (#1187
    // escalation-rule round 7, fresh final reviewer, B3).
    if (ch === "&" && current.endsWith(">")) {
      current += ch;
      i++;
      continue;
    }
    if (ch === "&" && raw[i + 1] === ">") {
      current += ch;
      i++;
      continue;
    }
    if (ch === "&") {
      push();
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  push();
  return segments;
}

// Word-tokenize one sub-command segment.
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;
  const flush = () => {
    if (hasContent) tokens.push(current);
    current = "";
    hasContent = false;
  };
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        i++;
        continue;
      }
      current += ch;
      hasContent = true;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        i++;
        continue;
      }
      if (ch === "\\" && i + 1 < segment.length && '"\\$`'.includes(segment[i + 1])) {
        current += segment[i + 1];
        hasContent = true;
        i += 2;
        continue;
      }
      current += ch;
      hasContent = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasContent = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasContent = true;
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < segment.length) {
      current += segment[i + 1];
      hasContent = true;
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      i++;
      continue;
    }
    if (ch === ">" || ch === "<") {
      flush();
      if (ch === ">" && segment[i + 1] === ">") {
        tokens.push(">>");
        i += 2;
        continue;
      }
      if (ch === ">" && segment[i + 1] === "|") {
        tokens.push(">|");
        i += 2;
        continue;
      }
      if (ch === ">" && segment[i + 1] === "&") {
        tokens.push(">&");
        i += 2;
        continue;
      }
      if (ch === "<" && segment[i + 1] === "<") {
        tokens.push("<<");
        i += 2;
        continue;
      }
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "&" && segment[i + 1] === ">") {
      flush();
      tokens.push("&>");
      i += 2;
      continue;
    }
    current += ch;
    hasContent = true;
    i++;
  }
  flush();
  return tokens;
}

// Separates redirect operator/target pairs out of a token stream. A `<`
// (or `<<`) target is ALWAYS a read; a `>`/`>>`/`>|`/`>&`/`&>` target is
// ALWAYS a write, unconditionally, regardless of the command's own verb.
function splitRedirects(tokens) {
  const commandTokens = [];
  const redirectOutputs = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "<" || t === "<<") {
      i++;
      continue;
    }
    if (t === ">" || t === ">>" || t === ">|" || t === ">&" || t === "&>") {
      const target = tokens[i + 1];
      if (target !== undefined) redirectOutputs.push(target);
      i++;
      continue;
    }
    commandTokens.push(t);
  }
  return { commandTokens, redirectOutputs };
}

const NOOP_LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "done", "fi", "esac", "in", "!"]);
const PASSTHROUGH_PREFIXES = new Set(["sudo", "time", "nohup", "command", "exec"]);

// Peels leading no-op keywords, VAR=value assignments, sudo/time/nohup/
// command/exec, env, and xargs -- then a leading absolute path or a
// backslash-escaped invocation off the verb itself. Returns the ORIGINAL
// first token too (`rawVerbToken`), before truncation/lowercasing, so
// the caller can still check it for a protected-path reference even
// when it isn't recognized as a normal shell verb at all.
function peelPrefixes(tokens, knownVars) {
  let t = tokens.slice();
  while (t.length && NOOP_LEADING_KEYWORDS.has(t[0])) t.shift();

  let changed = true;
  while (changed && t.length) {
    changed = false;
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) {
      const eq = t[0].indexOf("=");
      knownVars.set(t[0].slice(0, eq), t[0].slice(eq + 1));
      t.shift();
      changed = true;
    }
    if (t.length && PASSTHROUGH_PREFIXES.has(t[0])) {
      t.shift();
      changed = true;
      continue;
    }
    if (t.length && t[0] === "env") {
      t.shift();
      while (t.length && (t[0].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) {
          const eq = t[0].indexOf("=");
          knownVars.set(t[0].slice(0, eq), t[0].slice(eq + 1));
        }
        t.shift();
      }
      changed = true;
      continue;
    }
    if (t.length && t[0] === "xargs") {
      t.shift();
      while (t.length && t[0].startsWith("-")) t.shift();
      changed = true;
      continue;
    }
  }
  if (!t.length) return null;
  const rawVerbToken = t[0];
  let verb = t[0];
  if (verb.startsWith("\\")) verb = verb.slice(1);
  if (verb.includes("/")) verb = verb.slice(verb.lastIndexOf("/") + 1);
  return { verb: verb.toLowerCase(), args: t.slice(1), rawVerbToken };
}

// Resolves $VAR/${VAR} references against knownVars (assignments seen
// earlier in this SAME call) and, falling back, process.env (the hook
// runs with the same environment the command would) -- #1187
// escalation-rule round 7, both reviewers, B4: HOME/PATH/TMPDIR/PWD and
// similar are ROUTINELY unset in an agent's own tracked assignments but
// are real, resolvable environment variables; treating them as
// "unknown" is what caused most of round 6's false positives.
// Genuinely unresolved variable references, and any `$( )`/backtick
// command substitution (unresolvable from text alone), are REMOVED
// entirely from the value (not substituted with a wildcard) --
// referencesProtectedPath() and the caller's own "is the unresolved part
// the WHOLE basename" check then decide risk from what's left.
function resolveVar(token, knownVars) {
  let hasUnknownVar = false;
  let value = token.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced || bare;
    if (knownVars.has(name)) return knownVars.get(name);
    if (Object.prototype.hasOwnProperty.call(process.env, name)) return process.env[name];
    hasUnknownVar = true;
    return "";
  });
  if (/\$\(|`/.test(value)) {
    hasUnknownVar = true;
    value = value.replace(/\$\([^()]*\)/g, "").replace(/`[^`]*`/g, "");
  }
  return { value, hasUnknownVar };
}

function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const j = glob.indexOf("]", i + 1);
      if (j === -1) re += "\\[";
      else {
        re += "[" + glob.slice(i + 1, j) + "]";
        i = j;
      }
    } else if (c === "{") {
      const j = glob.indexOf("}", i + 1);
      if (j === -1) re += "\\{";
      else {
        const alts = glob
          .slice(i + 1, j)
          .split(",")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        re += "(?:" + alts.join("|") + ")";
        i = j;
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re, "i");
}

// Does this (already variable-resolved) token reference one of our
// protected paths, by literal/relative basename match or by a glob that
// COULD match one? A bare "*"/"?" with NO other literal character in the
// basename is skipped (#1187 escalation-rule round 7, both reviewers,
// B4: this is what a genuinely-authored glob like "packages/*" needs to
// stay allowed for an ordinary for-loop -- a wildcard alone gives no
// discriminating signal at all; "HITL-*.md" or "*.json" still have real
// literal characters and are still caught).
function referencesProtectedPath(value) {
  if (!value) return false;
  const base = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
  if (PROTECTED_BASENAME_PATTERNS.some((re) => re.test(base))) return true;
  if (/[*?[{]/.test(base) && base.replace(/[*?]/g, "").length > 0) {
    const re = globToRegExp(base);
    return CONCRETE_PROTECTED_BASENAMES.some((name) => re.test(name));
  }
  return false;
}

// Decides whether ONE token is risky: a real literal/glob match always
// is; an unresolved variable/expansion is risky ONLY when, after
// removing it, nothing concrete is left in the basename position at all
// (the unresolved part effectively WAS the filename) and the value
// doesn't end in "/" (clearly a directory reference, not a filename --
// #1187 escalation-rule round 7, both reviewers, B4: "$S/out.txt" and
// "$OUT/" are directory-qualified or trailing-slash forms that stay
// allowed; a bare "$F" is not).
function isRiskyToken(rawToken, knownVars) {
  const { value, hasUnknownVar } = resolveVar(rawToken, knownVars);
  if (referencesProtectedPath(value)) return { risky: true, viaUnknownVar: false };
  if (hasUnknownVar && !value.endsWith("/")) {
    const base = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
    if (base.trim() === "") return { risky: true, viaUnknownVar: true };
  }
  return { risky: false, viaUnknownVar: false };
}

// "for VAR in ITEM1 ITEM2 ...": binds VAR to a representative, SAFE
// literal value drawn from the item list (or to a matching one, if any
// item itself is a protected reference), so a later "$VAR" in the loop
// body is resolved instead of treated as an unknown, risky wildcard
// (#1187 escalation-rule round 7, both reviewers, B4: `for f in
// packages/*; do echo $f; done` and similar loops are routine in agent
// commands).
function tryBindForLoopVariable(commandTokens, knownVars) {
  if (commandTokens[0] !== "for") return false;
  const varName = commandTokens[1];
  if (!varName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName) || commandTokens[2] !== "in") return false;
  const items = commandTokens.slice(3);
  if (items.length === 0) return true;
  const matching = items.find((item) => !item.includes("$") && referencesProtectedPath(item));
  knownVars.set(varName, matching ?? items[0]);
  return true;
}

function evaluateSubCommand(segment, state) {
  const rawTokens = tokenize(segment);
  const { commandTokens, redirectOutputs } = splitRedirects(rawTokens);

  if (tryBindForLoopVariable(commandTokens, state.knownVars)) return { blocked: false };

  // A `>`/`>>`/`>|`/`>&`/`&>` target is ALWAYS a write -- unconditional,
  // whatever the command's own verb is, and unresolved-variable risk
  // always counts here (there is no "verb" a redirect target can be
  // read-only for).
  for (const target of redirectOutputs) {
    const { risky } = isRiskyToken(target, state.knownVars);
    if (risky) return { blocked: true, reason: `redirect to a protected (or unresolvable) path: ${target}` };
  }

  const peeled = peelPrefixes(commandTokens, state.knownVars);
  if (!peeled) return { blocked: false };
  const { verb, args, rawVerbToken } = peeled;

  // A protected path used AS THE COMMAND ITSELF -- most commonly an
  // artifact of `$(cmd)`/backtick splitting putting the real payload in
  // the verb slot, e.g. "$(echo rm) docs/HITL-RULE.md" -- is blocked
  // outright (#1187 escalation-rule round 7, fresh final reviewer, B3).
  if (rawVerbToken !== undefined) {
    const { risky } = isRiskyToken(rawVerbToken, state.knownVars);
    if (risky) return { blocked: true, reason: `protected path used as the command itself: ${rawVerbToken}` };
  }

  if (verb === "cd") {
    updateImpliedDir(state, args[0]);
    return { blocked: false };
  }

  const ancestorHit = checkAncestorDirectoryAttack(verb, args, state);
  if (ancestorHit) return { blocked: true, reason: ancestorHit };

  let referencesProtected = false;
  let sawConcreteMatch = false;
  let sawUnknownVarMatch = false;
  for (const arg of args) {
    const { risky, viaUnknownVar } = isRiskyToken(arg, state.knownVars);
    if (risky) {
      referencesProtected = true;
      if (viaUnknownVar) sawUnknownVarMatch = true;
      else sawConcreteMatch = true;
    }
  }

  if (!referencesProtected) return { blocked: false };
  // A match derived ONLY from an unresolved variable/expansion -- never
  // a real literal or glob match -- only counts for verbs known to be
  // generically write-capable; every other verb (gh, npm, an unknown
  // one, ...) is allowed (#1187 escalation-rule round 7, both reviewers,
  // B4).
  if (sawUnknownVarMatch && !sawConcreteMatch && !isWriteSensitiveVerb(verb, args)) {
    return { blocked: false };
  }
  if (isReadOnlyInvocation(verb, args)) return { blocked: false };
  return { blocked: true, reason: `verb "${verb}" references a protected path and is not on the read-only allowlist` };
}

function updateImpliedDir(state, arg) {
  if (!arg) return;
  if (arg === "-") return;
  if (arg.startsWith("/")) {
    state.impliedDir = arg.replace(/^\/+/, "");
    return;
  }
  if (arg === "~" || arg.startsWith("~/")) {
    state.impliedDir = "~";
    return;
  }
  if (arg === ".") return;
  if (arg === "..") {
    state.impliedDir = parentOf(state.impliedDir);
    return;
  }
  state.impliedDir = state.impliedDir === "." ? arg : `${state.impliedDir}/${arg}`;
}

function evaluateCommand(command) {
  for (const re of DENY_PATTERNS) {
    if (re.test(command)) return { blocked: true, reason: `tier-2 command shape, pattern: ${re}` };
  }
  const segments = splitCommand(command);
  const state = { knownVars: new Map(), impliedDir: "." };
  for (const segment of segments) {
    const result = evaluateSubCommand(segment, state);
    if (result.blocked) return result;
  }
  return { blocked: false };
}

export {
  evaluateCommand,
  splitCommand,
  tokenize,
  splitRedirects,
  peelPrefixes,
  resolveVar,
  referencesProtectedPath,
  checkAncestorDirectoryAttack,
  ancestorCandidates,
  isReadOnlyInvocation,
  isWriteSensitiveVerb,
  isRiskyToken,
  tryBindForLoopVariable,
  stripGitGlobalFlags,
  globToRegExp,
};

// Only run the stdin-driven hook protocol when executed directly (not
// when imported by the test file) -- resolved via realpathSync on BOTH
// sides so a copy install into a path with a space in it, or a symlink
// to this file, still matches (#1187 escalation-rule round 7, fresh
// final reviewer, non-blocking: an earlier version compared
// `import.meta.url` against a raw `file://${process.argv[1]}` string,
// which silently FAILED OPEN -- no check ran at all -- for either case).
function isRunDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isRunDirectly()) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      process.exit(0);
    }
    const command = typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
    if (!command) process.exit(0);

    const result = evaluateCommand(command);
    if (result.blocked) {
      process.stderr.write(`Blocked by user-level deny hook (docs/HITL-HOOKS.md, clossys/foundry): ${result.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
