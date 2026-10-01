/**
 * Copies the site template into a consumer repository's `apps/site` with
 * exact `@clossys/*` pins, and makes the root manifest's workspaces cover it.
 *
 * Every refusal is decided before the first write. Messages name a rule and a
 * relative path only: never a pin, the root path or any file content.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type SiteInstantiateRule =
  | "site-dir-absolute"
  | "site-dir-parent"
  | "site-dir-invalid"
  | "site-dir-outside-root"
  | "target-not-empty"
  | "pins-not-object"
  | "missing-pin"
  | "pin-not-exact"
  | "root-manifest-missing"
  | "root-manifest-invalid"
  | "root-manifest-not-object"
  | "workspaces-unsupported"
  | "template-symlink";

/** The run was refused: nothing was written. */
export class SiteInstantiateRefusal extends Error {
  readonly rule: SiteInstantiateRule;
  readonly path: string;
  constructor(rule: SiteInstantiateRule, path: string) {
    super(`${rule}: ${path}`);
    this.name = "SiteInstantiateRefusal";
    this.rule = rule;
    this.path = path;
  }
}

/** The run could not be made (an unreadable template, say); not a judgment on the input. */
export class SiteInstantiateUnavailable extends Error {
  readonly rule: string;
  constructor(rule: string) {
    super(rule);
    this.name = "SiteInstantiateUnavailable";
    this.rule = rule;
  }
}

export interface SiteInstantiateOptions {
  /** The consumer repository root. */
  root: string;
  /** The parsed pins document: `{ "@clossys/<pkg>": "<exact semver>" }`. */
  pins: unknown;
  /** Repository-relative site directory. Defaults to `apps/site`. */
  siteDir?: string;
  /** Overrides the template found next to the installed package. */
  templateDir?: string;
  /** Test seam: runs after the site is in place and before the root manifest is written. */
  afterSiteInPlace?: () => void;
}

export interface SiteInstantiateResult {
  /** The normalised, repository-relative site directory. */
  siteDir: string;
  workspacesAdded: boolean;
}

const DEFAULT_SITE_DIR = "apps/site";
const SKIPPED_TEMPLATE_DIRS = new Set(["node_modules", ".next"]);
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** The template shipped next to this module: `src/site-template` and `dist/site-template` are both two levels below the package. */
export function defaultTemplateDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "site");
}

function normaliseSiteDir(input: string): string {
  if (isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\\\")) {
    throw new SiteInstantiateRefusal("site-dir-absolute", "--site-dir");
  }
  const segments = input.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) throw new SiteInstantiateRefusal("site-dir-parent", "--site-dir");
  if (segments.length === 0) throw new SiteInstantiateRefusal("site-dir-invalid", "--site-dir");
  return segments.join("/");
}

function validatePins(pins: unknown, siteDir: string): Record<string, string> {
  if (typeof pins !== "object" || pins === null || Array.isArray(pins)) {
    throw new SiteInstantiateRefusal("pins-not-object", "--pins");
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(pins as Record<string, unknown>)) {
    if (typeof value !== "string" || !EXACT_VERSION.test(value)) {
      throw new SiteInstantiateRefusal("pin-not-exact", `${siteDir}/package.json`);
    }
    out[name] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

interface JsonText {
  indent: string;
  eol: string;
  trailingNewline: boolean;
}

function readJsonText(text: string): JsonText {
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  return { indent, eol: text.includes("\r\n") ? "\r\n" : "\n", trailingNewline: /\n$/.test(text) };
}

function renderJson(value: unknown, format: JsonText): string {
  const body = JSON.stringify(value, null, format.indent);
  return `${format.eol === "\n" ? body : body.replace(/\n/g, format.eol)}${format.trailingNewline ? format.eol : ""}`;
}

function normalisePattern(pattern: string): string {
  return pattern.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function coversSite(patterns: readonly string[], siteDir: string): boolean {
  const parent = siteDir.includes("/") ? siteDir.slice(0, siteDir.lastIndexOf("/")) : null;
  const covering = new Set([siteDir, "**"]);
  if (parent === null) covering.add("*");
  else {
    covering.add(`${parent}/*`);
    covering.add(`${parent}/**`);
  }
  return patterns.some((pattern) => covering.has(normalisePattern(pattern)));
}

interface RootPlan {
  /** The new root manifest text, or null when no change is needed. */
  text: string | null;
}

function planRootManifest(root: string, siteDir: string): RootPlan {
  const path = join(root, "package.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT" || (cause as NodeJS.ErrnoException).code === "EISDIR") {
      throw new SiteInstantiateRefusal("root-manifest-missing", "package.json");
    }
    throw cause;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SiteInstantiateRefusal("root-manifest-invalid", "package.json");
  }
  if (!isPlainObject(parsed)) throw new SiteInstantiateRefusal("root-manifest-not-object", "package.json");

  const workspaces = parsed.workspaces;
  const addition = siteDir.includes("/") ? `${siteDir.slice(0, siteDir.lastIndexOf("/"))}/*` : siteDir;
  const format = readJsonText(raw);
  if (!("workspaces" in parsed)) {
    return { text: renderJson({ ...parsed, workspaces: [addition] }, format) };
  }
  if (isStringArray(workspaces)) {
    if (coversSite(workspaces, siteDir)) return { text: null };
    return { text: renderJson({ ...parsed, workspaces: [...workspaces, addition] }, format) };
  }
  if (isPlainObject(workspaces) && isStringArray(workspaces.packages)) {
    if (coversSite(workspaces.packages, siteDir)) return { text: null };
    return {
      text: renderJson({ ...parsed, workspaces: { ...workspaces, packages: [...workspaces.packages, addition] } }, format),
    };
  }
  throw new SiteInstantiateRefusal("workspaces-unsupported", "package.json");
}

interface TemplateTree {
  directories: string[];
  files: string[];
}

/** Relative `/`-joined paths of everything to copy. A symlink outside the skipped directories refuses the run. */
function scanTemplate(templateDir: string): TemplateTree {
  const tree: TemplateTree = { directories: [], files: [] };
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.isDirectory() && SKIPPED_TEMPLATE_DIRS.has(entry.name)) continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new SiteInstantiateRefusal("template-symlink", rel);
      if (entry.isDirectory()) {
        tree.directories.push(rel);
        visit(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        tree.files.push(rel);
      }
    }
  };
  visit(templateDir, "");
  return tree;
}

