import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 5_000;
const CREDENTIAL_ENV = /(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i;

const omissionRow = (specifiers, rejected = []) => Object.fromEntries(
  specifiers.map((specifier) => [specifier, rejected.includes(specifier) ? "rejects" : "imports"]),
);
const conditionOutcomes = (defaultOutcome, reactServerOutcome) => ({
  default: defaultOutcome,
  "react-server": reactServerOutcome,
});
const publisherOmissionRow = ({ rejected = [], web = "imports", client = "imports" } = {}) => ({
  ...omissionRow(publisherExports, rejected),
  "@clossys/publisher/web": typeof web === "string" ? web : conditionOutcomes(web.default, web.reactServer),
  "@clossys/publisher/web/client": client,
});

const bouncerExports = [
  "@clossys/bouncer",
  "@clossys/bouncer/agent",
  "@clossys/bouncer/gate",
  "@clossys/bouncer/providers/clerk",
  "@clossys/bouncer/providers/clerk/web",
  "@clossys/bouncer/providers/clerk/web/client",
  "@clossys/bouncer/providers/clerk/web/proxy",
  "@clossys/bouncer/providers/clerk/web/server",
];
const bouncerWebExports = bouncerExports.filter((specifier) => specifier.includes("/web"));
const designerExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/atoms/server",
  "@clossys/designer/blocks",
  "@clossys/designer/blocks/server",
  "@clossys/designer/charts",
  "@clossys/designer/charts/server",
  "@clossys/designer/gate",
  "@clossys/designer/icons",
  "@clossys/designer/render-environment",
  "@clossys/designer/shell",
  "@clossys/designer/shell/server",
  "@clossys/designer/theme",
  "@clossys/designer/theme/server",
  "@clossys/designer/tokens",
  "@clossys/designer/tokens/server",
];
const designerClientExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/blocks",
  "@clossys/designer/shell",
  "@clossys/designer/theme",
];
const designerReactExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/atoms/server",
  "@clossys/designer/blocks",
  "@clossys/designer/blocks/server",
  "@clossys/designer/charts",
  "@clossys/designer/charts/server",
  "@clossys/designer/shell",
  "@clossys/designer/shell/server",
  "@clossys/designer/theme",
];
const publisherExports = [
  "@clossys/publisher/assessment",
  "@clossys/publisher/core",
  "@clossys/publisher/document",
  "@clossys/publisher/email",
  "@clossys/publisher/image",
  "@clossys/publisher/materials",
  "@clossys/publisher/media",
  "@clossys/publisher/pack",
  "@clossys/publisher/print",
  "@clossys/publisher/record",
  "@clossys/publisher/slides",
  "@clossys/publisher/surfaces",
  "@clossys/publisher/templates",
  "@clossys/publisher/testing",
  "@clossys/publisher/web",
  "@clossys/publisher/web/client",
];

/**
 * Expected import behavior when exactly one optional peer is absent. This is
 * deliberately explicit: a manifest can say that a peer is optional, but it
 * cannot say which public entry points are expected to remain usable without
 * that peer.
 *
 * ADDING AN EXPORT SUBPATH TO A PACKAGE WITH AN OPTIONAL PEER
 * ----------------------------------------------------------
 * This table is the one record you edit, and it is deliberately mutable: it
 * describes the CURRENT source tree, so it moves whenever the exports do.
 * A new subpath on any package named below fails `check:gates` and
 * `check:packed-consumer` with `omission row <peer> misses <specifier>`, once
 * per optional peer, until every row here covers it.
 *
 * Fill it in from a MEASUREMENT, never from a guess about what should happen --
 * `npm run check:packed-consumer -- --package <name>` physically removes each
 * peer and imports the specifier. #878 exists because a row that looked
 * obviously right (designer's `tailwind-merge`) had stopped being true.
 * If the new export declares a `react-server` condition, its outcome must be
 * the `{ default, "react-server" }` object form: a bare string there is
 * refused as a collapse rather than accepted as a shorthand.
 *
 * A cell may read `refuses` -- a third outcome beside `imports` and
 * `rejects` -- only where `BY_DESIGN_REFUSALS` (below) declares that exact
 * specifier and condition, and such a cell must read `refuses`: the target
 * throws its declared refusal whatever is installed, so the omitted peer
 * plays no part in it. Everywhere else `refuses` is an invalid outcome. A
 * failure that happens only when a peer is omitted is not a by-design
 * refusal: it stays `rejects`, and it must name the omitted peer.
 *
 * `governance/public-npm-aggregate-canary.json` carries rows of the same shape
 * and is NOT the file to edit -- it is frozen measurement of already-published
 * tarballs, and it stopped asking anything of this tree in #533. See
 * `validateAggregateCanary`'s header in `public-npm-aggregate-canary.mjs`.
 */
