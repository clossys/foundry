// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM check script, no type declarations for the .mjs path
import { BASELINE_CEILING, CODES, ADAPTATION_KINDS, adaptationHash, baselineKey, checkElement, checkRegistryItem, engineFamily, loadBaseline, refVerbatimFindings, refVerbatimReport } from "../../scripts/check-ref-verbatim.mjs";
// @ts-expect-error plain ESM check script, no type declarations
import { cleanClasses, configFromComponents, mapImport, normalizeReference } from "../../scripts/ref-verbatim/normalize.mjs";
// @ts-expect-error plain ESM check script, no type declarations
import { replayDataFit, sourceHash } from "../../scripts/ref-verbatim/data-fit.mjs";
// @ts-expect-error plain ESM check script, no type declarations
import { ALLOWED, HUNK_CODES, diffSources, isEngineNeutral, tokenSwapAllowed } from "../../scripts/ref-verbatim/diff.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(pkg, path), "utf8");
const manifest = JSON.parse(read("references/manifest.json"));
const componentsPath = join(pkg, "ui/components.json");
const config = configFromComponents(JSON.parse(read("ui/components.json")));
const BUTTON_REF = "registry/aria-nova/ui/button.tsx";
const BUTTON = read("ui/src/components/ui/button.tsx");

type Hunk = { rule: string; ok: boolean; detail: string };
type Finding = { code: string; detail: string; file?: string };
const codes = (findings: Finding[]) => [...new Set(findings.map((f) => f.code))].sort();

const PRIMITIVES = "avatar badge breadcrumb button card checkbox command dialog dropdown-menu field input-group input label popover scroll-area select separator sheet sidebar skeleton switch table tabs textarea tooltip".split(" ");

