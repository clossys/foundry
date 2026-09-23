#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Bash matcher): deny the
// always-human (tier-2) command shapes described in docs/HITL-HOOKS.md
// and docs/HITL.md's "Where each tier is enforced" section, in
// clossys/foundry, PLUS a best-effort write-protection pass over a fixed
// list of protected paths. Reads the tool-call JSON Claude Code passes on
// stdin; exits 2 (block) with a reason on stderr for a match, exit 0
// (allow) otherwise. This is a SEATBELT, not a lock -- see
// docs/HITL-HOOKS.md's "What it does and does not block" for the named
// gaps.
//
// THIS FILE ITSELF IS TIER-2 -- see docs/HITL-HOOKS.md's own header.
//
// #1187 escalation-rule round 6, both reviewers, blocking: rounds 3-4
// tried to enumerate every DANGEROUS write verb and flag combination
// (sed -i, --in-place, -E -i, perl -pi, -i -pe, mv/cp/tee anchoring,
// dd of=, >, >>, >|, ...). Every round, two independent reviewers found
// another verb, flag spelling, or command shape the enumeration missed
// (a denylist of write verbs can never be complete -- there is always
// another one). This round replaces that model for PROTECTED-PATH
// write-detection specifically: instead of asking "is this one of the
// verbs we know are dangerous", it asks "does this command reference a
// protected path AT ALL, and if so, is its verb one of the SMALL,
// closed set we know is safe" -- failing closed (BLOCK) on anything
// else, including a verb this hook has never seen before. The
// always-tier-2 COMMAND-SHAPE patterns below (gh api, npm publish, git
// push --force, ...) are a different, already-small, well-enumerated
// set and are unchanged.

// ---------------------------------------------------------------------
// Always-tier-2 command shapes (unrelated to protected-path write
// detection below) -- unchanged from round 4.
// ---------------------------------------------------------------------
const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  // branches/<branch>/protection -- <branch> can itself contain a "/"
  // (e.g. claude/foo), so this must NOT stop at the first slash the way
  // [^/\s]+ would.
  /\bgh\s+api\b[^\n]*\/branches\/\S+\/protection\b/i,
  // Deleting a branch via the raw Git refs API instead of `git push
  // --delete` -- a second way to the same always-tier-2 end this hook's
  // git-push patterns below do not see at all. Matches both gh's short
  // (`-X`) and long (`--method`) form.
  /\bgh\s+api\b[^\n]*(?:-X|--method)\s+DELETE[^\n]*\/git\/refs\/heads\/\S+/i,
  /\bgh\s+secret\s+set\b/i,
  /\bgh\s+repo\s+edit\b/i,
  /\bgh\s+pr\s+merge\b[^\n]*--admin\b/i,
  /\bnpm\s+publish\b/i,
  /\bnpm\s+unpublish\b/i,
  /\bnpm\s+dist-tag\b/i,
  // --force, or a standalone -f token, but not --force-with-lease.
  /\bgit\s+push\b[^\n]*(--force(?!-with-lease)\b|(?:^|\s)-f\b)/i,
  // A "+refspec" force-push shorthand anywhere after "git push".
  /\bgit\s+push\b[^\n]*\s\+\S+/,
  // "--delete <branch>", or ":branch" (including a slash-named branch).
  /\bgit\s+push\b[^\n]*(--delete\b|\s:\S+)/i,
];

// ---------------------------------------------------------------------
// Protected paths: the rule file, this hook's own definition (both
// scripts and their tests), the rule's decision record and any
// superseding successor, and the settings files that register or
// disable either hook.
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

// Concrete example basenames, used only to test a GLOB token against --
// "does this glob pattern match any of our actual protected filenames".
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

// Directories one level (or more) above a protected path. A recursive or
// destructive operation on one of THESE destroys or replaces every
// protected path beneath it without ever naming the protected path's own
// basename on the command line at all.
const ANCESTOR_DIRS = new Set(["docs", "governance", "governance/decisions", "scripts", "scripts/hooks", ".claude"]);