export const OPTIONAL_PEER_POLICY = {
  "@clossys/bouncer": {
    "@clerk/nextjs": omissionRow(bouncerExports, bouncerWebExports),
    next: omissionRow(bouncerExports, bouncerWebExports),
    react: omissionRow(bouncerExports, bouncerWebExports),
    "react-dom": omissionRow(bouncerExports, bouncerWebExports),
    svix: omissionRow(bouncerExports, ["@clossys/bouncer/providers/clerk"]),
  },
  "@clossys/butler": {
    react: {
      "@clossys/butler": "imports",
      "@clossys/butler/inbound": "imports",
      "@clossys/butler/web": "rejects",
    },
    "react-dom": {
      "@clossys/butler": "imports",
      "@clossys/butler/inbound": "imports",
      "@clossys/butler/web": "imports",
    },
  },
  "@clossys/controller": {
    typescript: {
      "@clossys/controller": "imports",
      "@clossys/controller/artifacts": "imports",
      "@clossys/controller/catalog": "imports",
      "@clossys/controller/cleanup": "imports",
      "@clossys/controller/composition": "imports",
      "@clossys/controller/conventions": "imports",
      "@clossys/controller/gates": "imports",
      "@clossys/controller/gates/secrets": "rejects",
      "@clossys/controller/policy": "imports",
      "@clossys/controller/positions": "imports",
      "@clossys/controller/release": "imports",
      "@clossys/controller/repository": "imports",
      "@clossys/controller/review": "imports",
      "@clossys/controller/review/github": "imports",
    },
  },
  "@clossys/designer": {
    "@internationalized/date": omissionRow(designerExports, designerClientExports),
    react: omissionRow(designerExports, designerReactExports),
    "react-aria-components": omissionRow(designerExports, designerClientExports),
    "react-dom": omissionRow(designerExports, designerClientExports),
    // #749: atoms/internal/cx.ts used to import tailwind-merge STATICALLY,
    // so every one of designerReactExports (the entry points that reach
    // it) rejected the moment tailwind-merge was omitted -- a bare
    // import, before any component ever rendered. cx.ts now resolves it
    // via a dynamic import() inside a try/catch, so importing a subpath
    // no longer throws on that peer's absence; cx() itself degrades to a
    // plain, unmerged class join instead (with a one-time console.warn --
    // see cx.ts and cx.optional-peer.test.ts), which this table cannot
    // observe, since it only probes bare `import()`, never a render. That
    // makes this row's real, measured shape identical to tailwindcss's
    // below: nothing rejects on import. See #878 for the measurement that
    // retired the old row (which this test caught drifting from reality).
    "tailwind-merge": omissionRow(designerExports),
    tailwindcss: omissionRow(designerExports),
  },
  "@clossys/keeper": {
    react: { "@clossys/keeper": "imports", "@clossys/keeper/web": "rejects" },
    "react-dom": { "@clossys/keeper": "imports", "@clossys/keeper/web": "imports" },
  },
  "@clossys/messenger": {
    resend: { "@clossys/messenger": "imports", "@clossys/messenger/providers/resend": "rejects" },
  },
  "@clossys/publisher": {
    "@internationalized/date": publisherOmissionRow({ web: { default: "rejects", reactServer: "imports" }, client: "rejects" }),
    react: publisherOmissionRow({ rejected: ["@clossys/publisher/document", "@clossys/publisher/testing"], web: { default: "rejects", reactServer: "rejects" }, client: "rejects" }),
    "react-aria-components": publisherOmissionRow({ web: { default: "rejects", reactServer: "imports" }, client: "rejects" }),
    "react-dom": publisherOmissionRow({ rejected: ["@clossys/publisher/testing"], web: { default: "rejects", reactServer: "imports" }, client: "rejects" }),
    // #749/#878: publisher/web reaches designer's cx() transitively
    // (publisher has no tailwind-merge import site of its own -- grep
    // confirms it appears only in fixture peer-name lists inside
    // react-server-artifact.test.ts). cx.ts no longer throws merely from
    // being imported when tailwind-merge is absent (see the designer row
    // above), so this row's measured shape follows the same change:
    // nothing rejects on import. Left unmeasured/unverified here would be
    // an assumption, not evidence -- see #878's PR body for the actual
    // `--package publisher` run this literal was set from.
    "tailwind-merge": publisherOmissionRow({ web: { default: "imports", reactServer: "imports" } }),
    tailwindcss: publisherOmissionRow({ web: { default: "imports", reactServer: "imports" } }),
  },
};

/**
 * Export targets that REFUSE BY DESIGN: a condition under which a subpath is
 * deliberately unusable (a client-only module under `react-server`, a
 * development-only module outside `development`, a server-only module under
 * `browser`) and resolves to a module that throws at import. Shape:
 *
 *   { "<package>": { "<specifier>": { "<condition>": "<refusal marker>" } } }
 *
 * A declared target is excluded from "every runtime target imports" and from
 * "an omission failure names the omitted peer". In their place it must FAIL
 * to import, in the all-peers-present consumer and in every omission
 * consumer, by throwing an error whose own message contains the marker and
 * which carries no string `code` (a plain `Error`, as a refusal module
 * throws). Anything else is a finding: importing successfully (the
 * declaration is stale), a different message, an error with a string `code`
 * (a missing peer, a broken path or a missing file -- `ERR_*`,
 * `MODULE_NOT_FOUND`, `ENOENT` and the like -- is breakage, not a refusal,
 * even when its message happens to quote the marker), a timeout, a launch
 * failure, or a process exit that never reached the thrown error. The
 * message is read from a report the probe writes after catching the error,
 * never from free-form output, so accidental breakage that prints or quotes
 * the marker on its way to crashing does not pass. That is the threat model:
 * accidental breakage in a first-party module. It is not proof against a
 * module written to forge the probe's report and exit code. An undeclared
 * target that throws is still a finding, exactly as before.
 *
 * Declaring a specifier also makes the engine measure each of its
 * `development` and `browser` targets as its own condition (with node's
 * `--conditions` flag) instead of folding them into `default`. The
 * conditions a refusing subpath does not refuse under are where it is
 * expected to work, so measuring all of them is the closed default.
 * `react-server` is measured for every export, as before. Measuring a
 * condition means importing with that condition set; node still applies its
 * own `node`, `import` and `default` conditions, so when an export map lists
 * one of those ahead of the labelled key, the file that ran is that earlier
 * one, not the labelled target. `browser` is node's resolver with that
 * condition set, not a browser: it proves which module resolves and that a
 * refusal throws, and it requires a non-refusing browser target to evaluate
 * in node.
 *
 * The declaration is closed against the manifest: a package, specifier or
 * condition the manifest does not export as a raw runtime target is stale.
 * A marker must be at least MIN_REFUSAL_MARKER_LENGTH (16) characters once
 * trimmed, so a bare condition name or a short path fragment cannot pass for
 * a refusal message, and a non-`default` marker must name its condition, so
 * one refusal message cannot stand in for another condition's. Only literal
 * export keys can be declared; wildcard and Next-context subpaths cannot.
 */
export const BY_DESIGN_REFUSALS = {};
export const MIN_REFUSAL_MARKER_LENGTH = 16;

const IMPORT_CONDITIONS = ["default", "react-server", "development", "browser"];
const MEASURED_CONDITIONS = ["react-server"];
const REFUSING_SPECIFIER_CONDITIONS = ["react-server", "development", "browser"];
const REFUSAL_EXIT = 86;
const REFUSAL_REPORT = "foundry-by-design-refusal:";

export function parsePackedConsumerArgs(args) {
  const parsed = { selected: undefined, root: undefined, skipBuild: false, keep: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--package", "--root", "--skip-build", "--keep"].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`duplicate argument ${flag}`);
    seen.add(flag);
    if (flag === "--package" || flag === "--root") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--package") parsed.selected = value;
      else parsed.root = value;
    } else if (flag === "--skip-build") parsed.skipBuild = true;
    else parsed.keep = true;
  }
  return parsed;
}

function json(path) {
  return readFile(path, "utf8").then(JSON.parse);
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

export function credentiallessEnv(base, npmrc, cache, globalConfig = npmrc) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (!CREDENTIAL_ENV.test(key) && !/^npm_config_/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: cache,
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_always_auth: "false",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
}

export async function discoverPublishablePackages(root, selected) {
  const packagesRoot = join(root, "packages");
  const entries = [];
  for (const item of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try {
      const manifest = await json(join(packagesRoot, item.name, "package.json"));
      if (manifest.private !== true) entries.push({ directory: item.name, path: join(packagesRoot, item.name), manifest });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  entries.sort((left, right) => left.directory.localeCompare(right.directory));
  if (!selected) return entries;

  const byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
  const initial = entries.find((entry) => (
    entry.directory === selected || entry.manifest.name === selected || entry.manifest.name === `@clossys/${selected}`
  ));
  if (!initial) throw new Error(`unknown publishable package ${selected}`);

  const wanted = new Set();
  const visit = (entry) => {
    if (wanted.has(entry.manifest.name)) return;
    wanted.add(entry.manifest.name);
    for (const name of Object.keys(entry.manifest.dependencies ?? {})) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency);
    }
  };
  visit(initial);
  return entries.filter((entry) => wanted.has(entry.manifest.name));
}

function leafTargets(value, targets = []) {
  if (typeof value === "string") targets.push(value);
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const nested of Object.values(value)) leafTargets(nested, targets);
  }
  return targets;
}