describe("ref-verbatim normalizer (shadcn CLI 4.23.0 add-time rewrites)", () => {
  it("golden: all 25 aria-nova primitives normalize to the stock designer-ui files with zero hunks", () => {
    expect(PRIMITIVES).toHaveLength(25);
    for (const name of PRIMITIVES) {
      const ref = read(`references/shadcn-aria/${name}@4.23.0/registry/aria-nova/ui/${name}.tsx`);
      const normalized = normalizeReference(ref, `${name}.tsx`, config);
      const { hunks } = diffSources(normalized, `${name}.tsx`, read(`ui/src/components/ui/${name}.tsx`), `${name}.tsx`);
      expect(hunks.map((h: Hunk) => `${h.rule} ${h.detail}`), name).toEqual([]);
    }
  });

  it("replays the import alias, cn-* marker, font and icon rules", () => {
    const aliases = { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" };
    expect(mapImport("@/registry/aria-nova/ui/button", aliases)).toBe("@/components/ui/button");
    expect(mapImport("@/registry/aria-nova/lib/utils", aliases)).toBe("@/lib/utils");
    expect(mapImport("@/registry/aria-nova/hooks/use-mobile", aliases)).toBe("@/hooks/use-mobile");
    expect(mapImport("react", aliases)).toBe("react");
    expect(cleanClasses("cn-button flex cn-font-heading", config)).toBe("flex font-heading");
    expect(cleanClasses("cn-menu-target p-1", { ...config, menuColor: "inverted" })).toBe("dark p-1");
    const icon = normalizeReference(
      '"use client"\nimport { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"\nexport const X = () => <IconPlaceholder lucide="ChevronRightIcon" tabler="IconChevronRight" className="cn-x size-4" />\n',
      "x.tsx",
      config,
    );
    expect(icon).toContain('import { ChevronRightIcon } from "lucide-react"');
    expect(icon).toContain('<ChevronRightIcon className="size-4" />');
    expect(icon).not.toContain("use client");
    expect(() => normalizeReference('import { IconPlaceholder } from "./icon-placeholder"\nexport const X = () => <IconPlaceholder tabler="IconX" />\n', "x.tsx", config)).toThrow(/no lucide icon/);
  });
});

describe("ref-verbatim allowed-hunk grammar", () => {
  const ref = 'import { cn } from "@/lib/utils"\nexport function Hero({ className }: { className?: string }) {\n  return <section className={cn("bg-background p-8", className)}><h1 className="text-lg">Title</h1></section>\n}\n';
  const rules = (file: string, options = {}) => diffSources(ref, "hero.tsx", file, "hero.tsx", options).hunks.map((h: Hunk) => (h.ok ? h.rule : `!${h.rule}`));

  it("declares five allowed kinds and four hunk failure codes", () => {
    expect(ALLOWED).toEqual(["H-IMPORT", "H-TOKEN", "H-DATA", "H-PROPS", "H-LINK"]);
    expect(HUNK_CODES).toEqual(["REF-HUNK-CLASS", "REF-HUNK-STRUCTURE", "REF-HUNK-LOGIC", "REF-HUNK-TEXT"]);
    expect(CODES).toHaveLength(13);
    expect(CODES).toEqual(expect.arrayContaining(HUNK_CODES));
  });

  it("ignores formatting and accepts the allowed kinds", () => {
    expect(rules(ref.replace(/"/g, "'").replace("p-8\", className)", "p-8\",\n      className,\n    )"))).toEqual([]);
    // A changed import source reads as one import removed plus one added.
    expect(rules(ref.replace('"@/lib/utils"', '"cn"'))).toEqual(["H-IMPORT", "H-IMPORT"]);
    expect(rules(ref.replace("bg-background", "bg-surface"), { themeVars: ["--color-surface"] })).toEqual(["H-TOKEN"]);
    expect(rules(ref.replace("<h1 ", '<h1 id="hero-title" '))).toEqual(["H-PROPS"]);
    expect(rules(ref.replace(">Title<", ">{title}<"))).toEqual(["H-DATA"]);
    expect(tokenSwapAllowed("bg-background", "bg-(--brand)")).toBe(true);
    expect(tokenSwapAllowed("bg-background", "bg-red-500")).toBe(false);
    const link = 'import Link from "next/link"\nexport const A = () => <Link href="/">Home</Link>\n';
    const plain = diffSources(link, "a.tsx", 'export const A = () => <a href="/">Home</a>\n', "a.tsx").hunks;
    expect(plain.map((h: Hunk) => (h.ok ? h.rule : `!${h.rule}`)).sort()).toEqual(["H-IMPORT", "H-LINK"]);
  });

  it("fails class, structure, logic and text changes with their codes", () => {
    expect(rules(ref.replace("p-8", "p-8 shadow-xl"))).toEqual(["!REF-HUNK-CLASS"]);
    expect(rules(ref.replace("bg-background", "bg-red-500"))).toEqual(["!REF-HUNK-CLASS"]);
    expect(rules(ref.replace(/<h1 (.*?)<\/h1>/, "<h2 $1</h2>"))).toEqual(["!REF-HUNK-STRUCTURE"]);
    expect(rules(ref.replace("  return", "  console.log(1)\n  return"))).toEqual(["!REF-HUNK-LOGIC"]);
    expect(rules(ref.replace(">Title<", ">Welcome<"))).toEqual(["!REF-HUNK-TEXT"]);
  });

  it("calls code with no Radix, React Aria or Base UI import or engine prop engine-neutral", () => {
    expect(isEngineNeutral(ref, "hero.tsx")).toBe(true);
    expect(isEngineNeutral('import { Slot } from "radix-ui"\nexport const X = () => null\n', "x.tsx")).toBe(false);
    expect(isEngineNeutral('import { Button } from "react-aria-components"\nexport const X = () => <Button />\n', "x.tsx")).toBe(false);
    expect(isEngineNeutral("export const X = () => <div asChild />\n", "x.tsx")).toBe(false);
    expect(engineFamily("aria-nova")).toBe("aria");
    expect(engineFamily("radix-nova")).toBe("radix");
    expect(engineFamily("new-york")).toBe("radix");
  });
});

// ---- fixtures: a consumer library with element versions ----

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const treeHash = (files: { path: string; sha256: string }[]) =>
  `sha256:${sha([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.sha256}  ${f.path}\n`).join(""))}`;
const itemOf = (registry: string, name: string) => manifest.items.find((row: { registry: string; name: string }) => row.registry === registry && row.name === name);
const sourceOf = (registry: string, name: string, files?: Record<string, string>) => {
  const row = itemOf(registry, name);
  return { registry, item: name, version: row.version, hash: row.hash, ...(files ? { files } : {}) };
};

type Version = { slot: string; element: string; version?: number; lineage: Record<string, unknown>; files: Record<string, string>; pinned?: boolean; hash?: string };
function consumer(versions: Version[], { components = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ref-verbatim-"));
  const pins: Record<string, unknown> = {};
  for (const v of versions) {
    const version = v.version ?? 1;
    const dir = join(root, "library", v.slot, v.element, `v${version}`);
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(v.files)) writeFileSync(join(dir, file), text);
    const hash = v.hash ?? `sha256:${sha(JSON.stringify(v))}`;
    writeFileSync(join(dir, "element.json"), JSON.stringify({ schema: "clossys.element/1", id: v.element, slot: v.slot, version, hash, lineage: v.lineage, payload: Object.keys(v.files), reads: { copyKeys: [], themeVars: [] } }));
    if (v.pinned) pins[v.slot] = { element: v.element, version, hash, event: "e1" };
  }
  writeFileSync(join(root, "selection.json"), JSON.stringify({ schema: "clossys.selection/1", pins, history: [] }));
  if (components) writeFileSync(join(root, "components.json"), read("ui/components.json"));
  return root;
}

const button = (patch: Partial<Version> = {}): Version => ({
  slot: "components.button",
  element: "button",
  lineage: { mode: "verbatim", source: sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF }) },
  files: { "button.tsx": BUTTON },
  ...patch,
});
const gate = (root: string, spec: string, options = {}) => codes(refVerbatimFindings(root, spec, options));

// Synthetic byte-proof regression only: this does not qualify actual R6/R7 sources.
// Reuses the real application:component manifest shape without calling it a block.
function specimenExactPartFixture({ missingExport = false, relocate = false, external = false, missingExternalExport = false, bindings = false, missingBinding = false } = {}) {
  const referencesDir = mkdtempSync(join(tmpdir(), "ref-exact-specimen-"));
  const license = "Synthetic test-only license bytes\n";
  const licensePath = "fixture/LICENSE";
  const registry = "fixture-specimen";
  const upstream = `fixture:authored-specimen@${sha("authored specimen fixture revision").slice(0, 40)}`;
  const files = {
    "index.tsx": 'import { Figure } from "./Figure"\nimport { RecordTable } from "./RecordTable"\nexport function Specimen() { return <><Figure /><RecordTable /></> }\n',
    "RecordTable.tsx": 'export function RecordTable() { return <table><tbody><tr><td>Record</td></tr></tbody></table> }\n',
    "Figure.tsx": 'import { BlockViewerIframe } from "./BlockViewerIframe"\nexport function Figure() { return <figure><BlockViewerIframe /><figcaption>Preview</figcaption></figure> }\n',
    "BlockViewerIframe.tsx": 'export function BlockViewerIframe() { return <iframe title="Preview" src="/preview/test" /> }\n',
    "LICENSE": license,
  };
  if (missingBinding) files["BlockViewerIframe.tsx"] = "export function BlockViewerIframe() { return MissingHelper() }\n";
  if (bindings) files["RecordTable.tsx"] = 'export function RecordTable({ label = "Record" }: { label?: string } = {}) { return <table className="bg-surface"><tbody><tr><td>{label}</td></tr></tbody></table> }\n';
  if (external) files["BlockViewerIframe.tsx"] = 'import { Marker } from "fixture-dependency"\n' + files["BlockViewerIframe.tsx"];
  if (missingExport) files["Figure.tsx"] = files["Figure.tsx"].replace("{ BlockViewerIframe }", "{ MissingIframe as BlockViewerIframe }");
  const itemFiles = [Object.entries(files).slice(0, 2), Object.entries(files).slice(2, 4)];
  const proofs: Record<string, unknown> = {};
  const items = itemFiles.map((entries, reference) => {
    const name = reference === 0 ? "specimen-block" : "specimen-application";
    const dir = `${registry}/${name}@fixture-1`;
    const rows = entries.map(([path, text]) => {
      const prefix = "// authored fixture prefix: π\n" + (missingBinding && path === "BlockViewerIframe.tsx" ? "function MissingHelper() { return null }\n" : "");
      const original = relocate && path === "index.tsx" ? text.replace('"./Figure"', '"@/registry/aria-nova/components/Figure"')
        : bindings && path === "RecordTable.tsx" ? text.replace("bg-surface", "bg-background").replace("{label}</td>", "Record</td>") : text;
      const whole = `${prefix}${original}// authored fixture suffix\n`;
      const importStart = original.indexOf("@/registry/aria-nova/components/Figure");
      const edits: { kind: string; start: number; endExclusive: number; from: string; to: string }[] = [];
      const edit = (kind: string, at: number, from: string, to: string) => edits.push({ kind, start: Buffer.byteLength(original.slice(0, at)), endExclusive: Buffer.byteLength(original.slice(0, at) + from), from, to });
      if (importStart >= 0) edit("import", importStart, "@/registry/aria-nova/components/Figure", "./Figure");
      if (bindings && path === "RecordTable.tsx") {
        edit("token", original.indexOf("bg-background"), "bg-background", "bg-surface");
        edit("data", original.lastIndexOf("Record"), "Record", "{label}");
      }
      mkdirSync(dirname(join(referencesDir, dir, path)), { recursive: true });
      writeFileSync(join(referencesDir, dir, path), whole);
      proofs[path] = {
        sha256: sha(text),
        segments: [{
          start: 0, endExclusive: Buffer.byteLength(text),
          source: {
            reference, path, upstream, fileSha256: sha(whole),
            start: Buffer.byteLength(prefix), endExclusive: Buffer.byteLength(prefix + original),
            sha256: sha(original), license: { path: licensePath, sha256: sha(license), payloadPath: "LICENSE" },
          },
          edits,
        }],
      };
      return { path, sha256: sha(whole), bytes: Buffer.byteLength(whole), origin: "fixture" };
    });
    return {
      registry, name, version: "fixture-1", dir,
      type: reference === 0 ? "registry:block" : "application:component",
      sourceUrl: "https://example.invalid/authored-fixture", license: "LicenseRef-TestFixture",
      direct: true, slots: [], hash: treeHash(rows), files: rows,
    };
  });
  mkdirSync(dirname(join(referencesDir, licensePath)), { recursive: true });
  writeFileSync(join(referencesDir, licensePath), license);
  const fixtureManifest = {
    ...manifest,
    registries: { [registry]: { namespace: "@fixture", source: "https://example.invalid/{name}", version: "fixture-1", upstream, style: "aria-nova", license: "LicenseRef-TestFixture", licenseFiles: [licensePath] } },
    licenses: [{ path: licensePath, sha256: sha(license), bytes: Buffer.byteLength(license), sourceUrl: "https://example.invalid/LICENSE" }],
    items,
  };
  const refs = items.map(item => ({ registry, item: item.name, version: item.version, hash: item.hash }));
  const exactParts = {
    schema: "ref-exact-parts/1", files: proofs,
    payload: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha(text)])),
    closure: {
      roots: ["index.tsx"],
      imports: [
        { file: "index.tsx", specifier: "./Figure", target: { kind: "payload", path: "Figure.tsx" } },
        { file: "index.tsx", specifier: "./RecordTable", target: { kind: "payload", path: "RecordTable.tsx" } },
        { file: "Figure.tsx", specifier: "./BlockViewerIframe", target: { kind: "payload", path: "BlockViewerIframe.tsx" } },
      ],
    },
  };
  const root = consumer([{
    slot: "sections.fixture-specimen", element: "fixture-specimen", files,
    hash: treeHash(Object.entries(files).map(([path, text]) => ({ path, sha256: sha(text) }))),
    lineage: { mode: "verbatim", source: refs[0], parts: [refs[1]], exactParts },
  }]);
  const dir = join(root, "library/sections.fixture-specimen/fixture-specimen/v1");
  const recordPath = join(dir, "element.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (relocate) {
    const components = JSON.parse(readFileSync(join(root, "components.json"), "utf8"));
    components.aliases.components = ".";
    writeFileSync(join(root, "components.json"), JSON.stringify(components));
  }
  record.deps = { npm: {}, elements: [] };
  if (bindings) record.reads.themeVars = ["--color-surface"];
  const dependency = external ? {
    installed: join(root, "node_modules/fixture-dependency"),
    vendored: join(referencesDir, "fixture/dependency@1.0.0"),
  } : undefined;
  if (dependency) {
    const packageFiles = {
      "package.json": JSON.stringify({ name: "fixture-dependency", version: "1.0.0", type: "module", license: "LicenseRef-TestFixture", exports: { ".": "./index.js" } }),
      "index.js": `export function ${missingExternalExport ? "Other" : "Marker"}() { return null }\n`,
      "LICENSE": license,
    };
    mkdirSync(dependency.installed, { recursive: true });
    mkdirSync(dependency.vendored, { recursive: true });
    for (const [file, content] of Object.entries(packageFiles)) {
      writeFileSync(join(dependency.installed, file), content);
      writeFileSync(join(dependency.vendored, file), content);
    }
    const rows = Object.entries(packageFiles).map(([path, content]) => ({ path, sha256: sha(content), bytes: Buffer.byteLength(content), origin: "fixture" }));
    const hash = treeHash(rows);
    fixtureManifest.items.push({ registry, name: "fixture-dependency", version: "1.0.0", dir: "fixture/dependency@1.0.0", type: "application:component", sourceUrl: "https://example.invalid/authored-dependency", license: "LicenseRef-TestFixture", direct: true, slots: [], hash, files: rows });
    record.deps.npm["fixture-dependency"] = "1.0.0";
    record.lineage.exactParts.closure.imports.push({ file: "BlockViewerIframe.tsx", specifier: "fixture-dependency", target: { kind: "npm", package: "fixture-dependency", version: "1.0.0", entry: "index.js", hash } });
  }
  const save = (rehash = false) => {
    if (rehash) {
      record.hash = treeHash(record.payload.map((file: string) => ({ path: file, sha256: sha(readFileSync(join(dir, file), "utf8")) })));
      for (const file of record.payload) {
        record.lineage.exactParts.payload[file] = sha(readFileSync(join(dir, file), "utf8"));
        if (record.lineage.exactParts.files[file]) record.lineage.exactParts.files[file].sha256 = record.lineage.exactParts.payload[file];
      }
    }
    writeFileSync(recordPath, JSON.stringify(record));
  };
  save();
  return { root, dir, record, save, dependency, options: { manifest: fixtureManifest, referencesDir } };
}

