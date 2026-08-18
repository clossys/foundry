#!/usr/bin/env node
// check-foreign-references — catch this repository naming an account or a
// repository that is not its own.
//
//   node scripts/check-foreign-references.mjs [<dir>] [--json]
//
// Exit 0 = every account-shaped and scope-shaped reference in this tree
// resolves to this repository's own identity or to an admitted non-peer.
// Exit 1 = at least one does not (a real finding). Exit 2 = this gate could
// not establish what "own" means, or could not read an input it needs, and is
// refusing to guess.
//
// WHY THIS GATE EXISTS
// --------------------
// Foundry is a NEUTRAL supplier. Its packages are installed by planes that do
// not govern each other, and the rule that makes that safe is that this
// repository never acknowledges a consumer: not in a README, not in a
// CHANGELOG, not in a doc comment, not in a workflow. Naming one discloses the
// relationship graph — who supplies whom — which is the one thing a shared
// supplier must not publish, and a public remote caches and indexes it whether
// or not it is later deleted.
//
// Until this gate, that rule had no mechanical enforcement at all.
// scripts/check-public-safety.mjs is a DENYLIST: it refuses strings someone
// already thought to list. A real leak sat in scripts/check-contamination-
// classes.mjs — a doc comment using a consumer's real account as the "example
// scope" — and the FULL-mode publish-safety scan passed straight over it,
// because that account name is not one of the denylist's terms. A human
// reviewer caught it. That is exactly the coverage gap
// scripts/check-contamination-classes.mjs's own header describes for a
// different family of leaks: a denylist can only refuse what it already knows.
//
// So this gate does not ask "is this string on a list of forbidden names". It
// asks the inverse, which needs no such list: "is this reference to OUR OWN
// account, or to something explicitly admitted as not-a-peer". Anything else
// fails. A name nobody has ever heard of fails on its first commit.
//
// WHY THIS FILE NAMES NO FORBIDDEN ACCOUNT
// -----------------------------------------
// The obvious implementation — a denylist of consumer account names — would
// BE the leak it exists to prevent, permanently, in tracked public content. So
// the rule here is inverted and SELF-SCOPED: own identity is derived from this
// repository's own declarations (see "IDENTITY" below), and everything else is
// judged by SHAPE. This file therefore contains no peer name, and adding one
// would never be necessary to extend it. Same discipline as
// scripts/test-gates.mjs, which builds its fixtures under a synthetic scope
// rather than hardcoding real denylist terms into a public file.
//
// IDENTITY — derived, never hardcoded
// ------------------------------------
// Two independent declarations already in this tree, which must AGREE:
//   - package-scope.json's `scope` — the repository's single source of truth
//     for the npm scope it publishes under (see scripts/set-scope.mjs).
//   - the `repository.url` field of the published package manifests, which
//     names the forge account AND the repository itself.
// The scope without its `@` must equal the forge account, and every manifest
// that declares a repository must name the same one. If either declaration is
// missing, unparsable, or the two disagree, this gate does not know what "own"
// means and exits 2 rather than scanning against a guess.
//
// WHAT COUNTS AS A REFERENCE
// ---------------------------
// Two shapes, both of which unambiguously name an account:
//
//   1. npm scope — `@<scope>/<name>`, AND the bare `@<scope>` on its own. A
//      scope IS an npm organisation account; a bare `@name` in prose is either
//      that same account, a forge handle, or a piece of language syntax.
//
//      The bare form is not an optional extra: it is the shape the leak that
//      motivated this gate actually had. `` e.g. `@<consumer>` `` in a doc
//      comment has no slash after it, so a rule that only understood
//      `@scope/name` would have sailed straight past the very thing it was
//      written to catch, and would have looked like a working gate while doing
//      it. Both forms are matched only where the `@` is not preceded by a word
//      character, so an email local part (`someone@example.test`) is not a
//      scope; the slashed form additionally requires a whole, valid, lowercase
//      npm package name after the slash, which is what tells `@types/node`
//      apart from a prose list of TypeScript directives
//      (`@ts-expect-error/@ts-ignore/expectTypeOf` — no npm package name can
//      run into a capital letter).
//
//      Matching the bare form means meeting the `@` of LANGUAGE SYNTAX: CSS
//      at-rules, JSDoc/TSDoc tags, `@ts-expect-error`, a `@vitest-environment`
//      pragma. Those are handled by NON_ACCOUNT_AT_TOKENS below — a vocabulary
//      list, not an identity list. See its own comment for why enumerating it
//      discloses nothing.
//
//   2. forge slug — `<owner>/<repo>` IN A GITHUB CONTEXT ONLY: a github.com,
//      raw.githubusercontent.com or api.github.com URL, a workflow `uses:`
//      value, or a `gh --repo`/`-R` argument.
//
//      A BARE `a/b` anywhere in prose is deliberately NOT matched, and that is
//      a reasoned limit rather than an oversight. Bare two-segment slugs are
//      overwhelmingly relative paths (`packages/ui`, `src/tokens`), package
//      subpaths (`@scope/pkg/dist`), or ordinary English (`and/or`). A rule
//      that flagged them would fire on nearly every line in this repository
//      and would be suppressed everywhere within a week, which is the failure
//      mode that makes a gate worse than no gate. The GitHub-context forms
//      above are the ones where `a/b` can only mean "an account and its
//      repository" — and they are also the forms that are actually actionable
//      (a URL someone can follow, an action someone will resolve).
//
// WHAT IS ADMITTED, AND WHY IT IS NOT A BOUNDARY LEAK
// ---------------------------------------------------
// Three classes, in descending order of how much of the work they do:
//
//   A. THIRD-PARTY npm SCOPES, DERIVED. Every scope that package-lock.json
//      resolves from the public npm registry is a package this repository
//      installs from a public index — infrastructure, not a peer. This is
//      read at run time, so it needs no maintenance and grows and shrinks with
//      the dependency set. It also cannot be used to smuggle a peer in: a peer
//      package under this ecosystem publishes to the private registry named in
//      package-scope.json, not to the public one, so adding it as a dependency
//      would not admit its scope — the manifest entry naming it would still
//      fail here.
//
//   B. THIRD-PARTY VENDORS NAMED IN PROSE. A handful of ecosystem tools this
//      repository discusses but does not depend on. Declared below with a
//      reason each, because nothing in the tree derives them.
//
//   C. INFRASTRUCTURE FORGE OWNERS and PLACEHOLDER NAMES. The forge's own
//      first-party org, the security scanner CI downloads, and the fictional
//      scopes and owners this repository's tests and documentation use as
//      stand-ins. Declared below with a reason each.
//
// None of B or C is a peer account: each is either a public ecosystem vendor
// or a name that belongs to nobody. Enumerating them therefore discloses
// nothing, which is precisely the difference between this list and the
// forbidden-name list this gate exists to avoid needing. The list is also
// meant to stay SHORT — a new entry is a deliberate, reviewable decision that
// some new foreign-looking name is not a peer, and that friction is the
// feature. Prefer renaming a new fixture to an already-admitted placeholder
// over adding a line here.
//
// FAIL-CLOSED
// -----------
// "Could not determine the answer" is a FAILURE (exit 2), never a silent pass:
// a missing or unparsable package-scope.json, a missing or unusable scope
// field, no manifest declaring a repository, manifests that disagree about it,
// a scope and a forge account that contradict each other, an unreadable scan
// root, a package-lock.json that does not parse, or a scan that turns up zero
// files. None of these shares an exit code with a real pass (0) or a real
// finding (1).
//
// An ABSENT package-lock.json is the one input whose absence is not a failure:
// it admits no third-party scope at all, which is the strict direction. A
// lockfile that exists and does not parse IS a failure, because there the gate
// would be silently dropping admissions it was supposed to read.