function exportEntries(manifest) {
  if (typeof manifest.exports === "string" || Array.isArray(manifest.exports)) return [[".", manifest.exports]];
  return Object.entries(manifest.exports ?? {});
}

function exportSpecifier(name, key, substitution) {
  if (key === ".") return name;
  if (!key.startsWith("./")) throw new Error(`${name} export ${key} is not package-relative`);
  const subpath = key.slice(2).replaceAll("*", substitution ?? "");
  return `${name}/${subpath}`;
}

function runtimeTarget(target) {
  return /\.(?:c|m)?js$/i.test(target);
}

// Every condition outside `measured` folds into `default`. Only the outermost
// measured condition labels a target: a nested combination such as
// `react-server` + `development` is measured as its outer condition alone.
function runtimeConditionTargets(value, condition = "default", targets = [], measured = MEASURED_CONDITIONS) {
  if (typeof value === "string") {
    if (runtimeTarget(value)) targets.push({ target: value, condition });
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      runtimeConditionTargets(nested, condition === "default" && measured.includes(key) ? key : condition, targets, measured);
    }
  } else if (Array.isArray(value)) {
    for (const nested of value) runtimeConditionTargets(nested, condition, targets, measured);
  }
  return targets;
}

function measuredConditions(refusals, specifier) {
  return Object.hasOwn(refusals ?? {}, specifier) ? REFUSING_SPECIFIER_CONDITIONS : MEASURED_CONDITIONS;
}

function packedNextContexts(manifest, runtimeSpecifiers) {
  const verification = manifest.foundryReleaseVerification;
  if (verification === undefined) return { client: [], server: [], proxy: [], all: [] };
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    throw new Error(`${manifest.name} foundryReleaseVerification must be an object`);
  }
  const verificationKeys = Object.keys(verification);
  if (verificationKeys.some((key) => key !== "next")) {
    throw new Error(`${manifest.name} foundryReleaseVerification has an unsupported context row`);
  }
  const next = verification.next;
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new Error(`${manifest.name} foundryReleaseVerification.next must be an object`);
  }
  const allowed = ["clientSubpaths", "serverSubpaths", "proxySubpaths"];
  if (Object.keys(next).some((key) => !allowed.includes(key))) {
    throw new Error(`${manifest.name} foundryReleaseVerification.next has an unsupported context row`);
  }
  const contexts = {};
  const seen = new Set();
  for (const [kind, field] of [["client", "clientSubpaths"], ["server", "serverSubpaths"], ["proxy", "proxySubpaths"]]) {
    const subpaths = next[field] ?? [];
    if (!Array.isArray(subpaths) || subpaths.some((subpath) => typeof subpath !== "string" || subpath.length === 0)) {
      throw new Error(`${manifest.name} ${field} must be an array of declared subpaths`);
    }
    contexts[kind] = [];
    for (const subpath of subpaths) {
      const specifier = exportSpecifier(manifest.name, subpath);
      if (seen.has(specifier)) throw new Error(`${manifest.name} Next context duplicates ${subpath}`);
      if (!runtimeSpecifiers.includes(specifier)) throw new Error(`${manifest.name} Next context names undeclared runtime export ${subpath}`);
      seen.add(specifier);
      contexts[kind].push(specifier);
    }
  }
  const all = [...seen].sort();
  if (all.length === 0) throw new Error(`${manifest.name} foundryReleaseVerification.next declares no framework exports`);
  return { ...contexts, all };
}

function patternRegex(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", "(.*)");
  return new RegExp(`^${escaped}$`);
}

async function filesBelow(root) {
  const files = [];
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === "node_modules") continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(root);
  return files;
}

async function checkedTarget(packageRoot, packageReal, target) {
  if (!target.startsWith("./")) throw new Error(`export target ${target} is not package-relative`);
  if (target.slice(2).split("/").includes("node_modules")) throw new Error(`export target ${target} resolves through an installed dependency`);
  const path = resolve(packageRoot, target);
  if (!inside(packageRoot, path)) throw new Error(`export target ${target} escapes the installed package`);
  const targetStat = await stat(path).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`export target ${target} does not resolve`);
    throw error;
  });
  if (!targetStat.isFile()) throw new Error(`export target ${target} is not a file`);
  const targetReal = await realpath(path);
  if (!inside(packageReal, targetReal)) throw new Error(`export target ${target} resolves outside the installed package`);
  return path;
}

export async function inspectPackedExports(packageRoot, manifest, refusals = {}) {
  const packageReal = await realpath(packageRoot);
  const allFiles = await filesBelow(packageRoot);
  const runtimeSpecifiers = new Set();
  const runtimeTargets = new Map();
  const staticTargets = [];

  for (const [key, value] of exportEntries(manifest)) {
    for (const target of leafTargets(value)) {
      const stars = (target.match(/\*/g) ?? []).length;
      const keyStars = (key.match(/\*/g) ?? []).length;
      if (stars === 0) {
        await checkedTarget(packageRoot, packageReal, target);
        staticTargets.push({ key, target });
        if (runtimeTarget(target)) {
          const specifier = exportSpecifier(manifest.name, key);
          runtimeSpecifiers.add(specifier);
          for (const item of runtimeConditionTargets(value, "default", [], measuredConditions(refusals, specifier))) runtimeTargets.set(`${specifier}\u0000${item.condition}`, { specifier, condition: item.condition });
        }
        continue;
      }
      if (stars !== 1 || keyStars !== 1) throw new Error(`export pattern ${key} -> ${target} must contain one wildcard`);
      const regex = patternRegex(target);
      const matches = [];
      for (const file of allFiles) {
        const packageTarget = `./${relative(packageRoot, file).split(sep).join("/")}`;
        const match = packageTarget.match(regex);
        if (!match) continue;
        await checkedTarget(packageRoot, packageReal, packageTarget);
        matches.push({ target: packageTarget, substitution: match[1] });
      }
      if (matches.length === 0) throw new Error(`export target pattern ${target} resolves no files`);
      for (const match of matches) {
        staticTargets.push({ key, target: match.target });
        if (runtimeTarget(match.target)) {
          const specifier = exportSpecifier(manifest.name, key, match.substitution);
          runtimeSpecifiers.add(specifier);
          for (const item of runtimeConditionTargets(value, "default", [], measuredConditions(refusals, specifier))) runtimeTargets.set(`${specifier}\u0000${item.condition}`, { specifier, condition: item.condition });
        }
      }
    }
  }
  const allRuntimeSpecifiers = [...runtimeSpecifiers].sort();
  const allRuntimeTargets = [...runtimeTargets.values()].sort((left, right) => (
    left.specifier.localeCompare(right.specifier) || left.condition.localeCompare(right.condition)
  ));
  const nextContexts = packedNextContexts(manifest, allRuntimeSpecifiers);
  return {
    runtimeSpecifiers: allRuntimeSpecifiers,
    runtimeTargets: allRuntimeTargets,
    rawRuntimeSpecifiers: allRuntimeSpecifiers.filter((specifier) => !nextContexts.all.includes(specifier)),
    rawRuntimeTargets: allRuntimeTargets.filter((item) => !nextContexts.all.includes(item.specifier)),
    nextContexts,
    staticTargets: staticTargets.sort((left, right) => left.target.localeCompare(right.target)),
  };
}