const specimenGate = (fixture: ReturnType<typeof specimenExactPartFixture>) => gate(fixture.root, "sections.fixture-specimen/fixture-specimen/v1", fixture.options);

describe("specimen exact-part graph and bundled helper", () => {
  it("checks one real-shaped block/application graph with every emitted code byte and bundled license", () => {
    expect(specimenGate(specimenExactPartFixture())).toEqual([]);
    expect(specimenGate(specimenExactPartFixture({ relocate: true }))).toEqual([]);
    expect(specimenGate(specimenExactPartFixture({ bindings: true }))).toEqual([]);
  });

  it("resolves an installed dependency only against its complete trusted vendored package bytes", () => {
    expect(specimenGate(specimenExactPartFixture({ external: true }))).toEqual([]);
    expect(specimenGate(specimenExactPartFixture({ external: true, missingExternalExport: true }))).toContain("REF-PART-CLOSURE");
  });

  it("rejects changed dependency/code/license bytes even when attacker recomputes the dependency proof digest", () => {
    for (const mutation of ["code", "license", "version", "vendored", "undeclared", "private-entry"]) {
      const fixture = specimenExactPartFixture({ external: true });
      const target = fixture.record.lineage.exactParts.closure.imports.at(-1).target;
      const packageDir = fixture.dependency!.installed;
      if (mutation === "code" || mutation === "license") {
        const file = mutation === "code" ? "index.js" : "LICENSE";
        writeFileSync(join(packageDir, file), readFileSync(join(packageDir, file), "utf8") + "changed\n");
        target.hash = treeHash(["package.json", "index.js", "LICENSE"].map(path => ({ path, sha256: sha(readFileSync(join(packageDir, path), "utf8")) })));
      } else if (mutation === "vendored") {
        const path = join(fixture.dependency!.vendored, "index.js");
        writeFileSync(path, readFileSync(path, "utf8") + "changed\n");
      } else if (mutation === "version") target.version = "1.0.1";
      else if (mutation === "undeclared") delete fixture.record.deps.npm["fixture-dependency"];
      else target.entry = "private.js";
      fixture.save(true);
      expect(specimenGate(fixture), mutation).toContain("REF-PART-CLOSURE");
    }
  });

  it("rejects arbitrary import retargeting even when the measured target exports the same symbol", () => {
    const fixture = specimenExactPartFixture({ relocate: true });
    const components = JSON.parse(readFileSync(join(fixture.root, "components.json"), "utf8"));
    components.aliases.components = "./other-native-target";
    writeFileSync(join(fixture.root, "components.json"), JSON.stringify(components));
    // The proof still routes to the existing Figure with unchanged exports/hashes.
    expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
  });

  it("rejects an invented module assembled from individually hashed upstream characters", () => {
    const fixture = specimenExactPartFixture();
    const proof = fixture.record.lineage.exactParts.files["index.tsx"];
    const bound = proof.segments[0].source;
    const whole = readFileSync(join(fixture.options.referencesDir, fixture.options.manifest.items[0]!.dir, "index.tsx"));
    const invented = Buffer.from("export function foo() { return null }\n");
    proof.segments = [...invented].map((byte, index) => {
      const start = whole.indexOf(Buffer.from([byte]));
      expect(start).toBeGreaterThanOrEqual(0);
      return { start: index, endExclusive: index + 1, edits: [], source: { ...bound, start, endExclusive: start + 1, sha256: createHash("sha256").update(Buffer.from([byte])).digest("hex") } };
    });
    writeFileSync(join(fixture.dir, "index.tsx"), invented);
    fixture.save(true);
    expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
  });

  it("rejects altered code even after attacker recomputes all emitted and payload hashes", () => {
    for (const file of ["index.tsx", "BlockViewerIframe.tsx"]) {
      const fixture = specimenExactPartFixture();
      writeFileSync(join(fixture.dir, file), readFileSync(join(fixture.dir, file), "utf8") + "console.log(1)\n");
      fixture.save(true);
      expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
    }
  });

  it("rejects an omitted bundled iframe despite ambient presence and recomputed remaining hashes", () => {
    const fixture = specimenExactPartFixture();
    fixture.record.payload = fixture.record.payload.filter((file: string) => file !== "BlockViewerIframe.tsx");
    delete fixture.record.lineage.exactParts.payload["BlockViewerIframe.tsx"];
    delete fixture.record.lineage.exactParts.files["BlockViewerIframe.tsx"];
    fixture.save(true);
    expect(specimenGate(fixture)).toContain("REF-PART-CLOSURE");
  });

  it("rejects byte gaps, range alteration and offsets inside a UTF-8 codepoint", () => {
    for (const mutation of ["gap", "range", "utf8"]) {
      const fixture = specimenExactPartFixture();
      const segment = fixture.record.lineage.exactParts.files["index.tsx"].segments[0];
      const upstream = readFileSync(join(fixture.options.referencesDir, fixture.options.manifest.items[0]!.dir, "index.tsx"));
      if (mutation === "gap") segment.start = 1;
      else {
        segment.source.start = mutation === "utf8" ? upstream.indexOf(Buffer.from("π")) + 1 : segment.source.start + 1;
        segment.source.sha256 = createHash("sha256").update(upstream.subarray(segment.source.start, segment.source.endExclusive)).digest("hex");
      }
      fixture.save(true);
      expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
    }
  });

  it("rejects whole-source changes outside the range and either source or bundled license mutation", () => {
    for (const mutation of ["outside", "upstream-license", "payload-license"]) {
      const fixture = specimenExactPartFixture();
      const file = mutation === "outside" ? join(fixture.options.referencesDir, fixture.options.manifest.items[0]!.dir, "index.tsx")
        : mutation === "upstream-license" ? join(fixture.options.referencesDir, "fixture/LICENSE") : join(fixture.dir, "LICENSE");
      writeFileSync(file, readFileSync(file, "utf8") + "changed\n");
      fixture.save(true);
      expect(specimenGate(fixture)).toContain("REF-NOT-VENDORED");
    }
  });

  it("rejects unknown proof/adaptation fields and arbitrary code disguised as data", () => {
    for (const mutation of ["field", "unknown-edit", "data-logic"]) {
      const fixture = specimenExactPartFixture();
      const proof = fixture.record.lineage.exactParts;
      if (mutation === "field") proof.allow = true;
      else proof.files["BlockViewerIframe.tsx"].segments[0].edits = [{ kind: mutation === "unknown-edit" ? "arbitrary" : "data", start: 0, endExclusive: 6, from: "export", to: "eval(1)" }];
      fixture.save(true);
      expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
    }
  });

  it("rejects a nonsemantic token or executable data expression after exact output hashes are recomputed", () => {
    for (const mutation of ["token", "data"]) {
      const fixture = specimenExactPartFixture({ bindings: true });
      const edits = fixture.record.lineage.exactParts.files["RecordTable.tsx"].segments[0].edits;
      const changed = edits.find((edit: { kind: string }) => edit.kind === mutation);
      const before = changed.to;
      changed.to = mutation === "token" ? "bg-red-500" : "{label()}";
      const path = join(fixture.dir, "RecordTable.tsx");
      writeFileSync(path, readFileSync(path, "utf8").replace(before, changed.to));
      fixture.record.lineage.exactParts.files["RecordTable.tsx"].segments[0].endExclusive = Buffer.byteLength(readFileSync(path, "utf8"));
      fixture.save(true);
      expect(specimenGate(fixture)).toContain("REF-PART-PROOF");
    }
  });

  it("checks measured edges and actual exported values, preserving the primitive prohibition", () => {
    expect(specimenGate(specimenExactPartFixture({ missingExport: true }))).toContain("REF-PART-CLOSURE");
    expect(specimenGate(specimenExactPartFixture({ missingBinding: true }))).toContain("REF-PART-CLOSURE");
    const absentEdge = specimenExactPartFixture();
    absentEdge.record.lineage.exactParts.closure.imports.pop(); absentEdge.save(true);
    expect(specimenGate(absentEdge)).toContain("REF-PART-CLOSURE");
    const primitive = specimenExactPartFixture();
    primitive.options.manifest.items[1]!.type = "registry:ui";
    expect(specimenGate(primitive)).toContain("REF-PRIMITIVE-AS-REF");
  });
});