import { existsSync, readFileSync, readdirSync, statSync, writeSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const root = resolve(positional[0] ?? resolve(scriptDir, ".."));

function die(message) {
  console.error(`check-foreign-references: ${message}`);
  process.exit(2);
}

// ------------------------------------------------------------------ admissions

// `@` IS ALSO SYNTAX. Before any of the admission classes below, a bare
// `@<word>` is checked against this vocabulary of at-tokens that are part of a
// LANGUAGE rather than the name of anybody: CSS at-rules, JSDoc/TSDoc tags,
// TypeScript's compiler directives, and test-runner pragmas.
//
// This list is not an allowlist of accounts and cannot become one — every
// entry is a reserved word in a published grammar, so no name here can ever
// belong to a person or an organisation. It is deliberately fuller than what
// this tree happens to use today: an unlisted tag would be a false positive
// on somebody's next doc comment, and a gate that cries wolf on ordinary
// JSDoc is a gate that gets switched off. Extending it costs nothing and
// weakens nothing.
const NON_ACCOUNT_AT_TOKENS = new Set([
  // CSS at-rules, including Tailwind's own additions.
  "charset", "import", "namespace", "media", "supports", "document", "page", "font-face",
  "font-feature-values", "font-palette-values", "keyframes", "counter-style", "property",
  "layer", "scope", "container", "starting-style", "position-try", "view-transition",
  "apply", "tailwind", "theme", "source", "utility", "variant", "custom-variant", "config",
  "plugin", "reference", "screen", "responsive", "chart",
  // JSDoc / TSDoc block tags.
  "param", "arg", "argument", "returns", "return", "type", "typedef", "template", "callback",
  "prop", "default", "defaultvalue", "example", "deprecated", "see", "link", "linkcode",
  "linkplain", "label", "module", "memberof", "public", "private", "protected", "internal",
  "readonly", "override", "throws", "exception", "async", "augments", "extends", "implements",
  "interface", "constructor", "class", "function", "method", "since", "version", "author",
  "license", "file", "fileoverview", "description", "summary", "remarks", "todo", "ignore",
  "inheritdoc", "satisfies", "experimental", "alpha", "beta", "sealed", "virtual", "group",
  "category", "context", "yields", "exports", "requires", "enum", "event", "fires", "listens",
  "global", "static", "instance", "inner", "abstract", "mixin", "borrows", "hideconstructor",
  "kind", "name", "alias", "external", "host", "tutorial", "variation", "lends", "this",
  "access", "packagedocumentation", "privateremarks", "eventproperty", "decorator",
  // TypeScript compiler directives and test-runner pragmas.
  "ts-expect-error", "ts-ignore", "ts-nocheck", "ts-check", "vitest-environment",
  "vitest-environment-options", "jest-environment", "jsximportsource",
  // The forge's own no-reply mail domain. It reaches this check because a
  // squash-merge attribution address puts a `<login>` placeholder immediately
  // before the `users.noreply.github.com` domain,
  // and the `>` closing the placeholder is not a local-part character. A mail
  // domain the forge operates for every account on it is infrastructure, not
  // an account this repository has a relationship with.
  "users.noreply.github.com",
]);

// CLASS B — public ecosystem vendors this repository TALKS ABOUT without
// depending on, so nothing in package-lock.json admits them. Each is a widely
// published open-source toolchain scope; none is a peer of this repository.
const VENDOR_SCOPES = new Map([
  ["tailwindcss", "CSS framework whose built-in token names this repository's own tokens must not collide with"],
  ["typescript-eslint", "the TypeScript ESLint toolchain, named in prose about lint configuration"],
]);

// CLASS C — forge owners that are infrastructure rather than accounts this
// repository has a relationship with. `uses:` and download URLs in
// .github/workflows/ resolve against the public Actions marketplace and the
// public release CDN; both entries below are the publishers of tooling every
// public repository on this forge can use.
const INFRASTRUCTURE_FORGE_OWNERS = new Map([
  ["actions", "the forge's own first-party Actions organisation (checkout, setup-node, github-script)"],
  ["gitleaks", "publisher of the secret scanner ci.yml downloads and sha256-pins"],
]);

// CLASS C — placeholder names. Fictional stand-ins used by this repository's
// tests, fixtures and documentation. Each belongs to nobody: it names no real
// npm organisation and no real forge account, which is the whole reason it was
// chosen over a real one.
//
// The same list serves both shapes — a placeholder is equally fictional as an
// npm scope and as a forge owner — so a fixture never needs two entries.
const PLACEHOLDER_NAMES = new Map([
  ["gate-fixture", "scripts/test-gates.mjs's fixture scope (see its FIXTURE_SCOPE constant)"],
  ["gate-fixture-owner", "scripts/test-gates.mjs's fixture forge owner"],
  ["catalog-fixture", "packages/controller catalog test fixtures"],
  ["gates-fixture", "packages/controller gate test fixtures"],
  ["gates-cli-fixture", "packages/controller gate CLI test fixtures"],
  ["widgetco-fixture", "scripts/test-gates.mjs's stand-in for an unrelated vendor"],
  ["fixture", "generic fixture scope in gate tests"],
  ["fixture-first-party", "gate test stand-in for a first-party package"],
  ["fixture-scope", "gate test stand-in for a package's declared scope"],
  ["fixture-scope-evil", "gate test stand-in for a scope a dependency must not use"],
  ["fixture-old-scope", "set-scope test stand-in for the scope being migrated from"],
  ["fixture-new-scope", "set-scope test stand-in for the scope being migrated to"],
  ["example", "RFC 2606-style reserved example name, used in documentation"],
  ["example-scope", "documentation stand-in for whatever scope a reader's own tree publishes under"],
  ["your-scope", "documentation stand-in addressed at the reader's own scope"],
  ["newscope", "set-scope.mjs usage text stand-in for the scope being migrated to"],
  ["oldscope", "set-scope.mjs usage text stand-in for the scope being migrated from"],
  ["anything", "set-scope.mjs usage text stand-in for an arbitrary scope"],
  ["scope", "gate test stand-in named after the concept itself"],
  ["other-scope", "gate test stand-in for a scope that is not the package's own"],
  ["some-other-vendor", "gate test stand-in for an unrelated third-party publisher"],
  ["real", "gate test stand-in contrasted against a fixture in the same case"],
  ["wrong", "gate test stand-in for a deliberately incorrect value"],
  ["x", "single-letter stand-in in packages/controller catalog tests"],
  ["old", "packages/governance catalog test stand-in for a pre-rename scope"],
  ["other", "packages/governance preflight test stand-in for a mismatched scope"],
  ["yourscope", "docs/DECISIONS.md stand-in addressed at the reader's own scope"],
  ["acme", "the standard fictional-company placeholder, used in packages/surface metadata fixtures"],
  ["containment-fixture-scope", "scripts/test-gates.mjs denylist-containment fixture scope"],
]);

// --------------------------------------------------------------------- identity

// package-scope.json is this repository's single source of truth for the npm
// scope. Searched upward from the scan root the same way
// scripts/check-public-safety.mjs searches for it, so this gate works when
// pointed at a subdirectory.
let scopeConfigPath = null;
for (let dir = root; ; dir = dirname(dir)) {
  const candidate = join(dir, "package-scope.json");
  if (existsSync(candidate)) {
    scopeConfigPath = candidate;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
}
if (!scopeConfigPath) die(`no package-scope.json found at or above ${root} — cannot establish this repository's own scope`);

let scopeConfig;
try {
  scopeConfig = JSON.parse(readFileSync(scopeConfigPath, "utf8"));
} catch (error) {
  die(`${scopeConfigPath} does not parse: ${error.message}`);
}

const ownScope = scopeConfig?.scope;
if (typeof ownScope !== "string" || !/^@[a-z0-9][a-z0-9._-]*$/.test(ownScope)) {
  die(`${scopeConfigPath} has no usable "scope" (got ${JSON.stringify(ownScope)}) — cannot establish this repository's own scope`);
}
const ownScopeName = ownScope.slice(1);

// The forge identity comes from the OTHER declaration: the published manifests'
// own repository.url. Deliberately a second, independent source — if the two
// disagree, "own" is ambiguous and this gate refuses to pick one.
const REPOSITORY_URL_RE = /github\.com[/:]([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$/;

function manifestRepositoryTargets(dir) {
  const found = [];
  const packagesDir = join(dir, "packages");
  const candidates = [join(dir, "package.json")];
  if (existsSync(packagesDir)) {
    let entries = [];
    try {
      entries = readdirSync(packagesDir);
    } catch {
      entries = [];
    }
    for (const entry of entries.sort()) candidates.push(join(packagesDir, entry, "package.json"));
  }
  for (const manifestPath of candidates) {
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      die(`${relative(root, manifestPath) || manifestPath} does not parse: ${error.message}`);
    }
    const url = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    if (typeof url !== "string") continue;
    const match = url.match(REPOSITORY_URL_RE);
    if (!match) {
      die(
        `${relative(root, manifestPath) || manifestPath} declares repository.url "${url}", which this gate cannot read as ` +
          `an <account>/<repository> pair — refusing to scan against an identity it could not parse`,
      );
    }
    found.push({ manifestPath, account: match[1], repo: match[2] });
  }
  return found;
}

const declaredRepositories = manifestRepositoryTargets(root);
if (declaredRepositories.length === 0) {
  die(
    `no package.json under ${root} declares a repository.url — this gate derives the forge account and repository ` +
      `from that field and will not fall back to a hardcoded identity`,
  );
}
const distinctTargets = new Set(declaredRepositories.map((r) => `${r.account}/${r.repo}`));
if (distinctTargets.size > 1) {
  die(
    `package manifests disagree about which repository this is (${[...distinctTargets].join(", ")}) — ` +
      `"own" is ambiguous, so nothing here can be judged foreign`,
  );
}
const { account: ownAccount, repo: ownRepo } = declaredRepositories[0];

if (ownAccount.toLowerCase() !== ownScopeName.toLowerCase()) {
  die(
    `${basename(scopeConfigPath)} declares scope "${ownScope}" but the package manifests declare repository ` +
      `"${ownAccount}/${ownRepo}" — the npm scope and the forge account contradict each other, so this gate ` +
      `cannot tell which one is this repository's own identity`,
  );
}

// ------------------------------------------------- derived third-party scopes

// Read from package-lock.json: every scope npm resolved from the PUBLIC npm
// registry. See "WHAT IS ADMITTED" class A above for why this is derived
// rather than listed, and why it cannot be used to admit a peer.
const PUBLIC_REGISTRY_PREFIX = "https://registry.npmjs.org/";
const lockPath = join(root, "package-lock.json");
const derivedThirdPartyScopes = new Map();
if (existsSync(lockPath)) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    die(`package-lock.json exists but does not parse (${error.message}) — refusing to scan while the set of admitted third-party scopes is unknown`);
  }
  for (const [installPath, entry] of Object.entries(lock.packages ?? {})) {
    if (typeof entry?.resolved !== "string" || !entry.resolved.startsWith(PUBLIC_REGISTRY_PREFIX)) continue;
    // "node_modules/@scope/name" — take the LAST node_modules segment, which is
    // the package itself rather than whatever nested it.
    const tail = installPath.slice(installPath.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!tail.startsWith("@")) continue;
    const scopeName = tail.slice(1, tail.indexOf("/"));
    if (scopeName) derivedThirdPartyScopes.set(scopeName, "resolved from the public npm registry by package-lock.json");
  }
}

function admittedScope(name) {
  const lower = name.toLowerCase();
  if (lower === ownScopeName.toLowerCase()) return "this repository's own scope";
  if (derivedThirdPartyScopes.has(name)) return derivedThirdPartyScopes.get(name);
  if (VENDOR_SCOPES.has(lower)) return VENDOR_SCOPES.get(lower);
  if (PLACEHOLDER_NAMES.has(lower)) return PLACEHOLDER_NAMES.get(lower);
  return null;
}

function admittedForgeSlug(owner, repo) {
  const lowerOwner = owner.toLowerCase();
  if (lowerOwner === ownAccount.toLowerCase()) {
    return repo.toLowerCase() === ownRepo.toLowerCase() ? "this repository" : null;
  }
  if (INFRASTRUCTURE_FORGE_OWNERS.has(lowerOwner)) return INFRASTRUCTURE_FORGE_OWNERS.get(lowerOwner);
  if (PLACEHOLDER_NAMES.has(lowerOwner)) return PLACEHOLDER_NAMES.get(lowerOwner);
  return null;
}

// --------------------------------------------------------------------- walking

// Same gitignore-aware walk scripts/check-public-safety.mjs uses, and for the
// same reason: a file git ignores cannot reach the remote, so scanning a
// locally-built dist/ would report leaks that can never be published.
function ignoredPaths(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(out.split("\n").filter(Boolean).map((p) => p.replace(/\/$/, "")));
  } catch {
    return new Set(); // not a git work tree — scan everything
  }
}

