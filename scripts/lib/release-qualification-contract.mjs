import { ARCHETYPES, parseStrictJson } from "./candidate-qualification.mjs";

const DIMENSIONS = ["position", "completion", "rollback", "duplicate", "cadence", "closeWindow"];
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const BIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FIXTURE_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LITERAL_ARG = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const OVERLAY_PATH = /^(?:package(?:-lock)?\.json|node_modules\/(?:@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}|[a-z0-9][a-z0-9._-]{0,63})\/(?:package\.json|dist\/[a-z0-9][a-z0-9._-]{0,127}\.js))$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/[a-z0-9][a-z0-9._-]{0,213}|[a-z0-9][a-z0-9._-]{0,213})$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PACKAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPOSITORY_PATH = /^(?:packages\/[a-z0-9][a-z0-9-]{0,63}|governance\/release-qualification-(?:adapters|fixtures)\/[a-z0-9][a-z0-9-]{0,63}\/current-direct(?:\.json)?)$/;
const forbidden = new Set(["command", "shell", "cwd", "env", "url", "registry", "interpolation", "executable", "path"]);
const finding = (findings, rule, message) => findings.push({ rule, message });
const closed = (findings, value, allowed, path) => { if (!object(value)) { finding(findings, "shape", `${path} must be an object.`); return; } for (const key of Object.keys(value)) if (!allowed.includes(key)) finding(findings, forbidden.has(key) ? "forbidden-field" : "unknown-field", `${path}.${key}`); };