function declaredRuntimeTargets(manifest, refusals = {}) {
  const targets = [];
  for (const [key, value] of exportEntries(manifest)) {
    if (key.includes("*")) continue;
    const specifier = exportSpecifier(manifest.name, key);
    for (const item of runtimeConditionTargets(value, "default", [], measuredConditions(refusals, specifier))) targets.push({ specifier, condition: item.condition });
  }
  return targets.sort((left, right) => left.specifier.localeCompare(right.specifier) || left.condition.localeCompare(right.condition));
}

// `refuses` is valid exactly where a refusal is declared, and required there.
function cellOutcomeFinding(prefix, condition, outcome, refusing) {
  if (refusing.has(condition)) {
    return outcome === "refuses" ? null : `${prefix} must record refuses for its declared ${condition} refusal`;
  }
  if (outcome === "refuses") return `${prefix} records refuses for ${condition}, which declares no refusal by design`;
  return ["imports", "rejects"].includes(outcome) ? null : `${prefix} has invalid ${condition} outcome`;
}

function policyOutcomeShapeFindings(manifest, peer, specifier, value, conditions, refusing = new Set()) {
  const prefix = `${manifest.name} omission row ${peer} ${specifier}`;
  const expected = [...conditions].sort();
  if (typeof value === "string") {
    if (!["imports", "rejects", "refuses"].includes(value)) return [`${prefix} has invalid outcome`];
    // A bare outcome string asserts one result for every condition the export
    // declares, which is only true when `default` is the only one. An export
    // with a `react-server` target resolves to DIFFERENT files per condition,
    // so one string is a claim about two unmeasured things rather than a
    // shorthand for one measured thing. The object branch below is checked for
    // exact condition coverage; this branch used to return before reaching it,
    // which is how a string could silently opt out of that check. The frozen
    // aggregate plan carried its own copy of this rule against the source
    // tree; #533 moved it here, where it runs against the manifest each caller
    // actually measured -- packed source for `check:packed-consumer`, the
    // installed frozen tarball for the aggregate canary's own execution join.
    if (expected.length !== 1 || expected[0] !== "default") {
      return [`${prefix} collapses its ${expected.join("/")} outcomes into one string`];
    }
    const finding = cellOutcomeFinding(prefix, "default", value, refusing);
    return finding ? [finding] : [];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${prefix} has invalid condition outcomes`];
  const actual = Object.keys(value).sort();
  const findings = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) findings.push(`${prefix} has incomplete or stale condition outcomes`);
  for (const condition of expected) {
    const finding = cellOutcomeFinding(prefix, condition, value[condition], refusing);
    if (finding) findings.push(finding);
  }
  return findings;
}

/**
 * Closes `BY_DESIGN_REFUSALS` against the selected manifests: every declared
 * package, specifier and condition must be a literal raw runtime export
 * target, and every marker a string of at least MIN_REFUSAL_MARKER_LENGTH
 * trimmed characters that names its condition unless that condition is
 * `default`.
 */
export function validateByDesignRefusals(packages, refusals, { allowUnselected = false } = {}) {
  const findings = [];
  const selected = new Map(packages.map((entry) => [entry.manifest.name, entry.manifest]));
  for (const packageName of Object.keys(refusals ?? {}).sort()) {
    const manifest = selected.get(packageName);
    if (!manifest) {
      if (!allowUnselected) findings.push(`${packageName} by-design refusals are stale`);
      continue;
    }
    const declared = refusals[packageName];
    if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
      findings.push(`${packageName} by-design refusals must map specifiers to condition markers`);
      continue;
    }
    const targets = declaredRuntimeTargets(manifest, declared);
    for (const specifier of Object.keys(declared).sort()) {
      const prefix = `${packageName} by-design refusal ${specifier}`;
      const conditions = declared[specifier];
      if (!conditions || typeof conditions !== "object" || Array.isArray(conditions) || Object.keys(conditions).length === 0) {
        findings.push(`${prefix} must map at least one condition to a refusal marker`);
        continue;
      }
      for (const condition of Object.keys(conditions).sort()) {
        const marker = conditions[condition];
        if (!IMPORT_CONDITIONS.includes(condition)) findings.push(`${prefix} names unsupported condition ${condition}`);
        else if (!targets.some((item) => item.specifier === specifier && item.condition === condition)) {
          findings.push(`${prefix} ${condition} is stale: the manifest exports no ${condition} runtime target for it`);
        }
        if (typeof marker !== "string" || marker.trim() === "") findings.push(`${prefix} ${condition} needs a non-empty refusal marker`);
        else if (marker.trim().length < MIN_REFUSAL_MARKER_LENGTH) {
          findings.push(`${prefix} ${condition} marker is shorter than ${MIN_REFUSAL_MARKER_LENGTH} characters and cannot identify a refusal message`);
        } else if (condition !== "default" && !marker.includes(condition)) findings.push(`${prefix} ${condition} marker must name the ${condition} condition`);
      }
    }
  }
  return findings;
}

export function validateOptionalPeerPolicy(packages, policy, { allowUnselected = false, refusals = {} } = {}) {
  const findings = [];
  const selected = new Map(packages.map((entry) => [entry.manifest.name, entry.manifest]));
  for (const manifest of selected.values()) {
    const optional = Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional === true)
      .map(([name]) => name)
      .sort();
    const rows = policy[manifest.name] ?? {};
    const packageRefusals = refusals?.[manifest.name] ?? {};
    for (const peer of optional) {
      if (!Object.hasOwn(rows, peer)) findings.push(`${manifest.name} optional peer ${peer} has no omission row`);
    }
    for (const peer of Object.keys(rows).sort()) {
      if (!optional.includes(peer)) findings.push(`${manifest.name} omission row ${peer} is stale`);
      const expectedTargets = declaredRuntimeTargets(manifest, packageRefusals);
      const expectedSpecifiers = [...new Set(expectedTargets.map((item) => item.specifier))].sort();
      const conditionsBySpecifier = new Map(expectedSpecifiers.map((specifier) => [specifier, new Set(expectedTargets.filter((item) => item.specifier === specifier).map((item) => item.condition))]));
      const actualSpecifiers = Object.keys(rows[peer] ?? {}).sort();
      for (const specifier of expectedSpecifiers) {
        if (!actualSpecifiers.includes(specifier)) findings.push(`${manifest.name} omission row ${peer} misses ${specifier}`);
      }
      for (const specifier of actualSpecifiers) {
        if (!expectedSpecifiers.includes(specifier)) findings.push(`${manifest.name} omission row ${peer} has stale export ${specifier}`);
        else findings.push(...policyOutcomeShapeFindings(manifest, peer, specifier, rows[peer][specifier], conditionsBySpecifier.get(specifier), new Set(Object.keys(packageRefusals[specifier] ?? {}))));
      }
    }
  }
  for (const packageName of Object.keys(policy).sort()) {
    if (!selected.has(packageName) && !allowUnselected) findings.push(`${packageName} omission policy is stale`);
  }
  return findings;
}

export function runProcess(file, args, { cwd, env, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const grouped = process.platform !== "win32";
  const maxBytes = 4 * 1024 * 1024;
  return new Promise((resolveResult) => {
    let child;
    let settled = false;
    let timedOut = false;
    let overflow = false;
    let spawnError = null;
    let exitResult = null;
    let closedResult = null;
    let terminationStarted = false;
    let terminationComplete = false;
    let forcedTermination = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timeoutTimer;
    const maybeFinish = () => {
      if (settled || closedResult === null || (terminationStarted && !terminationComplete)) return;
      settled = true;
      clearTimeout(timeoutTimer);
      const { code, signal } = closedResult;
      resolveResult({
        exitCode: timedOut || overflow || spawnError ? null : Number.isInteger(code) ? code : null,
        // Reaping a private group after its leader exits must not convert the
        // leader's successful observation into a synthetic SIGKILL failure.
        signal: signal ?? (forcedTermination ? "SIGKILL" : null),
        launchError: spawnError ? spawnError.message : overflow ? "process output exceeded buffer limit" : undefined,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
      });
    };
    const terminate = () => {
      try {
        // `detached` gives this invocation its own process group on Unix.
        // Killing only -child.pid cannot affect sibling processes.
        if (grouped && Number.isInteger(child?.pid)) process.kill(-child.pid, "SIGKILL");
        else child?.kill("SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") spawnError ??= error;
      }
    };
    const beginTermination = ({ forced = false } = {}) => {
      if (terminationStarted) return;
      terminationStarted = true;
      forcedTermination = forced;
      terminate();
      terminationComplete = true;
      maybeFinish();
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length <= maxBytes) return next;
      overflow = true;
      beginTermination({ forced: true });
      return next.subarray(0, maxBytes);
    };
    try {
      child = spawn(file, args, { cwd, env, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({ exitCode: null, signal: null, launchError: error instanceof Error ? error.message : String(error), stdout: "", stderr: "", timedOut: false });
      return;
    }
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => { spawnError = error; });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      beginTermination({ forced: true });
    }, timeout);
    // `close` waits for stdio. A clean parent can leave a descendant holding
    // those descriptors, so reap this invocation's private group at `exit`.
    child.on("exit", (code, signal) => {
      exitResult = { code, signal };
      beginTermination();
    });
    child.on("close", (code, signal) => {
      closedResult = exitResult ?? { code, signal };
      clearTimeout(timeoutTimer);
      maybeFinish();
    });
  });
}

/**
 * Launch an installed bin the way a consumer's `node_modules/.bin` entry is
 * actually invoked: `node <linkedBin> --help`, so `process.argv[1]` is the
 * installer-created path. Launching the realpath target instead is a false
 * green against a `detectMainModule` guard that compares `import.meta.url`
 * (always a realpath) to `resolve(argv[1])` (the `.bin` symlink). A reached
 * process with empty stdout and stderr is a dead bin, not a pass.
 */
export async function probeInstalledBin({
  linkedBin,
  targetPath,
  runProcess: invoke = runProcess,
  cwd,
  env,
  timeout = DEFAULT_TIMEOUT_MS,
  label = "bin",
}) {
  let linkedReal;
  let targetReal;
  try {
    linkedReal = await realpath(linkedBin);
    targetReal = await realpath(targetPath);
  } catch {
    throw new Error(`${label} is not linked to its declared target`);
  }
  if (linkedReal !== targetReal) throw new Error(`${label} is not linked to its declared target`);
  const result = await invoke(process.execPath, [linkedBin, "--help"], { cwd, env, timeout });
  if (result.timedOut || result.launchError) {
    throw new Error(`${label} was not reached within ${timeout}ms`);
  }
  if (result.stdout === "" && result.stderr === "") {
    throw new Error(`${label} was reached with empty stdout and stderr`);
  }
  return result;
}

export function installedIdentityFindings({ packedManifest, installedManifest, dependencySpec, consumer, tarball }) {
  const findings = [];
  if (installedManifest?.name !== packedManifest?.name || installedManifest?.version !== packedManifest?.version) {
    findings.push(`${packedManifest?.name ?? "package"} installed identity does not match packed ${packedManifest?.name}@${packedManifest?.version}`);
  }
  if (typeof dependencySpec !== "string" || !dependencySpec.startsWith("file:")) {
    findings.push(`${packedManifest?.name ?? "package"} dependency does not select an exact local tarball`);
  } else if (resolve(consumer, dependencySpec.slice("file:".length)) !== resolve(tarball)) {
    findings.push(`${packedManifest?.name ?? "package"} dependency selects a different local tarball`);
  }
  return findings;
}

export async function installedPackageRoots(nodeModules, name) {
  const roots = [];
  const inspectPackage = async (path) => {
    try {
      const manifest = await json(join(path, "package.json"));
      if (manifest.name === name) roots.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await walk(join(path, "node_modules"));
  };
  const walk = async (directory) => {
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const item of items) {
      if (!item.isDirectory() || item.name === ".bin") continue;
      const path = join(directory, item.name);
      if (item.name.startsWith("@")) {
        let scoped = [];
        try { scoped = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
        for (const child of scoped) if (child.isDirectory()) await inspectPackage(join(path, child.name));
      } else {
        await inspectPackage(path);
      }
    }
  };
  await walk(nodeModules);
  return roots;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

// A run-root disk high-water mark, sampled with `du -sk` (fast: one process,
// no per-file Node syscalls) rather than walking node_modules with fs.stat --
// the trees this measures (react, next, tailwindcss, ...) run to tens of
// thousands of files. `du` is not guaranteed on win32, so a slower pure-JS
// walk is the fallback there, never the primary path.
async function directoryKilobytes(path) {
  if (process.platform !== "win32") {
    const result = await runProcess("du", ["-sk", path], { timeout: 60_000 });
    if (result.exitCode === 0 && !result.timedOut && !result.launchError) {
      const kilobytes = Number.parseInt(result.stdout.trim().split(/\s+/)[0], 10);
      if (Number.isFinite(kilobytes)) return kilobytes;
    }
  }
  return walkKilobytes(path);
}

async function walkKilobytes(path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) total += await walkKilobytes(entryPath);
    else if (entry.isFile()) total += Math.ceil((await stat(entryPath)).size / 1024);
  }
  return total;
}

async function npm(env, cwd, args, timeout = 180_000) {
  const result = await runProcess(npmExecutable(), args, { cwd, env, timeout });
  if (result.exitCode !== 0 || result.timedOut || result.launchError) {
    throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
  }
  return result;
}

async function packedManifest(tarball, env) {
  const result = await runProcess("tar", ["-xOf", tarball, "package/package.json"], { env, timeout: 30_000 });
  if (result.exitCode !== 0 || result.timedOut || result.launchError) {
    throw new Error(`could not read packed manifest from ${tarball}: ${result.stderr || result.launchError || "timed out"}`);
  }
  return JSON.parse(result.stdout);
}

async function packPackages(packDirectory, packages, env) {
  const packed = [];
  for (const entry of packages) {
    const result = await npm(env, entry.path, ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory]);
    const report = JSON.parse(result.stdout);
    if (!Array.isArray(report) || report.length !== 1 || !report[0]?.filename) throw new Error(`${entry.manifest.name} npm pack returned an invalid report`);
    const tarball = join(packDirectory, report[0].filename);
    const manifest = await packedManifest(tarball, env);
    packed.push({ ...entry, tarball, packedManifest: manifest });
  }
  return packed;
}

async function writeConsumer(directory) {
  await writeFile(join(directory, "package.json"), `${JSON.stringify({ name: "foundry-packed-consumer", private: true, type: "module" }, null, 2)}\n`);
}

async function installConsumer(directory, packed, env) {
  await writeConsumer(directory);
  await npm(env, directory, ["install", "--ignore-scripts", "--omit=peer", "--no-package-lock", ...packed.map((entry) => entry.tarball)]);
}

async function exactPeerSpecs(root, peers) {
  const specs = [];
  for (const name of peers) {
    const manifest = await json(join(root, "node_modules", ...name.split("/"), "package.json"));
    specs.push(`${name}@${manifest.version}`);
  }
  return specs;
}

async function installPeers(root, consumer, peers, env) {
  if (peers.length === 0) return;
  await npm(env, consumer, ["install", "--ignore-scripts", "--no-save", "--legacy-peer-deps", ...await exactPeerSpecs(root, peers)]);
}

async function installedRoot(consumer, name) {
  return join(consumer, "node_modules", ...name.split("/"));
}

async function assertIdentities(consumer, packed) {
  const consumerManifest = await json(join(consumer, "package.json"));
  const findings = [];
  for (const entry of packed) {
    const installedManifest = await json(join(await installedRoot(consumer, entry.packedManifest.name), "package.json"));
    findings.push(...installedIdentityFindings({
      packedManifest: entry.packedManifest,
      installedManifest,
      dependencySpec: consumerManifest.dependencies?.[entry.packedManifest.name],
      consumer,
      tarball: entry.tarball,
    }));
  }
  if (findings.length > 0) throw new Error(`installed identity check failed:\n- ${findings.join("\n- ")}`);
}

// The refusal probe catches the import's error itself and writes its own
// message and code as the final stderr line, then exits with REFUSAL_EXIT.
// `writeSync` keeps that line from being lost to an asynchronous pipe.
function refusalProbeSource(specifier) {
  return [
    'import { writeSync } from "node:fs";',
    "try {",
    `  await import(${JSON.stringify(specifier)});`,
    "} catch (error) {",
    '  const code = typeof error?.code === "string" ? error.code : null;',
    '  const message = typeof error?.message === "string" ? error.message : String(error);',
    `  writeSync(2, ${JSON.stringify(`\n${REFUSAL_REPORT}`)} + JSON.stringify({ code, message }) + "\\n");`,
    `  process.exit(${REFUSAL_EXIT});`,
    "}",
  ].join("\n");
}

export async function importSpecifier(specifier, consumer, env, condition = "default", { refusalProbe = false, timeout } = {}) {
  if (!IMPORT_CONDITIONS.includes(condition)) throw new Error(`unsupported runtime import condition ${condition}`);
  return runProcess(process.execPath, [
    ...(condition === "default" ? [] : [`--conditions=${condition}`]),
    "--input-type=module",
    "--eval",
    refusalProbe ? refusalProbeSource(specifier) : `await import(${JSON.stringify(specifier)})`,
  ], { cwd: consumer, env, timeout });
}

/**
 * Judges one refusal-probe result against its declared marker. Returns null
 * for the declared refusal and a reason for anything else. Only the probe's
 * own final report line is read: free-form stdout/stderr is never searched
 * for the marker, and an error with any string `code` (a Node module error
 * for a missing package or unexported path, a file-system error such as
 * ENOENT, and the like) is breakage even when its message quotes the marker.
 * This guards against accidental breakage; a module written to forge the
 * report and exit code is outside the threat model.
 */
export function byDesignRefusalFinding(result, marker) {
  if (result.timedOut) return "timed out instead of throwing its declared refusal";
  if (result.launchError) return `could not be launched (${result.launchError}) instead of throwing its declared refusal`;
  if (result.exitCode === 0) return "imports although it is declared to refuse by design";
  if (result.exitCode !== REFUSAL_EXIT) {
    return `ended with exit ${result.exitCode ?? "none"}${result.signal ? ` signal ${result.signal}` : ""} before throwing at import`;
  }
  const last = result.stderr.split("\n").filter((line) => line.trim() !== "").at(-1) ?? "";
  let report;
  try {
    report = last.startsWith(REFUSAL_REPORT) ? JSON.parse(last.slice(REFUSAL_REPORT.length)) : undefined;
  } catch {
    report = undefined;
  }
  if (typeof report?.message !== "string") return "threw without a readable refusal report";
  if (typeof report.code === "string") {
    return `failed with error code ${report.code}, which is breakage, not its declared refusal: ${report.message}`;
  }
  if (!report.message.includes(marker)) return `threw a different error than its declared refusal: ${report.message}`;
  return null;
}

/**
 * Imports one raw runtime target and returns its outcome: `imports`,
 * `rejects` (only under an omitted `peer`, and only when the failure names
 * it) or `refuses` (only for a declared `marker`). Every other result throws.
 * With no `peer` this is the all-peers-present run, where an undeclared
 * failure is always a finding.
 */
export async function judgeRuntimeImport({ packageName, specifier, condition, marker, peer, consumer, env, timeout }) {
  const where = peer === undefined ? `${condition} ${specifier}` : `${packageName} omission row ${peer} ${condition} ${specifier}`;
  if (marker !== undefined) {
    const result = await importSpecifier(specifier, consumer, env, condition, { refusalProbe: true, timeout });
    const finding = byDesignRefusalFinding(result, marker);
    if (finding) throw new Error(`${where} declared by-design refusal ${finding}`);
    return "refuses";
  }
  const result = await importSpecifier(specifier, consumer, env, condition, { timeout });
  if (peer === undefined) {
    if (result.exitCode !== 0 || result.timedOut || result.launchError) {
      throw new Error(`${condition} ${specifier} runtime import failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
    }
    return "imports";
  }
  if (result.timedOut || result.launchError) throw new Error(`${packageName} omission row ${peer} could not evaluate ${condition} ${specifier}`);
  if (result.exitCode === 0) return "imports";
  if (!`${result.stderr}\n${result.stdout}`.includes(peer)) {
    throw new Error(`${packageName} omission row ${peer} makes ${condition} ${specifier} fail without naming the omitted peer`);
  }
  return "rejects";
}

function sortedKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key])]));
}

/**
 * Whether an observed omission row differs from its policy row. Key order is
 * not part of the row: specifiers and conditions are compared by key, so a
 * policy row need not list them in the order the run observes them.
 */
export function omissionRowDrifted(observed, expected) {
  return JSON.stringify(sortedKeys(observed)) !== JSON.stringify(sortedKeys(expected));
}

/** Declared refusals the packed shape never measures as a raw runtime target. */
export function unmeasuredRefusalFindings(packageName, shape, declared = {}) {
  const findings = [];
  for (const [specifier, conditions] of Object.entries(declared)) {
    for (const condition of Object.keys(conditions ?? {})) {
      if (!shape.rawRuntimeTargets.some((item) => item.specifier === specifier && item.condition === condition)) {
        findings.push(`${packageName} by-design refusal ${specifier} ${condition} is never measured as a raw runtime import`);
      }
    }
  }
  return findings;
}

function namespaceImports(specifiers) {
  return specifiers.map((specifier, index) => `import * as probe${index} from ${JSON.stringify(specifier)};\nvoid probe${index};`).join("\n");
}

async function writeNextFixture(consumer, contexts) {
  const app = join(consumer, "app");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "layout.js"), 'import { createElement } from "react";\n\nexport default function RootLayout({ children }) {\n  return createElement("html", null, createElement("body", null, children));\n}\n');
  await writeFile(join(app, "client-probe.js"), `"use client";\n\n${namespaceImports(contexts.client)}\n\nexport function ClientProbe() { return null; }\n`);
  await writeFile(join(app, "server-probe.js"), `${namespaceImports(contexts.server)}\n\nexport const serverProbe = true;\n`);
  await writeFile(join(app, "page.js"), 'import { createElement } from "react";\nimport { ClientProbe } from "./client-probe";\nimport { serverProbe } from "./server-probe";\n\nexport const dynamic = "force-dynamic";\n\nexport default function Page() {\n  void serverProbe;\n  return createElement(ClientProbe);\n}\n');
  await writeFile(join(consumer, "proxy.js"), `${namespaceImports(contexts.proxy)}\n\nexport function proxy() { return new Response(null); }\n`);
}