// The small, closed set of verbs allowed to reference a protected path
// at all. Everything else -- including a verb this hook has never seen
// before -- is BLOCKED when it references a protected path. This is the
// "fails closed on unknown verbs" property the denylist model could
// never have.
function isReadOnlyInvocation(verb, args, lastArgReferencesProtected) {
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
    case "diff":
    case "cmp":
    case "file":
    case "stat":
    case "ls":
      return true;
    case "jq":
      // jq's in-place edit flag. No combined-short-flag form exists for
      // jq (it takes long options), so an exact-token check is enough.
      return !args.some((a) => a === "-i" || a === "--in-place");
    case "node":
      // Only a syntax check -- never a real execution -- is read-only.
      return args.includes("--check") || args.includes("-c");
    case "git": {
      const sub = args[0];
      return sub !== undefined && ["show", "log", "diff", "blame", "cat-file"].includes(sub);
    }
    case "cp":
    case "rsync":
      // The protected path may be a SOURCE (read), never the
      // destination (write) -- lastArgReferencesProtected tracks
      // whether the FINAL argument (the real destination for both
      // tools, `-t`/`--target-directory` aside) is the protected one.
      return !lastArgReferencesProtected;
    default:
      return false;
  }
}

const RECURSIVE_FLAG = /^-[A-Za-z]*[rR][A-Za-z]*$/;
const FORCE_FLAG = /^-[A-Za-z]*f[A-Za-z]*$/;