if (!existsSync(root)) die(`no such directory: ${root}`);
const ignored = ignoredPaths(root);

// package-lock.json is EXCLUDED from the scan, not overlooked. It is generated
// by npm from the public registry rather than authored here, and every name in
// it — dependency scopes, `funding` URLs pointing at maintainers' own forge
// accounts — is a mechanical consequence of the dependency set that
// packages/*/package.json already declares and this gate already scans. A leak
// cannot enter the tree through it without first entering a manifest.
const UNSCANNED = new Set(["package-lock.json"]);
const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".zip", ".gz", ".tgz"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    die(`cannot read ${dir}: ${error.message}`);
  }
  for (const entry of entries.sort()) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (ignored.has(relative(root, full).split(sep).join("/"))) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

const files = walk(root).filter((f) => {
  const rel = relative(root, f).split(sep).join("/");
  return !UNSCANNED.has(rel) && !SKIP_EXTENSIONS.has(extname(f).toLowerCase());
});

if (files.length === 0) {
  die(`scanned zero files under ${root} — treating an empty scan as a pass would make this gate silently decorative`);
}

// -------------------------------------------------------------------- matching

// `@<scope>/<name>` where:
//   - the `@` is not preceded by a word character, so an email local part
//     (`someone@example.test/path`) is not read as a scope; and
//   - what follows the slash is a WHOLE valid npm package name — lowercase,
//     and not immediately followed by another letter. npm names cannot contain
//     an uppercase character, so that trailing condition is what tells
//     `@types/node` (a real scoped package) apart from prose listing TypeScript
//     directives, `@ts-expect-error/@ts-ignore/expectTypeOf`, where the
//     "package name" would have to run into a capital letter to be one.
const SCOPE_RE = /(?<![A-Za-z0-9._%+-])@([a-z0-9][a-z0-9._-]*)\/[a-z0-9][a-z0-9._-]*(?![A-Za-z])/g;