async function runNextContexts(consumer, contexts, env) {
  await writeNextFixture(consumer, contexts);
  return runProcess(join(consumer, "node_modules", ".bin", "next"), ["build"], {
    cwd: consumer,
    env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 180_000,
  });
}

function allOptionalPeers(packed) {
  return [...new Set(packed.flatMap((entry) => Object.entries(entry.packedManifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata?.optional === true)
    .map(([name]) => name)))].sort();
}

export async function runPackedConsumerReadiness({ root, selected, skipBuild = false, policy = OPTIONAL_PEER_POLICY, refusals = BY_DESIGN_REFUSALS, keep = false }) {
  if (!skipBuild) {
    const build = await runProcess(npmExecutable(), ["run", "build"], { cwd: root, env: process.env, timeout: 180_000 });
    if (build.exitCode !== 0 || build.timedOut || build.launchError) throw new Error(`build failed: ${build.stderr || build.stdout || build.launchError || "timed out"}`);
  }
  const packages = await discoverPublishablePackages(root, selected);
  const scratch = await mkdtemp(join(tmpdir(), "foundry-packed-consumer-"));
  const npmrc = join(scratch, "credentialless.npmrc");
  const globalNpmrc = join(scratch, "credentialless-global.npmrc");
  const cache = join(scratch, "npm-cache");
  await mkdir(cache);
  await writeFile(npmrc, "registry=https://registry.npmjs.org/\nalways-auth=false\nignore-scripts=true\naudit=false\nfund=false\n");
  await writeFile(globalNpmrc, "");
  const env = credentiallessEnv(process.env, npmrc, cache, globalNpmrc);
  // A single shared npm cache (`cache`, above) covers every npm invocation
  // this run makes -- the main consumer, every peer-omission matrix
  // consumer, and the packing step -- so no npm call below ever repopulates
  // it from the network. Disk pressure came from something else: as many
  // as twenty matrix consumers (one per optional peer, each a FULL
  // reinstall of every packed package) used to stay on disk simultaneously
  // until the whole run finished. `peakKilobytes` below tracks the real
  // high-water mark now that each consumer is deleted as soon as it has
  // been judged (see the deletions below), and the CLI prints it.
  let peakKilobytes = 0;
  const notePeak = async () => {
    peakKilobytes = Math.max(peakKilobytes, await directoryKilobytes(scratch));
  };
  try {
    const packDirectory = join(scratch, "packs");
    await mkdir(packDirectory);
    const packed = await packPackages(packDirectory, packages, env);
    await notePeak();
    const packedPackages = packed.map((entry) => ({ ...entry, manifest: entry.packedManifest }));
    const closureFailures = [
      ["by-design refusals are not closed", validateByDesignRefusals(packedPackages, refusals, { allowUnselected: Boolean(selected) })],
      ["optional-peer policy is not closed", validateOptionalPeerPolicy(packedPackages, policy, { allowUnselected: Boolean(selected), refusals })],
    ].filter(([, findings]) => findings.length > 0);
    if (closureFailures.length > 0) {
      throw new Error(closureFailures.map(([header, findings]) => `${header}:\n- ${findings.join("\n- ")}`).join("\n"));
    }

    const peers = allOptionalPeers(packed);
    const consumer = join(scratch, "consumer");
    await mkdir(consumer);
    await installConsumer(consumer, packed, env);
    await installPeers(root, consumer, peers, env);
    await assertIdentities(consumer, packed);

    const exportsByPackage = new Map();
    let staticTargets = 0;
    let runtimeImports = 0;
    let frameworkExports = 0;
    for (const entry of packed) {
      const packageName = entry.packedManifest.name;
      const declared = refusals[packageName] ?? {};
      const shape = await inspectPackedExports(await installedRoot(consumer, packageName), entry.packedManifest, declared);
      const unmeasured = unmeasuredRefusalFindings(packageName, shape, declared);
      if (unmeasured.length > 0) throw new Error(`by-design refusals are not closed:\n- ${unmeasured.join("\n- ")}`);
      exportsByPackage.set(packageName, shape);
      staticTargets += shape.staticTargets.length;
      for (const target of shape.rawRuntimeTargets) {
        await judgeRuntimeImport({ packageName, ...target, marker: declared[target.specifier]?.[target.condition], consumer, env });
        runtimeImports += 1;
      }
      if (shape.nextContexts.all.length > 0) {
        const result = await runNextContexts(consumer, shape.nextContexts, env);
        if (result.exitCode !== 0 || result.timedOut || result.launchError) {
          throw new Error(`${entry.packedManifest.name} Next context build failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
        }
        frameworkExports += shape.nextContexts.all.length;
      }
    }

    let bins = 0;
    for (const entry of packed) {
      const packageRoot = await installedRoot(consumer, entry.packedManifest.name);
      const packageReal = await realpath(packageRoot);
      for (const [name, target] of Object.entries(entry.packedManifest.bin ?? {})) {
        const targetPath = resolve(packageRoot, target);
        if (!inside(packageRoot, targetPath)) throw new Error(`${entry.packedManifest.name} bin ${name} escapes the installed package`);
        await stat(targetPath);
        if (!inside(packageReal, await realpath(targetPath))) throw new Error(`${entry.packedManifest.name} bin ${name} resolves outside the installed package`);
        const linkedBin = join(consumer, "node_modules", ".bin", name);
        await probeInstalledBin({
          linkedBin,
          targetPath,
          cwd: consumer,
          env,
          label: `${entry.packedManifest.name} bin ${name}`,
        });
        bins += 1;
      }
    }

    await notePeak();
    if (!keep) await rm(consumer, { recursive: true, force: true });

    const omission = [];
    const frameworkEvaluatorOmissions = [];
    for (const entry of packed) {
      const rows = policy[entry.packedManifest.name] ?? {};
      const packagePeers = Object.entries(entry.packedManifest.peerDependenciesMeta ?? {})
        .filter(([, metadata]) => metadata?.optional === true)
        .map(([name]) => name)
        .sort();
      for (const peer of packagePeers) {
        let matrixConsumer;
        try {
          matrixConsumer = join(scratch, `omit-${entry.directory}-${packagePeers.indexOf(peer)}`);
          await mkdir(matrixConsumer);
          await installConsumer(matrixConsumer, packed, env);
          await installPeers(root, matrixConsumer, peers, env);
          for (const packageRoot of await installedPackageRoots(join(matrixConsumer, "node_modules"), peer)) {
            await rm(packageRoot, { recursive: true, force: true });
          }
          if ((await installedPackageRoots(join(matrixConsumer, "node_modules"), peer)).length > 0) {
            throw new Error(`${entry.packedManifest.name} omission row ${peer} is false-green: the omitted peer is installed`);
          }
          const shape = exportsByPackage.get(entry.packedManifest.name) ?? { runtimeSpecifiers: [], runtimeTargets: [], rawRuntimeSpecifiers: [], rawRuntimeTargets: [], nextContexts: { client: [], server: [], proxy: [], all: [] } };
          const observed = new Map();
          const declared = refusals[entry.packedManifest.name] ?? {};
          for (const target of shape.rawRuntimeTargets) {
            observed.set(`${target.specifier}\u0000${target.condition}`, await judgeRuntimeImport({
              packageName: entry.packedManifest.name,
              ...target,
              marker: declared[target.specifier]?.[target.condition],
              peer,
              consumer: matrixConsumer,
              env,
            }));
          }
          if (shape.nextContexts.all.length > 0) {
            if (peer === "next") {
              const expectedFramework = new Set(shape.nextContexts.all.map((specifier) => rows[peer]?.[specifier]));
              if (expectedFramework.size !== 1 || !expectedFramework.has("rejects")) {
                throw new Error(`${entry.packedManifest.name} omission row next must fail closed for every declared Next context`);
              }
              for (const specifier of shape.nextContexts.all) observed.set(`${specifier}\u0000default`, "rejects");
              frameworkEvaluatorOmissions.push({
                package: entry.packedManifest.name,
                peer,
                exports: [...shape.nextContexts.all],
                evidence: "packed Next-context declaration plus verified physical absence of the Next evaluator peer",
              });
            } else {
              const expectedFramework = new Set(shape.nextContexts.all.map((specifier) => rows[peer]?.[specifier]));
              if (expectedFramework.size !== 1 || !["imports", "rejects"].includes([...expectedFramework][0])) {
                throw new Error(`${entry.packedManifest.name} omission row ${peer} has mixed or missing Next-context outcomes`);
              }
              const result = await runNextContexts(matrixConsumer, shape.nextContexts, env);
              const outcome = result.exitCode === 0 ? "imports" : "rejects";
              if (result.timedOut || result.launchError) throw new Error(`${entry.packedManifest.name} omission row ${peer} could not evaluate its Next contexts`);
              if (outcome === "rejects" && !`${result.stderr}\n${result.stdout}`.includes(peer)) {
                throw new Error(`${entry.packedManifest.name} omission row ${peer} makes its Next contexts fail without naming the omitted peer`);
              }
              for (const specifier of shape.nextContexts.all) observed.set(`${specifier}\u0000default`, outcome);
            }
          }
          const outcomes = Object.fromEntries(shape.runtimeSpecifiers.map((specifier) => {
            const conditions = shape.runtimeTargets.filter((item) => item.specifier === specifier).map((item) => item.condition);
            const expectedOutcome = rows[peer]?.[specifier];
            const values = conditions.map((condition) => [condition, observed.get(`${specifier}\u0000${condition}`)]);
            return [specifier, typeof expectedOutcome === "string"
              ? values.every(([, outcome]) => outcome === values[0]?.[1]) ? values[0]?.[1] : undefined
              : Object.fromEntries(values)];
          }));
          omission.push({ package: entry.packedManifest.name, peer, outcomes });
          const expected = rows[peer];
          if (omissionRowDrifted(outcomes, expected)) {
            throw new Error(`${entry.packedManifest.name} omission row ${peer} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(outcomes)}`);
          }
        } finally {
          await notePeak();
          if (!keep) await rm(matrixConsumer, { recursive: true, force: true });
        }
      }
    }

    return { scratch, packages: packed.length, staticTargets, runtimeImports, frameworkExports, bins, omissionRows: omission.length, frameworkEvaluatorOmissions, peakKilobytes };
  } finally {
    if (!keep) await rm(scratch, { recursive: true, force: true });
  }
}