// Part (c): recursive/destructive operations on an ANCESTOR directory of
// a protected path, independent of whether any protected basename is
// itself named on the command line.
function checkAncestorDirectoryAttack(verb, args, state) {
  const resolved = args.map((a) => resolveVar(a, state.knownVars).value ?? a);
  const hitsAncestor = (list) =>
    list.some((a) => {
      const cwdResolved = a === "." ? state.impliedDir : a === ".." ? parentOf(state.impliedDir) : null;
      return ANCESTOR_DIRS.has(a) || (cwdResolved !== null && ANCESTOR_DIRS.has(cwdResolved));
    });

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
    const sub = args[0];
    const rest = resolved.slice(1);
    if (sub === "rm") {
      const recursive = args.slice(1).some((a) => RECURSIVE_FLAG.test(a) || a === "--recursive");
      if (recursive && hitsAncestor(rest)) return "git rm -r on an ancestor directory of a protected path";
      return null;
    }
    if (sub === "mv") {
      if (hitsAncestor(rest)) return "git mv of an ancestor directory of a protected path";
      return null;
    }
    if (sub === "clean") {
      const forced = args.slice(1).some((a) => FORCE_FLAG.test(a) || a === "--force");
      const pathArgs = rest.filter((a) => !a.startsWith("-"));
      const cwdIsAncestor = ANCESTOR_DIRS.has(state.impliedDir);
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
// Command splitting: every line; ; && || | ( ) { } and backticks; after
// then/do/else; with leading whitespace stripped; and prefixes like
// sudo, env VAR=, time, command, nohup, xargs and absolute or
// \escaped binary paths peeled off. This is deliberately NOT a full
// POSIX shell parser -- see docs/HITL-HOOKS.md for what that limits.
// ---------------------------------------------------------------------
// True when `current` (the text accumulated so far for the segment being
// built) contains a "${" with no matching "}" after it yet -- i.e. we're
// in the middle of a "${VAR}" variable expansion, not a command group.
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
    // Backtick toggles an inline subshell region -- treat every
    // occurrence as a boundary so the content between two backticks is
    // scanned as its own sub-command(s) too, same as $( ... ).
    if (ch === "`") {
      push();
      i++;
      continue;
    }
    // "${VAR}" is variable expansion, not a command group -- don't split
    // on this "{"/"}" pair at all, so resolveVar() later sees the whole
    // "${VAR}" token intact.
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
    if (ch === "\n" || ch === ";" || ch === "(" || ch === ")" || ch === "{" || ch === "}") {
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
    // ">|" (the noclobber-override redirect) is NOT a pipe -- don't split
    // on this "|" at all, just let it fall through to the default
    // append below so tokenize() sees the whole ">|" operator intact.
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

// Word-tokenize one sub-command segment: whitespace splits words, quotes
// are stripped (their CONTENTS are kept, so adjacent quote fragments
// with no whitespace between them merge into one token -- this is what
// resolves "quote-split" reconstruction, e.g. docs/HITL-'RULE'.md), and
// <, <<, >, >>, >| are recognized as their own operator tokens even with
// no surrounding whitespace.
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
      if (ch === "<" && segment[i + 1] === "<") {
        tokens.push("<<");
        i += 2;
        continue;
      }
      tokens.push(ch);
      i++;
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
// (or `<<`) target is ALWAYS a read of that path, regardless of the
// command's own verb -- `tee /tmp/out < docs/HITL-RULE.md` only reads
// the protected file (#1187 escalation-rule round 6, fresh final
// reviewer, non-blocking N3), so redirect-input targets are excluded
// from the "does this sub-command reference a protected path" scan
// entirely. A `>`/`>>`/`>|` target is ALWAYS a write, unconditionally,
// regardless of verb.
function splitRedirects(tokens) {
  const commandTokens = [];
  const redirectOutputs = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "<" || t === "<<") {
      i++; // skip the redirect-input target entirely -- always a read
      continue;
    }
    if (t === ">" || t === ">>" || t === ">|") {
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

// Peels: leading no-op shell keywords (then/do/else/...), leading
// VAR=value assignments (recorded into knownVars), sudo/time/nohup/
// command/exec, env (with its own VAR= assignments and flags), and
// xargs (with its own flags) -- then a leading absolute path or a
// backslash-escaped invocation off the verb itself (/bin/rm -> rm,
// \rm -> rm).
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
  let verb = t[0];
  if (verb.startsWith("\\")) verb = verb.slice(1);
  if (verb.includes("/")) verb = verb.slice(verb.lastIndexOf("/") + 1);
  return { verb: verb.toLowerCase(), args: t.slice(1) };
}

function resolveVar(token, knownVars) {
  let hasUnknownVar = false;
  const value = token.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced || bare;
    if (knownVars.has(name)) return knownVars.get(name);
    hasUnknownVar = true;
    return match;
  });
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
// COULD match one? Basename-only matching (not full-path) deliberately,
// same tradeoff round 3/4 made: a bare filename after `cd` into its
// directory still matches, at the cost of also matching an unrelated
// file that happens to share a basename elsewhere in the tree.
function referencesProtectedPath(value) {
  if (!value) return false;
  const base = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
  if (PROTECTED_BASENAME_PATTERNS.some((re) => re.test(base))) return true;
  if (/[*?[{]/.test(base)) {
    const re = globToRegExp(base);
    return CONCRETE_PROTECTED_BASENAMES.some((name) => re.test(name));
  }
  return false;
}

function evaluateSubCommand(segment, state) {
  const rawTokens = tokenize(segment);
  const { commandTokens, redirectOutputs } = splitRedirects(rawTokens);

  // A `>`/`>>`/`>|` target is ALWAYS a write -- unconditional, whatever
  // the command's own verb is.
  for (const target of redirectOutputs) {
    const { value, hasUnknownVar } = resolveVar(target, state.knownVars);
    if (hasUnknownVar || referencesProtectedPath(value)) {
      return { blocked: true, reason: `redirect to a protected (or unresolvable) path: ${target}` };
    }
  }

  const peeled = peelPrefixes(commandTokens, state.knownVars);
  if (!peeled) return { blocked: false };
  const { verb, args } = peeled;

  if (verb === "cd") {
    updateImpliedDir(state, args[0]);
    return { blocked: false };
  }

  const ancestorHit = checkAncestorDirectoryAttack(verb, args, state);
  if (ancestorHit) return { blocked: true, reason: ancestorHit };

  let referencesProtected = false;
  let lastArgReferencesProtected = false;
  args.forEach((arg, idx) => {
    const { value, hasUnknownVar } = resolveVar(arg, state.knownVars);
    const hit = hasUnknownVar || referencesProtectedPath(value);
    if (hit) {
      referencesProtected = true;
      if (idx === args.length - 1) lastArgReferencesProtected = true;
    }
  });

  if (!referencesProtected) return { blocked: false };
  if (isReadOnlyInvocation(verb, args, lastArgReferencesProtected)) return { blocked: false };
  return { blocked: true, reason: `verb "${verb}" references a protected path and is not on the read-only allowlist` };
}

function updateImpliedDir(state, arg) {
  if (!arg) return;
  if (arg === "-") return; // cd - : unknowable from text alone; leave impliedDir unchanged
  if (arg.startsWith("/")) {
    state.impliedDir = arg.replace(/^\/+/, "");
    return;
  }
  if (arg === "~" || arg.startsWith("~/")) {
    state.impliedDir = "~"; // reset to an opaque value; matches no ANCESTOR_DIRS entry, a safe default
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
  isReadOnlyInvocation,
  globToRegExp,
};

// Only run the stdin-driven hook protocol when executed directly (not
// when imported by the test file).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      process.exit(0); // fail open on unparseable input -- this hook only ever narrows, never widens
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