// The bare `@<name>` — an account named without a package after it, which is
// how the leak this gate exists to prevent was actually written. Same
// left-hand guard as above; the right-hand guard just requires the name to
// end, so this never fires on the slashed form the previous pattern owns.
const BARE_SCOPE_RE = /(?<![A-Za-z0-9._%+-])@([a-z0-9][a-z0-9._-]*)(?![A-Za-z0-9._/-])/g;

// The account-and-repository half of a GitHub URL — web, ssh, raw content and
// API. A trailing `.git` is part of the clone URL, not part of the repository
// name, and is stripped before comparison (see `normalizeRepo`).
const FORGE_URL_RE =
  /(?:github\.com[/:]|raw\.githubusercontent\.com\/|api\.github\.com\/repos\/)([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

// A workflow step's `uses:` value — `owner/repo`, `owner/repo/path`, either
// with or without an `@<ref>` suffix.
const USES_RE = /(?:^|\s)uses:\s*["']?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

// The `gh` CLI's repository argument: `--repo <owner>/<repo>` or `-R` with the
// same value.
const GH_CLI_RE = /(?:--repo|(?<=\s)-R)[=\s]+["']?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

const normalizeRepo = (name) => name.replace(/\.git$/, "");

const findings = [];
let referenceCount = 0;

for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // NOT `if (contents contains a NUL) continue`, which is the ordinary way to
  // skip a binary file and is a trap for a gate like this one.
  //
  // A single stray NUL byte anywhere in a text file would make that WHOLE file
  // invisible to this scan. That is not hypothetical here: a source file in
  // this very repository embeds one literal NUL (as the needle of its own
  // binary check), and an early draft of this gate skipped that file entirely
  // — the same file the leak that motivated this gate was found in. A planted
  // foreign scope in it went undetected, and the gate reported a confident
  // PASS. A boundary gate must not have a byte that switches it off.
  //
  // So nothing is ever skipped for its contents. Genuinely binary formats are
  // excluded by extension (SKIP_EXTENSIONS above); everything else is scanned
  // with the NUL and zero-width characters stripped out first. Stripping is
  // also the same hardening scripts/check-public-safety.mjs applies for its
  // own reason: a name with a zero-width space inserted mid-string reads
  // identically to a human and defeats a naive match.
  contents = contents.replace(/[\u0000\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g, "");

  contents.split("\n").forEach((line, index) => {
    const record = (kind, reference, name) => {
      referenceCount++;
      if (name !== null) return;
      findings.push({ file: rel, line: index + 1, kind, reference, text: line.trim().slice(0, 200) });
    };

    for (const match of line.matchAll(SCOPE_RE)) {
      record("npm-scope", `@${match[1]}`, admittedScope(match[1]));
    }
    for (const match of line.matchAll(BARE_SCOPE_RE)) {
      if (NON_ACCOUNT_AT_TOKENS.has(match[1].toLowerCase())) continue;
      record("bare-scope", `@${match[1]}`, admittedScope(match[1]));
    }
    for (const re of [FORGE_URL_RE, USES_RE, GH_CLI_RE]) {
      for (const match of line.matchAll(re)) {
        const repo = normalizeRepo(match[2]);
        record("forge-slug", `${match[1]}/${repo}`, admittedForgeSlug(match[1], repo));
      }
    }
  });
}

// ------------------------------------------------------------------- reporting

if (flags.has("--json")) {
  // writeSync, not console.log — see the same note in
  // scripts/check-public-safety.mjs's reporting section. When stdout is a PIPE
  // Node writes it asynchronously, and the process.exit() below discards
  // everything past roughly the first 64 KB, handing the reader a truncated
  // document that is no longer valid JSON. A --json report over this tree is
  // already well past that when there are many findings. (Reproduced here the
  // honest way: the first draft used console.log and the first piped run of a
  // deliberately-noisy scan died on `Unterminated string in JSON`.)
  writeSync(
    1,
    JSON.stringify(
      {
        root,
        ownScope,
        ownRepository: `${ownAccount}/${ownRepo}`,
        scannedFiles: files.length,
        referencesSeen: referenceCount,
        derivedThirdPartyScopes: [...derivedThirdPartyScopes.keys()].sort(),
        findings,
        ok: findings.length === 0,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(findings.length === 0 ? 0 : 1);
}

console.log(`check-foreign-references: scanned ${files.length} file(s) under ${root}`);
console.log(
  `identity: scope ${ownScope}, repository ${ownAccount}/${ownRepo} ` +
    `(${referenceCount} account-shaped reference(s) seen, ${derivedThirdPartyScopes.size} third-party scope(s) derived from the lockfile)`,
);

if (findings.length === 0) {
  console.log(`\nPASS — this repository names no account or repository other than its own.`);
  process.exit(0);
}

console.log(`\n  FOREIGN reference(s) — each names an account or repository that is not this one:\n`);
const grouped = findings.reduce((acc, f) => ((acc[`${f.kind} ${f.reference}`] ??= []).push(f), acc), {});
for (const [label, rows] of Object.entries(grouped).sort()) {
  console.log(`    ${label} — ${rows.length} hit(s)`);
  for (const row of rows.slice(0, 6)) {
    console.log(`      ${row.file}:${row.line}`);
    console.log(`        ${row.text}`);
  }
  if (rows.length > 6) console.log(`      ...and ${rows.length - 6} more`);
}

console.log(
  `\n  Fix: remove the reference. Foundry is a neutral supplier and must not name a consumer,\n` +
    `  a sibling repository, or any account other than its own — use a placeholder instead.\n` +
    `  If this really is public infrastructure or a fictional stand-in rather than a peer account,\n` +
    `  add it to VENDOR_SCOPES, INFRASTRUCTURE_FORGE_OWNERS or PLACEHOLDER_NAMES in this script\n` +
    `  with the reason it is not a peer.`,
);
console.log(`\ncheck-foreign-references: FAIL — ${findings.length} foreign reference(s).`);
process.exit(1);
