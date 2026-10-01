import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTokenPurity, scanStyleSources } from "@clossys/designer/gate";
import { TOKENS } from "@clossys/designer/tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SiteInstantiateRefusal, instantiateSite, type SiteInstantiateRule } from "./instantiate.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE_DIR = join(PACKAGE_ROOT, "templates", "site");
const SKIPPED = new Set(["node_modules", ".next"]);

let work: string;
let root: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "publisher-site-instantiate-"));
  root = join(work, "consumer");
  mkdirSync(root);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

function templateManifest(): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, "package.json"), "utf8")) as Record<string, Record<string, string>>;
}

/** An exact pin for every `@clossys/*` range the template declares (fictional versions). */
function fullPins(): Record<string, string> {
  const pins: Record<string, string> = {};
  let patch = 1;
  const manifest = templateManifest();
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (name.startsWith("@clossys/")) pins[name] = `9.${patch++}.0`;
    }
  }
  return pins;
}

function writeRoot(manifest: unknown, raw?: string): string {
  const path = join(root, "package.json");
  writeFileSync(path, raw ?? `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

function refusal(run: () => unknown): SiteInstantiateRefusal {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SiteInstantiateRefusal);
    return error as SiteInstantiateRefusal;
  }
  throw new Error("expected a refusal, got a clean run");
}

function expectRefused(rule: SiteInstantiateRule, run: () => unknown): SiteInstantiateRefusal {
  const error = refusal(run);
  expect(error.rule).toBe(rule);
  return error;
}

/** Relative path -> bytes, for every file under `dir` (directories as `<path>/`). */
function snapshot(dir: string, skip: ReadonlySet<string> = new Set()): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(current, entry.name);
      const rel = relative(dir, full).split(sep).join("/");
      if (entry.isDirectory()) {
        out.set(`${rel}/`, null);
        visit(full);
      } else {
        out.set(rel, readFileSync(full));
      }
    }
  };
  visit(dir);
  return out;
}

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes("instantiate") || name.endsWith(".tmp"));
}

// ------------------------------------------------------------ the target

describe("instantiateSite: the target directory", () => {
  it("refuses a non-empty target and writes nothing", () => {
    const rootFile = writeRoot({ name: "example-project", private: true });
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    writeFileSync(join(root, "apps", "site", "keep.txt"), "kept");
    const before = snapshot(root);
    const error = expectRefused("target-not-empty", () => instantiateSite({ root, pins: fullPins() }));
    expect(error.message).toContain("apps/site");
    expect(snapshot(root)).toEqual(before);
    expect(readFileSync(rootFile, "utf8")).toBe(`${JSON.stringify({ name: "example-project", private: true }, null, 2)}\n`);
  });

  it("refuses a target that is a file", () => {
    writeRoot({ name: "example-project" });
    mkdirSync(join(root, "apps"));
    writeFileSync(join(root, "apps", "site"), "not a directory");
    expectRefused("target-not-empty", () => instantiateSite({ root, pins: fullPins() }));
  });

  it("accepts an empty directory and a missing one", () => {
    writeRoot({ name: "example-project" });
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    instantiateSite({ root, pins: fullPins() });
    expect(existsSync(join(root, "apps", "site", "package.json"))).toBe(true);

    rmSync(join(root, "apps"), { recursive: true });
    writeRoot({ name: "example-project" });
    instantiateSite({ root, pins: fullPins() });
    expect(existsSync(join(root, "apps", "site", "package.json"))).toBe(true);
  });

  it("honours --site-dir and refuses an absolute or parent-escaping one without echoing it", () => {
    writeRoot({ name: "example-project" });
    const result = instantiateSite({ root, pins: fullPins(), siteDir: "web/marketing" });
    expect(result.siteDir).toBe("web/marketing");
    expect(existsSync(join(root, "web", "marketing", "package.json"))).toBe(true);

    for (const bad of [join(work, "elsewhere"), "../elsewhere", "apps/../../elsewhere", "C:\\elsewhere", ""]) {
      const error = refusal(() => instantiateSite({ root, pins: fullPins(), siteDir: bad }));
      expect(["site-dir-absolute", "site-dir-parent", "site-dir-invalid"]).toContain(error.rule);
      expect(error.message).not.toContain("elsewhere");
    }
    expect(existsSync(join(work, "elsewhere"))).toBe(false);
  });

  it("refuses a target path that leaves the root through a symlinked directory", () => {
    writeRoot({ name: "example-project" });
    const outside = join(work, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(root, "apps"));
    expectRefused("site-dir-outside-root", () => instantiateSite({ root, pins: fullPins() }));
    expect(readdirSync(outside)).toEqual([]);
  });
});

// ---------------------------------------------------------------- pins

describe("instantiateSite: pins", () => {
  it("refuses a missing pin for a range the template declares, before writing anything", () => {
    writeRoot({ name: "example-project" });
    const before = snapshot(root);
    for (const name of Object.keys(fullPins())) {
      const pins = fullPins();
      delete pins[name];
      const error = expectRefused("missing-pin", () => instantiateSite({ root, pins }));
      expect(error.message).not.toContain("9.");
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("refuses a pin that is not an exact version rather than falling back to the template range", () => {
    writeRoot({ name: "example-project" });
    const before = snapshot(root);
    const [first] = Object.keys(fullPins());
    for (const bad of ["^9.1.0", "~9.1.0", "9.1", ">=9.1.0", "latest", "9.1.0-rc.1", "workspace:*", "", 9, null, ["9.1.0"]]) {
      const pins: Record<string, unknown> = { ...fullPins(), [first as string]: bad };
      const error = expectRefused("pin-not-exact", () => instantiateSite({ root, pins }));
      expect(error.message).not.toContain("9.1");
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("refuses a pins document that is not an object", () => {
    writeRoot({ name: "example-project" });
    for (const bad of [null, [], "9.1.0", 3]) {
      expectRefused("pins-not-object", () => instantiateSite({ root, pins: bad }));
    }
  });
});

// ----------------------------------------------------------- root manifest

describe("instantiateSite: the root manifest", () => {
  const unsafe: Array<[string, SiteInstantiateRule, string | null, unknown?]> = [
    ["a missing manifest", "root-manifest-missing", null],
    ["unparseable JSON", "root-manifest-invalid", "{ not json"],
    ["a JSON array", "root-manifest-not-object", "[]\n"],
    ["JSON null", "root-manifest-not-object", "null\n"],
    ["a string workspaces value", "workspaces-unsupported", null, { name: "x", workspaces: "packages/*" }],
    ["a null workspaces value", "workspaces-unsupported", null, { name: "x", workspaces: null }],
    ["an array with a non-string", "workspaces-unsupported", null, { name: "x", workspaces: ["packages/*", 3] }],
    ["an object without packages", "workspaces-unsupported", null, { name: "x", workspaces: { nohoist: ["a"] } }],
    ["an object whose packages is not an array", "workspaces-unsupported", null, { name: "x", workspaces: { packages: "a" } }],
    ["an object whose packages holds a non-string", "workspaces-unsupported", null, { name: "x", workspaces: { packages: [{}] } }],
  ];

  for (const [label, rule, raw, manifest] of unsafe) {
    it(`refuses ${label} and leaves the root file byte-identical`, () => {
      if (raw !== null || manifest !== undefined) writeRoot(manifest, raw ?? undefined);
      const before = snapshot(root);
      const error = expectRefused(rule, () => instantiateSite({ root, pins: fullPins() }));
      expect(error.message).toContain("package.json");
      expect(snapshot(root)).toEqual(before);
      expect(existsSync(join(root, "apps"))).toBe(false);
      expect(leftovers(root)).toEqual([]);
    });
  }

  it("validates the manifest before touching the filesystem when the target is also unusable", () => {
    writeRoot({ name: "x", workspaces: "packages/*" });
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    const before = snapshot(root);
    const error = refusal(() => instantiateSite({ root, pins: fullPins() }));
    expect(["workspaces-unsupported", "target-not-empty"]).toContain(error.rule);
    expect(snapshot(root)).toEqual(before);
  });
});

// ----------------------------------------------------------- the copy

describe("instantiateSite: the copied tree", () => {
  it("is byte-for-byte the template except package.json, with exact pins applied", () => {
    writeRoot({ name: "example-project", private: true });
    const pins = fullPins();
    const result = instantiateSite({ root, pins });
    expect(result.siteDir).toBe("apps/site");

    const target = join(root, "apps", "site");
    const expected = snapshot(TEMPLATE_DIR, SKIPPED);
    const actual = snapshot(target);
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [path, bytes] of expected) {
      if (path === "package.json" || bytes === null) continue;
      expect(actual.get(path)?.equals(bytes), `${path} differs from the template`).toBe(true);
    }

    const copied = JSON.parse(actual.get("package.json")?.toString("utf8") ?? "{}") as Record<string, Record<string, string>>;
    const original = templateManifest();
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      expect(Object.keys(copied[section] ?? {})).toEqual(Object.keys(original[section] ?? {}));
      for (const [name, range] of Object.entries(copied[section] ?? {})) {
        expect(range).toBe(name.startsWith("@clossys/") ? pins[name] : original[section]?.[name]);
      }
    }
    // 2-space JSON with a trailing newline, like the template's own file.
    const text = actual.get("package.json")?.toString("utf8") ?? "";
    expect(text).toBe(`${JSON.stringify(copied, null, 2)}\n`);
    expect(Object.keys(copied)).toEqual(Object.keys(original));
  });

  it("skips node_modules and .next in the template and never copies a symlink", () => {
    writeRoot({ name: "example-project" });
    const template = join(work, "template");
    mkdirSync(join(template, "app"), { recursive: true });
    mkdirSync(join(template, "node_modules", "dep"), { recursive: true });
    mkdirSync(join(template, ".next"), { recursive: true });
    writeFileSync(join(template, "package.json"), `${JSON.stringify({ name: "site", dependencies: { "@clossys/writer": "^0.4.0" } }, null, 2)}\n`);
    writeFileSync(join(template, "app", "page.tsx"), "export default function Page() { return null; }\n");
    writeFileSync(join(template, "node_modules", "dep", "index.js"), "// dependency");
    writeFileSync(join(template, ".next", "cache"), "cache");
    symlinkSync(join(work, "nowhere"), join(template, "node_modules", "dangling"));
    instantiateSite({ root, pins: { "@clossys/writer": "1.0.0" }, templateDir: template });
    expect([...snapshot(join(root, "apps", "site")).keys()].sort()).toEqual(["app/", "app/page.tsx", "package.json"]);
  });

  it("refuses a run when the template itself holds a symlink, naming only its relative path", () => {
    writeRoot({ name: "example-project" });
    const template = join(work, "template");
    mkdirSync(join(template, "app"), { recursive: true });
    writeFileSync(join(template, "package.json"), `${JSON.stringify({ name: "site" })}\n`);
    writeFileSync(join(work, "real.txt"), "real");
    symlinkSync(join(work, "real.txt"), join(template, "app", "linked.txt"));
    const before = snapshot(root);
    const error = expectRefused("template-symlink", () => instantiateSite({ root, pins: {}, templateDir: template }));
    expect(error.message).toContain("app/linked.txt");
    expect(error.message).not.toContain(work);
    expect(snapshot(root)).toEqual(before);
  });

  it("passes the designer token-purity guard the template tests use, run over the copy", () => {
    // The same two functions guard 3 of site-template-guards.test.ts calls.
    // That file's range and custom-property guards are private to it, so they
    // are not re-run here; every file they read is asserted byte-identical to
    // the template above.
    writeRoot({ name: "example-project" });
    instantiateSite({ root, pins: fullPins() });
    const scan = scanStyleSources(join(root, "apps", "site"), {
      skipDirs: ["node_modules", ".git", "dist", "build", "coverage", ".next"],
    });
    expect(scan.filesScanned).toBeGreaterThan(0);
    const result = checkTokenPurity(scan.candidates, TOKENS, scan.filesScanned, scan.unchecked);
    expect(result.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(result.unchecked).toEqual([]);
  });
});

// ------------------------------------------------------------ workspaces

describe("instantiateSite: root workspaces", () => {
  const read = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;

  it("adds apps/* once when workspaces is absent, keeping existing keys in order", () => {
    writeRoot({ name: "example-project", private: true, scripts: { build: "echo ok" } });
    expect(instantiateSite({ root, pins: fullPins() }).workspacesAdded).toBe(true);
    const manifest = read();
    expect(manifest.workspaces).toEqual(["apps/*"]);
    expect(Object.keys(manifest)).toEqual(["name", "private", "scripts", "workspaces"]);
    expect(leftovers(root)).toEqual([]);
  });

  it("appends to an array and to the packages array, without duplicating", () => {
    writeRoot({ name: "example-project", workspaces: ["packages/*"] });
    instantiateSite({ root, pins: fullPins() });
    expect(read().workspaces).toEqual(["packages/*", "apps/*"]);

    rmSync(join(root, "apps"), { recursive: true });
    instantiateSite({ root, pins: fullPins() });
    expect(read().workspaces).toEqual(["packages/*", "apps/*"]);

    rmSync(join(root, "apps"), { recursive: true });
    writeRoot({ name: "example-project", workspaces: { packages: ["packages/*"], nohoist: ["x"] } });
    instantiateSite({ root, pins: fullPins() });
    expect(read().workspaces).toEqual({ packages: ["packages/*", "apps/*"], nohoist: ["x"] });
  });

  it("leaves the root manifest byte-identical when a pattern already covers the site", () => {
    for (const covering of ["apps/*", "./apps/*/", "apps/**", "apps/site"]) {
      rmSync(join(root, "apps"), { recursive: true, force: true });
      const raw = `{"name":"example-project","workspaces":[${JSON.stringify(covering)}]}`;
      writeRoot(undefined, raw);
      const result = instantiateSite({ root, pins: fullPins() });
      expect(result.workspacesAdded).toBe(false);
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe(raw);
    }
  });

  it("keeps the manifest's indentation and trailing newline when it adds the pattern", () => {
    writeRoot(undefined, `{\n\t"name": "example-project"\n}`);
    instantiateSite({ root, pins: fullPins() });
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(`{\n\t"name": "example-project",\n\t"workspaces": [\n\t\t"apps/*"\n\t]\n}`);
  });

  it("adds a pattern for a custom site directory's parent", () => {
    writeRoot({ name: "example-project" });
    instantiateSite({ root, pins: fullPins(), siteDir: "web/marketing" });
    expect(read().workspaces).toEqual(["web/*"]);
  });
});

// -------------------------------------------------------- atomic writes

describe("instantiateSite: a failed run leaves nothing behind", () => {
  it("rolls back the site directory and keeps the root manifest when the root write cannot happen", () => {
    const rootFile = writeRoot({ name: "example-project" });
    const before = readFileSync(rootFile);
    expect(() =>
      instantiateSite({
        root,
        pins: fullPins(),
        afterSiteInPlace: () => {
          throw new Error("simulated failure");
        },
      }),
    ).toThrow("simulated failure");
    expect(existsSync(join(root, "apps"))).toBe(false);
    expect(readFileSync(rootFile).equals(before)).toBe(true);
    expect(leftovers(root)).toEqual([]);
  });

  it("restores a pre-existing empty target directory on rollback", () => {
    writeRoot({ name: "example-project" });
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    expect(() =>
      instantiateSite({
        root,
        pins: fullPins(),
        afterSiteInPlace: () => {
          throw new Error("simulated failure");
        },
      }),
    ).toThrow();
    expect(readdirSync(join(root, "apps", "site"))).toEqual([]);
    expect(readdirSync(join(root, "apps"))).toEqual(["site"]);
  });

  it("leaves no temp directory next to a finished site", () => {
    writeRoot({ name: "example-project" });
    instantiateSite({ root, pins: fullPins() });
    expect(readdirSync(join(root, "apps"))).toEqual(["site"]);
    expect(lstatSync(join(root, "apps", "site")).isDirectory()).toBe(true);
  });
});

// --------------------------------------------------------------- messages

describe("instantiateSite: refusal messages", () => {
  it("name a rule and a relative path only, never a pin, the root path or file content", () => {
    writeRoot({ name: "secret-example-name", workspaces: "packages/*" });
    const error = refusal(() => instantiateSite({ root, pins: { "@clossys/writer": "^7.7.7" } }));
    for (const forbidden of [root, work, "secret-example-name", "7.7.7", tmpdir()]) {
      expect(error.message).not.toContain(forbidden);
    }
    expect(error.message).toMatch(/^[a-z-]+: [A-Za-z0-9_./-]+$/);
  });
});