function versionParts(version) { const match = VERSION.exec(version); return match ? match.slice(1).map(Number) : null; }
function compare(left, right) { for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1; return 0; }
function satisfiesSimpleRange(version, range) {
  const candidate = versionParts(version);
  if (!candidate || typeof range !== "string") return false;
  // The only non-exact open lower bound admitted here is a normal npm major
  // floor (>=18) or a complete stable semver floor (>=18.0.0).  Do not grow
  // this into a general semver parser: compound, OR, prerelease and tag
  // ranges would make a qualification fixture mean something npm resolves
  // differently on another host.
  const lower = /^>=(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/.exec(range);
  if (lower) {
    const base = [Number(lower[1]), Number(lower[2] ?? 0), Number(lower[3] ?? 0)];
    return compare(candidate, base) >= 0;
  }
  const prefix = ["~", "^"].includes(range[0]) ? range[0] : "";
  const base = versionParts(prefix ? range.slice(1) : range);
  if (!base || compare(candidate, base) < 0) return false;
  if (!prefix) return compare(candidate, base) === 0;
  const ceiling = prefix === "~" ? [base[0], base[1] + 1, 0] : base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
  return compare(candidate, ceiling) < 0;
}

/** Validate global, producer-owned package bindings before resolving a path. */
export function validateReleaseQualificationPolicy(policy) {
  const findings = [];
  closed(findings, policy, ["schemaVersion", "protocol", "packages"], "policy");
  if (policy?.schemaVersion !== 1 || policy?.protocol !== "foundry-candidate-qualification-v1") finding(findings, "policy-version", "policy protocol required.");
  if (!object(policy?.packages) || Object.keys(policy.packages).length < 1 || Object.keys(policy.packages).length > 64) {
    finding(findings, "policy-packages", "policy packages must be a bounded object.");
    return findings;
  }
  const seen = { packageKey: new Set(), recordStem: new Set(), packageDir: new Set(), adapterPath: new Set(), fixturePath: new Set() };
  for (const [name, entry] of Object.entries(policy.packages)) {
    closed(findings, entry, ["packageKey", "recordStem", "packageDir", "adapterPath", "fixturePath", "archetypes", "dimensions"], `policy.packages.${name}`);
    const scope = /^@([a-z0-9][a-z0-9._-]{0,213})\//.exec(name)?.[1];
    if (!PACKAGE.test(name) || !scope || !PACKAGE_KEY.test(entry?.packageKey) || entry?.recordStem !== `${scope}-${entry?.packageKey}` || entry?.packageDir !== `packages/${entry?.packageKey}` || !REPOSITORY_PATH.test(entry?.adapterPath) || !REPOSITORY_PATH.test(entry?.fixturePath) || !entry.adapterPath.endsWith(".json") || entry.fixturePath.endsWith(".json")) finding(findings, "package-policy", `exact namespace-qualified package bindings required for ${name}.`);
    for (const key of Object.keys(seen)) {
      const value = entry?.[key];
      if (typeof value !== "string" || seen[key].has(value)) finding(findings, "package-policy-unique", `${key} must be unique.`);
      else seen[key].add(value);
    }
  }
  return findings;
}

export function selectPolicyPackage(policy, packageKey) {
  if (!PACKAGE_KEY.test(packageKey)) return null;
  const matches = Object.entries(policy?.packages ?? {}).filter(([, entry]) => entry?.packageKey === packageKey);
  return matches.length === 1 ? { name: matches[0][0], entry: matches[0][1] } : null;
}

/** Pure, package-neutral validation. Fixture observations are supplied by the runner. */
export function validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins, peerDependencies = {}, peerDependenciesMeta = {} }) {
  const findings = [];
  findings.push(...validateReleaseQualificationPolicy(policy));
  const selected = policy?.packages?.[adapter?.package];
  closed(findings, selected, ["packageKey", "recordStem", "packageDir", "adapterPath", "fixturePath", "archetypes", "dimensions"], "policy.package");
  closed(findings, selected?.archetypes, ARCHETYPES, "policy.archetypes");
  for (const archetype of ARCHETYPES) { const item = selected?.archetypes?.[archetype]; closed(findings, item, ["status", "reason"], `policy.archetypes.${archetype}`); const allowed = archetype === "current-direct" ? ["required"] : ["unsupported"]; if (!allowed.includes(item?.status) || (item?.status === "unsupported" && !nonempty(item.reason)) || (item?.status === "required" && item.reason !== undefined)) finding(findings, "archetype-policy", `${archetype} policy invalid.`); }
  closed(findings, selected?.dimensions, DIMENSIONS, "policy.dimensions");
  for (const dimension of DIMENSIONS) { const item = selected?.dimensions?.[dimension]; closed(findings, item, ["status", "reason"], `policy.dimensions.${dimension}`); const allowed = ["rollback", "duplicate"].includes(dimension) ? ["required", "unsupported"] : ["unsupported"]; if (!allowed.includes(item?.status) || (item?.status === "unsupported" && !nonempty(item.reason))) finding(findings, "dimension-policy", `${dimension} policy invalid.`); }
  closed(findings, adapter, ["schemaVersion", "package", "archetype", "bins", "fixtures", "cases", "dimensionEvidence", "peerInstall", "consumerOverlay", "retainRawCaseEvidence"], "adapter");
  if (adapter?.schemaVersion !== 1 || !nonempty(adapter?.package) || adapter?.archetype !== "current-direct") finding(findings, "adapter-shape", "adapter must be schema 1 current-direct data.");
  if (adapter?.package === "@clossys/starter" ? adapter?.retainRawCaseEvidence !== true : Object.prototype.hasOwnProperty.call(adapter ?? {}, "retainRawCaseEvidence")) finding(findings, "raw-case-evidence", "only the current @clossys/starter adapter must retain raw case evidence.");
  closed(findings, adapter?.bins, Object.keys(adapter?.bins ?? {}), "adapter.bins");
  for (const [bin, exit] of Object.entries(adapter?.bins ?? {})) if (!BIN.test(bin) || ![0, 2].includes(exit) || !Object.prototype.hasOwnProperty.call(manifestBins ?? {}, bin)) finding(findings, "bin", `invalid or undeclared bin ${bin}.`);
  const peers = adapter?.peerInstall ?? {};
  closed(findings, peers, Object.keys(peers), "adapter.peerInstall");
  if (Object.keys(peers).length > 16) finding(findings, "peer-install", "peerInstall is bounded to 16 packages.");
  for (const [name, version] of Object.entries(peers)) {
    const declaredRange = peerDependencies?.[name];
    const optional = peerDependenciesMeta?.[name]?.optional === true;
    if (!PACKAGE.test(name) || !VERSION.test(version) || typeof declaredRange !== "string" || !optional || !satisfiesSimpleRange(version, declaredRange)) finding(findings, "peer-install", `invalid optional peer install ${name}.`);
  }
  if (!Array.isArray(adapter?.fixtures) || adapter.fixtures.length > 64) finding(findings, "fixtures", "bounded fixture list required.");
  else for (const name of adapter.fixtures) { const observed = fixtures?.[name]; if (!FIXTURE_PATH.test(name) || name.split("/").includes("..") || !object(observed) || observed.type !== "file" || observed.symlink || observed.tracked !== true || !Number.isSafeInteger(observed.size) || observed.size < 1 || observed.size > 65536) finding(findings, "fixture", `unsafe fixture ${name}.`); }
  if (adapter?.consumerOverlay !== undefined) {
    if (!Array.isArray(adapter.consumerOverlay) || adapter.consumerOverlay.length > 64) finding(findings, "consumer-overlay", "consumerOverlay must be a bounded array.");
    else {
      const targets = new Set();
      for (const item of adapter.consumerOverlay) {
        closed(findings, item, ["fixture", "target"], "adapter.consumerOverlay");
        const candidateRoot = `node_modules/${adapter.package}/`;
        if (!FIXTURE_PATH.test(item?.fixture) || !adapter.fixtures?.includes(item.fixture) || !OVERLAY_PATH.test(item?.target) || item.target.startsWith(candidateRoot) || targets.has(item.target)) finding(findings, "consumer-overlay", "overlay entries must bind unique declared fixtures to safe non-candidate consumer paths.");
        targets.add(item?.target);
      }
    }
  }
  if (!Array.isArray(adapter?.cases) || adapter.cases.length > 64) finding(findings, "cases", "bounded cases required.");
  else { const ids = new Set(), groups = new Map(), exits = new Set(); for (const item of adapter.cases) { closed(findings, item, ["id", "bin", "fixtureArgs", "args", "exitCode", "group"], "adapter.case"); const legacyArgs = Array.isArray(item.fixtureArgs) && item.args === undefined && item.fixtureArgs.length <= 8 && item.fixtureArgs.every((arg) => adapter.fixtures?.includes(arg) && FIXTURE_PATH.test(arg)); const describedArgs = item.fixtureArgs === undefined && Array.isArray(item.args) && item.args.length <= 8 && item.args.every((arg) => { if (!object(arg) || Object.keys(arg).length !== 1) return false; if (typeof arg.literal === "string") return LITERAL_ARG.test(arg.literal); if (typeof arg.fixture === "string") return adapter.fixtures?.includes(arg.fixture) && FIXTURE_PATH.test(arg.fixture); if (typeof arg.fixtureDirectory === "string") return FIXTURE_PATH.test(arg.fixtureDirectory) && adapter.fixtures?.some((fixture) => fixture.startsWith(`${arg.fixtureDirectory}/`)); return false; }); if (!nonempty(item?.id) || ids.has(item.id) || !BIN.test(item.bin) || !Object.prototype.hasOwnProperty.call(adapter.bins ?? {}, item.bin) || (!legacyArgs && !describedArgs) || ![0, 1, 2].includes(item.exitCode) || !nonempty(item.group)) finding(findings, "case", "invalid case."); ids.add(item?.id); exits.add(item?.exitCode); const key = `${item?.bin}\0${item?.group}`; groups.set(key, [...(groups.get(key) ?? []), item?.exitCode]); } for (const exit of [0, 1, 2]) if (!exits.has(exit)) finding(findings, "exit-coverage", `missing ${exit}.`); if (![...groups.values()].some((values) => values.includes(0) && values.includes(1))) finding(findings, "matched-control", "same bin/group red and green required."); }
  closed(findings, adapter?.dimensionEvidence, ["rollback", "duplicate"], "adapter.dimensionEvidence");
  if (adapter?.dimensionEvidence?.rollback !== "restoration") finding(findings, "dimension-evidence", "rollback must use built-in restoration evidence.");
  const duplicateGroup = adapter?.dimensionEvidence?.duplicate;
  const matched = Array.isArray(adapter?.cases) && adapter.cases.some((item) => item.group === duplicateGroup && item.exitCode === 0 && adapter.cases.some((other) => other.group === duplicateGroup && other.bin === item.bin && other.exitCode === 1));
  if (!nonempty(duplicateGroup) || !matched) finding(findings, "dimension-evidence", "duplicate must name a matched adapter control group.");
  return findings;
}
export { parseStrictJson };