function pinnedManifest(templateDir: string, pins: Record<string, string>, siteDir: string): string {
  let raw: string;
  try {
    raw = readFileSync(join(templateDir, "package.json"), "utf8");
  } catch {
    throw new SiteInstantiateUnavailable("template-unreadable");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new SiteInstantiateUnavailable("template-unreadable");
  }
  if (!isPlainObject(manifest)) throw new SiteInstantiateUnavailable("template-unreadable");
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = manifest[section];
    if (!isPlainObject(deps)) continue;
    for (const name of Object.keys(deps)) {
      if (!name.startsWith("@clossys/")) continue;
      const pin = pins[name];
      if (pin === undefined) throw new SiteInstantiateRefusal("missing-pin", `${siteDir}/package.json`);
      deps[name] = pin;
    }
  }
  return renderJson(manifest, readJsonText(raw));
}

/** Nearest existing ancestor of `path` (the path itself when it exists). */
function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

interface TargetState {
  /** True when an empty directory already sits at the target. */
  emptyDirectoryExists: boolean;
}

function checkTarget(root: string, target: string, siteDir: string): TargetState {
  const realRoot = realpathSync(root);
  const realAncestor = realpathSync(nearestExisting(target));
  const rel = relative(realRoot, realAncestor);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SiteInstantiateRefusal("site-dir-outside-root", siteDir);
  }
  let stat;
  try {
    stat = lstatSync(target);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { emptyDirectoryExists: false };
    throw cause;
  }
  if (!stat.isDirectory() || readdirSync(target).length > 0) {
    throw new SiteInstantiateRefusal("target-not-empty", siteDir);
  }
  return { emptyDirectoryExists: true };
}

/** Lowest directory that does not exist yet on the way to `dir`, or null when `dir` exists. */
function firstMissingAncestor(dir: string): string | null {
  if (existsSync(dir)) return null;
  let missing = dir;
  while (!existsSync(dirname(missing))) missing = dirname(missing);
  return missing;
}

export function instantiateSite(options: SiteInstantiateOptions): SiteInstantiateResult {
  const siteDir = normaliseSiteDir(options.siteDir ?? DEFAULT_SITE_DIR);
  const pins = validatePins(options.pins, siteDir);
  const root = resolve(options.root);
  const rootPlan = planRootManifest(root, siteDir);
  const templateDir = options.templateDir ?? defaultTemplateDir();
  const tree = (() => {
    try {
      return scanTemplate(templateDir);
    } catch (cause) {
      if (cause instanceof SiteInstantiateRefusal) throw cause;
      throw new SiteInstantiateUnavailable("template-unreadable");
    }
  })();
  const manifestText = pinnedManifest(templateDir, pins, siteDir);
  const target = join(root, ...siteDir.split("/"));
  const targetState = checkTarget(root, target, siteDir);

  // Everything that can be refused has been. From here on, a failure rolls back.
  const parent = dirname(target);
  const createdTop = firstMissingAncestor(parent);
  let staging: string | null = null;
  let rootTemp: string | null = null;
  let siteInPlace = false;
  try {
    mkdirSync(parent, { recursive: true });
    staging = mkdtempSync(join(parent, `.${basename(target)}-instantiate-`));
    for (const dir of tree.directories) mkdirSync(join(staging, ...dir.split("/")));
    for (const file of tree.files) {
      if (file === "package.json") continue;
      copyFileSync(join(templateDir, ...file.split("/")), join(staging, ...file.split("/")));
    }
    writeFileSync(join(staging, "package.json"), manifestText);
    if (targetState.emptyDirectoryExists) rmdirSync(target);
    renameSync(staging, target);
    staging = null;
    siteInPlace = true;
    options.afterSiteInPlace?.();
    if (rootPlan.text !== null) {
      rootTemp = join(root, `.package.json.${process.pid}.instantiate.tmp`);
      writeFileSync(rootTemp, rootPlan.text);
      renameSync(rootTemp, join(root, "package.json"));
      rootTemp = null;
    }
  } catch (cause) {
    if (rootTemp !== null) rmSync(rootTemp, { force: true });
    if (staging !== null) rmSync(staging, { recursive: true, force: true });
    if (siteInPlace) {
      rmSync(target, { recursive: true, force: true });
      if (targetState.emptyDirectoryExists) mkdirSync(target, { recursive: true });
    }
    if (createdTop !== null) rmSync(createdTop, { recursive: true, force: true });
    throw cause;
  }
  return { siteDir, workspacesAdded: rootPlan.text !== null };
}