describe("ref-verbatim pin gate (strict, one element version)", () => {
  it("passes a stock aria-nova primitive copied by the CLI", () => {
    const root = consumer([button()]);
    const checked = checkElement(root, "components.button/button/v1", { strict: true });
    expect(checked.findings).toEqual([]);
    expect(checked.status).toBe("pass");
    expect(checked.files).toMatchObject([{ file: "button.tsx", status: "pass", mapping: "recorded" }]);
  });

  it("mutation 1: one extra class on a verbatim file fails REF-HUNK-CLASS", () => {
    const root = consumer([button({ files: { "button.tsx": BUTTON.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl") } })]);
    const findings = refVerbatimFindings(root, "components.button/button/v1");
    expect(codes(findings)).toEqual(["REF-HUNK-CLASS"]);
    expect(findings[0]).toMatchObject({ file: "button.tsx", reference: BUTTON_REF });
  });

  it("mutation 2: a primitive cited as a section's reference fails REF-PRIMITIVE-AS-REF", () => {
    const card = read("ui/src/components/ui/card.tsx");
    const root = consumer([{ slot: "sections.hero", element: "hero", lineage: { mode: "verbatim", source: sourceOf("shadcn-aria", "card", { "card.tsx": "registry/aria-nova/ui/card.tsx" }) }, files: { "card.tsx": card } }]);
    expect(gate(root, "sections.hero/hero/v1")).toEqual(["REF-PRIMITIVE-AS-REF"]);
  });

  it("fails every other gate code", () => {
    const original = consumer([{ slot: "sections.hero", element: "hero", lineage: { mode: "original" }, files: { "hero.tsx": "export const Hero = () => null\n" } }]);
    expect(gate(original, "sections.hero/hero/v1")).toEqual(["REF-NO-SOURCE"]);
    expect(gate(original, "sections.hero/hero/v2")).toEqual(["REF-NO-SOURCE"]);

    const staleHash = consumer([button({ lineage: { mode: "verbatim", source: { ...sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF }), hash: `sha256:${"1".repeat(64)}` } } })]);
    expect(gate(staleHash, "components.button/button/v1")).toEqual(["REF-NOT-VENDORED"]);
    const unknown = consumer([button({ lineage: { mode: "verbatim", source: { registry: "shadcn-aria", item: "no-such-item", version: "4.23.0" } } })]);
    expect(gate(unknown, "components.button/button/v1")).toEqual(["REF-NOT-VENDORED"]);

    const radix = consumer([button({ lineage: { mode: "verbatim", source: sourceOf("shadcn", "button", { "button.tsx": "registry/radix-nova/ui/button.tsx" }) } })]);
    expect(gate(radix, "components.button/button/v1")).toContain("REF-FLAVOR");
    const noComponents = consumer([button()], { components: false });
    expect(gate(noComponents, "components.button/button/v1", { components: join(tmpdir(), "missing-components.json") })).toEqual(["REF-FLAVOR"]);

    const unmapped = consumer([button({ lineage: { mode: "verbatim", source: sourceOf("shadcn-aria", "button") } })]);
    expect(gate(unmapped, "components.button/button/v1")).toEqual(["REF-FILE-UNMAPPED"]);
    const wrongPath = consumer([button({ lineage: { mode: "verbatim", source: sourceOf("shadcn-aria", "button", { "button.tsx": "registry/aria-nova/ui/nope.tsx" }) } })]);
    expect(gate(wrongPath, "components.button/button/v1")).toEqual(["REF-FILE-UNMAPPED"]);

    const structure = consumer([button({ files: { "button.tsx": BUTTON.replace("(\n    <ButtonPrimitive\n", "(\n    <div\n") } })]);
    expect(readFileSync(join(structure, "library/components.button/button/v1/button.tsx"), "utf8")).not.toBe(BUTTON);
    expect(gate(structure, "components.button/button/v1")).toContain("REF-HUNK-STRUCTURE");
    const logic = consumer([button({ files: { "button.tsx": `${BUTTON}\nconsole.log("x")\n` } })]);
    expect(gate(logic, "components.button/button/v1")).toEqual(["REF-HUNK-LOGIC"]);
  });

  it("a non-strict run infers a unique basename mapping and says so; the gate does not", () => {
    const root = consumer([button({ lineage: { mode: "verbatim", source: sourceOf("shadcn-aria", "button") } })]);
    expect(checkElement(root, "components.button/button/v1").files).toMatchObject([{ file: "button.tsx", status: "pass", mapping: "inferred" }]);
  });

  it("exempts consumer-asset slots and skips versions without code", () => {
    const root = consumer([
      { slot: "components.logo", element: "logo", lineage: { mode: "original" }, files: { "logo.tsx": "export const Logo = () => null\n" } },
      { slot: "themes.theme", element: "theme", lineage: { mode: "customized", source: sourceOf("shadcn", "neutral") }, files: { "theme.css": ":root{}\n" } },
    ]);
    expect(checkElement(root, "components.logo/logo/v1").status).toBe("exempt");
    expect(checkElement(root, "themes.theme/theme/v1").status).toBe("n/a");
  });
});

describe("ref-verbatim flavor: engine-neutral references", () => {
  // A registry that publishes no aria-nova or radix-nova style (reui, assistant-ui):
  // its code is accepted when it names no headless engine, against its own registry JSON.
  function fixtureRegistry(files: Record<string, string>, style?: string) {
    const referencesDir = mkdtempSync(join(tmpdir(), "ref-verbatim-refs-"));
    const dir = "fixture-ui/widget@1.0.0";
    const rows = Object.entries({ "widget.json": "{}\n", ...files }).map(([path, text]) => {
      mkdirSync(dirname(join(referencesDir, dir, path)), { recursive: true });
      writeFileSync(join(referencesDir, dir, path), text);
      return { path, sha256: sha(text), bytes: Buffer.byteLength(text), origin: "fixture" };
    });
    const item = { registry: "fixture-ui", name: "widget", version: "1.0.0", dir, type: "registry:block", sourceUrl: "https://example.invalid/widget.json", license: "MIT", direct: true, slots: [], hash: treeHash(rows), files: rows };
    const fixture = { ...manifest, registries: { ...manifest.registries, "fixture-ui": { namespace: "@fixture-ui", source: "https://example.invalid/{name}.json", version: "1.0.0", license: "MIT", licenseFiles: [], ...(style ? { style } : {}) } }, items: [item] };
    return { referencesDir, manifest: fixture, source: { registry: "fixture-ui", item: "widget", version: "1.0.0", hash: item.hash } };
  }
  const NEUTRAL = 'import { cn } from "@/lib/utils"\nexport function Widget({ className }: { className?: string }) {\n  return <div className={cn("flex gap-2", className)}>Widget</div>\n}\n';

  it("accepts engine-neutral code from a registry with no aria style for an aria consumer", () => {
    for (const style of [undefined, "radix-nova"]) {
      const reg = fixtureRegistry({ "widget.tsx": NEUTRAL }, style);
      const root = consumer([{ slot: "sections.widget", element: "widget", lineage: { mode: "verbatim", source: { ...reg.source, files: { "widget.tsx": "widget.tsx" } } }, files: { "widget.tsx": NEUTRAL } }]);
      expect(refVerbatimFindings(root, "sections.widget/widget/v1", reg), String(style)).toEqual([]);
    }
  });

  it("still fails REF-FLAVOR when that registry's code imports a headless engine", () => {
    const radixy = `import { Slot } from "radix-ui"\n${NEUTRAL}`;
    const reg = fixtureRegistry({ "widget.tsx": radixy });
    const root = consumer([{ slot: "sections.widget", element: "widget", lineage: { mode: "verbatim", source: { ...reg.source, files: { "widget.tsx": "widget.tsx" } } }, files: { "widget.tsx": radixy } }]);
    expect(gate(root, "sections.widget/widget/v1", reg)).toEqual(["REF-FLAVOR"]);
  });

  it("fails REF-NORMALIZE when the reference cannot be normalized", () => {
    const broken = 'import { IconPlaceholder } from "./icon-placeholder"\nexport const Widget = () => <IconPlaceholder tabler="IconX" />\n';
    const reg = fixtureRegistry({ "widget.tsx": broken });
    const root = consumer([{ slot: "sections.widget", element: "widget", lineage: { mode: "verbatim", source: { ...reg.source, files: { "widget.tsx": "widget.tsx" } } }, files: { "widget.tsx": broken } }]);
    expect(gate(root, "sections.widget/widget/v1", reg)).toEqual(["REF-NORMALIZE"]);
  });
});

describe("ref-verbatim baseline (shrink only)", () => {
  const baselinePath = join(pkg, "scripts/ref-verbatim/baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

  it("holds only ceiling rows, and the ceiling is frozen at the pins that failed when the gate landed", () => {
    expect(BASELINE_CEILING).toHaveLength(28);
    expect(Object.isFrozen(BASELINE_CEILING)).toBe(true);
    expect(new Set(BASELINE_CEILING).size).toBe(BASELINE_CEILING.length);
    expect(loadBaseline().findings).toEqual([]);
    expect(baseline.rows.length).toBeLessThanOrEqual(BASELINE_CEILING.length);
    for (const row of baseline.rows) expect(BASELINE_CEILING).toContain(baselineKey(row));
  });

  it("release qualification refuses any remaining baseline row, including stale rows", () => {
    const root = consumer([]);
    const command = [join(pkg, "scripts/check-ref-verbatim.mjs"), "--root", root, "--pinned", "--release", "--report", join(root, "report.json")];
    const result = spawnSync(process.execPath, command, { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release requires an empty ref-verbatim baseline");
  });

  it("classifies every remaining baseline row as an explicit reference NEED, without an exemption", () => {
    const needs = JSON.parse(read("scripts/ref-verbatim/owner-needs.json"));
    expect(new Set(needs.rows.map(baselineKey)).size).toBe(needs.rows.length);
    for (const row of baseline.rows) {
      const need = needs.rows.find((item: any) => baselineKey(item) === baselineKey(row));
      expect(need).toMatchObject({ status: "NEED", decision: "reference-required" });
      expect(need.reason.trim()).not.toBe("");
      expect(need.candidates.length).toBeGreaterThanOrEqual(2);
      for (const candidate of need.candidates) {
        const item = itemOf(candidate.registry, candidate.item);
        expect(candidate.version).toBe(item.version);
        expect(candidate.hash).toBe(item.hash);
        expect(item.files.map((file: any) => file.path)).toContain(candidate.path);
      }
    }
  });

  it("mutation 3: adding a baseline entry fails REF-BASELINE", () => {
    const dir = mkdtempSync(join(tmpdir(), "ref-verbatim-baseline-"));
    const added = join(dir, "baseline.json");
    const row = { slot: "sections.new", element: "new", version: 1, hash: `sha256:${"2".repeat(64)}`, codes: ["REF-HUNK-CLASS"] };
    writeFileSync(added, JSON.stringify({ ...baseline, rows: [...baseline.rows, row] }));
    expect(loadBaseline({ baselinePath: added }).findings).toMatchObject([{ code: "REF-BASELINE", element: "sections.new/new@v1" }]);
    const root = consumer([]);
    expect(codes(refVerbatimReport(root, { baselinePath: added }).findings)).toEqual(["REF-BASELINE"]);
  });

  it("a baselined pin blocks the report and the pin gate", () => {
    const failing = button({ pinned: true, hash: `sha256:${"3".repeat(64)}`, files: { "button.tsx": BUTTON.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl") } });
    const root = consumer([failing]);
    const dir = mkdtempSync(join(tmpdir(), "ref-verbatim-baseline-"));
    const path = join(dir, "baseline.json");
    const row = { slot: "components.button", element: "button", version: 1, hash: failing.hash! };
    writeFileSync(path, JSON.stringify({ rows: [row] }));
    const report = refVerbatimReport(root, { baselinePath: path, ceiling: [baselineKey(row)] });
    expect(codes(report.findings)).toEqual(["REF-HUNK-CLASS"]);
    expect(report.elements.map((e: { status: string }) => e.status)).toEqual(["baselined"]);
    expect(gate(root, "components.button/button/v1")).toEqual(["REF-HUNK-CLASS"]);
    const unlisted = refVerbatimReport(root, { baselinePath: path });
    expect(codes(unlisted.findings)).toEqual(["REF-BASELINE", "REF-HUNK-CLASS"]);
  });
});


describe("recorded adaptations", () => {
  it("requires a reason and exact content binding for an otherwise allowed token swap", () => {
    const file = BUTTON.replace("bg-primary", "bg-(--brand)");
    const normalized = normalizeReference(read(`references/shadcn-aria/button@4.23.0/${BUTTON_REF}`), BUTTON_REF, config);
    const hunks = diffSources(normalized, BUTTON_REF, file, "button.tsx", { themeVars: [] }).hunks;
    expect(hunks.length).toBeGreaterThan(0);
    const adaptations = hunks.map((h: Hunk) => ({ kind: "token-mapping", file: "button.tsx", reason: "Bind the consumer brand token", hash: adaptationHash(h, normalized, file) }));
    const record = { mode: "customized", source: sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF }) };
    const missing = consumer([button({ lineage: record, files: { "button.tsx": file } })]);
    expect(gate(missing, "components.button/button/v1")).toEqual(["REF-ADAPTATION"]);
    const recorded = consumer([button({ lineage: { ...record, adaptations }, files: { "button.tsx": file } })]);
    expect(gate(recorded, "components.button/button/v1")).toEqual([]);
    const forged = consumer([button({ lineage: { ...record, adaptations: adaptations.map((a: object) => ({ ...a, reason: " " })) }, files: { "button.tsx": file } })]);
    expect(gate(forged, "components.button/button/v1")).toContain("REF-ADAPTATION");
    const edited = consumer([button({ lineage: { ...record, adaptations }, files: { "button.tsx": file.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl") } })]);
    expect(gate(edited, "components.button/button/v1")).toContain("REF-HUNK-CLASS");
    expect(ADAPTATION_KINDS).toEqual(["import-paths", "token-mapping", "data-binding", "data-fit", "slot-bound-copy", "slot-bound-identity"]);
  });
});


describe("import-path adaptations", () => {
  it("permits a recorded path move while refusing a new side-effect import", () => {
    const stock = read(`references/shadcn-aria/button@4.23.0/${BUTTON_REF}`);
    const normalized = normalizeReference(stock, BUTTON_REF, config);
    for (const [candidate, allowed] of [[BUTTON.replace("@/lib/utils", "./utils"), true], [`import "./side-effect";\n${BUTTON}`, false]] as const) {
      const hunks = diffSources(normalized, BUTTON_REF, candidate, "button.tsx").hunks;
      const adaptations = hunks.map((h: Hunk) => ({ kind: "import-paths", file: "button.tsx", reason: "Resolve the local import path", hash: adaptationHash(h, normalized, candidate) }));
      const root = consumer([button({ lineage: { mode: "customized", source: sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF }), adaptations }, files: { "button.tsx": candidate } })]);
      expect(gate(root, "components.button/button/v1")).toEqual(allowed ? [] : ["REF-ADAPTATION"]);
    }
  });
});

describe("every pinned source representation", () => {
  it("checks code embedded in a legacy registry JSON payload", () => {
    const item = { name: "button", type: "registry:ui", files: [{ path: "button.tsx", content: BUTTON }] };
    const lineage = { mode: "customized", source: sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF }) };
    const root = consumer([button({ lineage, files: { "button.json": JSON.stringify(item) } })]);
    expect(gate(root, "components.button/button/v1")).toEqual([]);
    item.files[0].content = BUTTON.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl");
    writeFileSync(join(root, "library/components.button/button/v1/button.json"), JSON.stringify(item));
    expect(gate(root, "components.button/button/v1")).toEqual(["REF-HUNK-CLASS"]);
  });
  it("checks modern Designer pins independently of the legacy selection store", () => {
    const root = consumer([]);
    const item = { name: "button", type: "registry:ui", files: [{ path: "button.tsx", content: BUTTON }], meta: {
      source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] }, refVerbatim: { files: { "button.tsx": BUTTON_REF } },
    } };
    expect(checkRegistryItem(root, "components.button", item, { strict: true }).findings).toEqual([]);
    const dir = join(root, "agents/designer/components/actions/components.button");
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), JSON.stringify({ id: "components.button" }));
    const save = () => {
      const bytes = JSON.stringify(item);
      writeFileSync(join(dir, "candidates/button-v1.json"), bytes);
      writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: "button-v1.json", sha256: sha(bytes) }));
    };
    save();
    expect(refVerbatimReport(root).findings).toEqual([]);
    item.files[0].content = BUTTON.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl");
    save();
    expect(codes(refVerbatimReport(root).findings)).toEqual(["REF-HUNK-CLASS"]);
  });
});


describe("finite data-fit and additional source parts", () => {
  it("replays the exact mirrored source and still refuses extra classes or stale byte proof", () => {
    const file = "edge.tsx";
    const path = "registry/aria-nova/blocks/sidebar-15/page.tsx";
    const raw = read(`references/shadcn-aria/sidebar-15@4.23.0/${path}`);
    const normalized = normalizeReference(raw, path, config);
    const source = sourceOf("shadcn-aria", "sidebar-15", { [file]: path });
    const adaptation = { kind: "data-fit", file, reason: "Mirror the same stock edge control", operation: "sidebar-mirrored-edge", sourceHash: sourceHash(raw), bindings: { side: "right" } };
    const text = replayDataFit(normalized, path, adaptation, { raw, source, sources: [] });
    const make = (candidate: string, proof = adaptation) => consumer([{ slot: "frames.edge", element: "edge", lineage: { mode: "customized", source, adaptations: [proof] }, files: { [file]: candidate } }]);
    expect(gate(make(text), "frames.edge/edge/v1")).toEqual([]);
    expect(gate(make(text.replace("data-[orientation=vertical]:h-4", "data-[orientation=vertical]:h-4 gap-8")), "frames.edge/edge/v1")).toContain("REF-HUNK-CLASS");
    expect(gate(make(text, { ...adaptation, sourceHash: `sha256:${"0".repeat(64)}` }), "frames.edge/edge/v1")).toContain("REF-NORMALIZE");
  });
  it("verifies each additional source part independently and refuses overlapping mappings", () => {
    const path = "registry/aria-nova/blocks/sidebar-15/page.tsx";
    const text = normalizeReference(read(`references/shadcn-aria/sidebar-15@4.23.0/${path}`), path, config);
    const primary = sourceOf("shadcn-aria", "sidebar-15", { "index.tsx": path });
    const part = sourceOf("shadcn-aria", "button", { "button.tsx": BUTTON_REF });
    const make = (parts: any[]) => consumer([{ slot: "frames.example", element: "example", lineage: { mode: "verbatim", source: primary, parts }, files: { "index.tsx": text, "button.tsx": BUTTON } }]);
    expect(gate(make([part]), "frames.example/example/v1")).toEqual([]);
    expect(gate(make([{ ...part, hash: `sha256:${"0".repeat(64)}` }]), "frames.example/example/v1")).toContain("REF-NOT-VENDORED");
    expect(gate(make([part, part]), "frames.example/example/v1")).toContain("REF-FILE-UNMAPPED");
  });
});
