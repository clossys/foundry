import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(publisherRoot, "../..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "foundry-publisher-react-server-"));
const consumerRoot = join(fixtureRoot, "consumer");
const packedRoot = join(fixtureRoot, "packed");

function packPackage(packageRoot: string, destinationRoot = packedRoot) {
  mkdirSync(destinationRoot, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destinationRoot],
    { cwd: packageRoot, encoding: "utf8", timeout: 30_000 },
  );
  const [{ filename }] = JSON.parse(output) as Array<{ filename: string }>;
  return join(destinationRoot, filename);
}

function extractPackage(tarball: string, packageName: "designer" | "publisher" | "writer") {
  const destination = join(consumerRoot, "node_modules", "@clossys", packageName);
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", destination], {
    timeout: 30_000,
  });
}

function linkInstalledPeer(name: string, targetRoot = consumerRoot) {
  const source = realpathSync(join(repoRoot, "node_modules", name));
  const destination = join(targetRoot, "node_modules", name);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(source, destination, "junction");
}

function runProbe(reactServer: boolean) {
  const script = `
    import * as web from "@clossys/publisher/web";

    const document = {
      id: "react-server-proof",
      channel: "web",
      template: "MarketingView",
      meta: { channel: "web", title: "Server-safe publishing", description: "Packed artifact proof." },
      bindings: [
        { slot: "brand", value: "Clossys" },
        { slot: "heroHeading", value: "Server-safe publishing" },
        { slot: "ctaHeading", value: "Continue" },
      ],
    };
    const { element } = web.renderWebDocument(document, {
      groups: [
        { slot: "features", items: [] },
        { slot: "faq", items: [{ index: 0, fields: { question: { value: "Does it render?" }, answer: { value: "Yes." } } }] },
      ],
    });
    const sectioned = web.SectionedView({
      document: {
        id: "sectioned-server-proof",
        resolutions: [{ ref: { id: "sectioned.proof" }, text: "Server-safe sections", recordId: "proof", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "sectioned.proof" }],
        sections: [
          { id: "hero", kind: "hero", ground: "base", heading: "Server-safe sections" },
          { id: "steps", kind: "ordered-step-sequence", ground: "sunken", heading: "Steps", items: [{ id: "one", ordinal: "1", heading: "Start" }] },
          { id: "status", kind: "status-list", ground: "inverse", heading: "Status", labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Sections", state: "available" }] }] },
          {
            id: "content",
            kind: "content-section",
            ground: "base",
            heading: "Content band",
            size: "standard",
            layout: "split-end",
            block: { type: "items", arrangement: "rows", columns: 1, order: "none", reveal: "all", treatment: "rule", emphasis: "item", items: [{ id: "a", heading: "Server topic" }, { id: "b", heading: "Second topic" }] },
            media: { type: "specimen", label: "A placeholder record shown as native markup", panel: { id: "record", title: "Server record", parts: [{ id: "fields", type: "fields", items: [{ id: "a", label: "Server field", value: "Server value" }] }] } },
          },
        ],
      },
    });

    const { createCopyResolver } = await import("@clossys/writer");
    const { resolveSectionedViewDocument } = await import("@clossys/publisher/core");
    const copy = { heading:"Packed landing page", question:"Packed question?", answer:"Packed answer.", legacy:"Published questions" };
    const ref = key => ({id:"landing."+key});
    const resolver = createCopyResolver({id:"landing",locale:"en",revision:"1",source:{kind:"consumer",reference:"packed-proof"},entries:Object.entries(copy).map(([key,text])=>({id:ref(key).id,text,context:"Packed proof",status:"approved"}))});
    const landingDocument = resolveSectionedViewDocument({id:"landing",sections:[{id:"landing-hero",kind:"hero",ground:"inverse",heading:ref("heading")},{id:"landing-content",kind:"content-section",ground:"base",heading:ref("heading"),block:{type:"items",recipe:"faq",items:["one","two","three","four"].map(id=>({id,heading:ref("question"),description:ref("answer")}))}},{id:"landing-legacy",kind:"faq",ground:"sunken",layout:"split",heading:ref("legacy"),items:["one","two","three","four"].map(id=>({id,question:ref("question"),answer:ref("answer")}))}]},resolver);
    const landing = web.LandingView({document:landingDocument,header:"reserved",peek:false});
    const landingCase = (kind, layout) => {
      const sections = landingDocument.sections
        .filter(section => section.kind === "hero" || section.kind === kind)
        .map(section => section.kind === "faq" ? { ...section, layout } : section);
      const ids = new Set(sections.map(section => section.id));
      return web.LandingView({
        document: {
          ...landingDocument,
          sections,
          ...(landingDocument.viewGrounds === undefined ? {} : {
            viewGrounds: landingDocument.viewGrounds.filter(id => ids.has(id)),
          }),
        },
        header: "reserved",
        peek: false,
      });
    };
    const landingCases = {
      canonical: landingCase("content-section"),
      publishedSplit: landingCase("faq", "split"),
      publishedStacked: landingCase("faq", "stacked"),
    };

    const result = { keys: Object.keys(web).sort(), summaryClasses: [] };
    if (${reactServer ? "true" : "false"}) {
      const tags = [];
      const text = [];
      const visit = (node) => {
        if (node === null || node === undefined || typeof node === "boolean") return;
        if (typeof node === "string" || typeof node === "number") { text.push(String(node)); return; }
        if (Array.isArray(node)) { for (const child of node) visit(child); return; }
        if (typeof node.type === "function") { visit(node.type(node.props)); return; }
        if (typeof node.type === "string") {
          tags.push(node.type);
          if (node.type === "summary") result.summaryClasses.push(node.props?.className ?? "");
        }
        visit(node.props?.children);
      };
      visit(element);
      visit(sectioned);
      result.tags = tags;
      result.text = text;
      const capture = node => {
        const tagCount = tags.length;
        const textCount = text.length;
        const summaryCount = result.summaryClasses.length;
        visit(node);
        const value = {
          tags: tags.slice(tagCount),
          text: text.slice(textCount),
          summaryClasses: result.summaryClasses.slice(summaryCount),
        };
        tags.length = tagCount;
        text.length = textCount;
        result.summaryClasses.length = summaryCount;
        return value;
      };
      const combinedLanding = capture(landing);
      result.landingTags = combinedLanding.tags;
      result.landingText = combinedLanding.text;
      result.landingCases = Object.fromEntries(
        Object.entries(landingCases).map(([name, node]) => [name, capture(node)]),
      );
    } else {
      const { renderToStaticMarkup } = await import("react-dom/server");
      result.html = renderToStaticMarkup([element, sectioned]);
      result.landingHtml=renderToStaticMarkup(landing);
      result.landingCases = Object.fromEntries(
        Object.entries(landingCases).map(([name, node]) => [name, {
          html: renderToStaticMarkup(node),
        }]),
      );
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const args = reactServer
    ? ["--conditions=react-server", "--input-type=module", "-e", script]
    : ["--input-type=module", "-e", script];
  return JSON.parse(execFileSync(process.execPath, args, { cwd: consumerRoot, encoding: "utf8", timeout: 30_000 })) as {
    keys: string[];
    tags?: string[];
    text?: string[];
    html?: string;
    summaryClasses: string[];
    landingHtml?: string; landingTags?: string[]; landingText?: string[];
    landingCases?: Record<"canonical" | "publishedSplit" | "publishedStacked", {
      html?: string;
      tags?: string[];
      text?: string[];
      summaryClasses?: string[];
    }>;
  };
}

let normal: ReturnType<typeof runProbe>;
let server: ReturnType<typeof runProbe>;
let publisherTarball: string;

beforeAll(() => {
  mkdirSync(packedRoot, { recursive: true });
  mkdirSync(join(consumerRoot, "node_modules", "@clossys"), { recursive: true });
  extractPackage(packPackage(join(repoRoot, "packages", "designer")), "designer");
  extractPackage(packPackage(join(repoRoot, "packages", "writer")), "writer");
  publisherTarball = packPackage(publisherRoot);
  extractPackage(publisherTarball, "publisher");
  for (const peer of ["react", "react-dom", "react-aria-components", "tailwind-merge", "@internationalized/date"]) {
    linkInstalledPeer(peer);
  }
  normal = runProbe(false);
  server = runProbe(true);
}, 60_000);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("packed Publisher web React-server boundary", () => {
  it("imports and renders the packed web entry under react-server through native FAQ markup", () => {
    expect(server.tags).toContain("details");
    expect(server.tags).toContain("summary");
    expect(server.text).toEqual(expect.arrayContaining(["Does it render?", "Yes."]));
  });

  it("keeps the packed native summary's package-standard focus indication", () => {
    expect(server.summaryClasses).toHaveLength(1);
    expect(server.summaryClasses[0]).not.toMatch(/\boutline-none\b/);
    expect(server.summaryClasses[0]).toContain("focus-visible:outline-2");
    expect(server.summaryClasses[0]).toContain("focus-visible:outline-offset-2");
    expect(server.summaryClasses[0]).toContain("focus-visible:outline-accent");
  });

  it("hides the packed native summary's marker in favour of the Designer chevron", () => {
    expect(server.summaryClasses).toHaveLength(1);
    expect(server.summaryClasses[0]).toContain("summary-marker-none");
    // The chevron is the Designer Icon (a forwardRef the probe does not
    // descend into); what must not ship is a text-glyph marker.
    expect(server.text ?? []).not.toContain("▸");
  });

  it("keeps the ordinary packed entry on the React Aria FAQ implementation", () => {
    expect(normal.html).toContain("data-rac");
    expect(normal.html).toContain("<button");
    expect(normal.html).not.toContain("<summary");
  });

  it("exports the exact same runtime names from the ordinary and react-server targets", () => {
    expect(server.keys).toEqual(normal.keys);
    expect(server.keys).toEqual(expect.arrayContaining(["CaptureView", "CollectionView", "ContactView", "DocumentView", "SectionedView"]));
  });

  it("renders the packed SectionedView through server-safe ordered-step and status blocks", () => {
    expect(server.tags).toEqual(expect.arrayContaining(["ol", "dl"]));
    expect(server.text).toEqual(expect.arrayContaining(["Server-safe sections", "Steps", "Status"]));
  });

  it("renders a packed content-section band (text block and specimen) through server-safe blocks on both targets", () => {
    expect(server.tags).toEqual(expect.arrayContaining(["figure", "ul"]));
    expect(server.text).toEqual(expect.arrayContaining(["Content band", "Server topic", "Server record", "Server field", "Server value"]));
    expect(normal.html).toContain('data-layout="split-end"');
    expect(normal.html).toMatch(/<figure[^>]*data-specimen/);
  });

  it("keeps packed Landing disclosure entry-specific while preserving its native published FAQ bridge", () => {
    expect(normal.landingHtml?.match(/<button /g)).toHaveLength(4);expect(normal.landingHtml?.match(/<summary /g)).toHaveLength(4);expect(normal.landingHtml).toContain("data-rac");
    expect(server.landingTags?.filter(tag=>tag==="summary")).toHaveLength(8);expect(server.landingTags).not.toContain("button");
    expect(server.landingText).toEqual(expect.arrayContaining(["Packed landing page","Packed question?","Packed answer.","Published questions"]));
  });

  it("renders canonical packed Landing disclosures through each entry", () => {
    const ordinary = normal.landingCases!.canonical;
    const native = server.landingCases!.canonical;
    expect(ordinary.html?.match(/<button /g)).toHaveLength(4);
    expect(ordinary.html).toContain("data-rac");
    expect(ordinary.html).not.toContain("<summary");
    expect(ordinary.html).not.toContain("<details");
    expect(native.tags?.filter(tag => tag === "summary")).toHaveLength(4);
    expect(native.tags?.filter(tag => tag === "details")).toHaveLength(4);
    expect(native.tags).not.toContain("button");
    expect(native.text).toEqual(expect.arrayContaining([
      "Packed landing page", "Packed question?", "Packed answer.",
    ]));
    expect(ordinary.html).toContain("Packed question?");
    expect(ordinary.html).toContain("Packed answer.");
  });

  it.each(["publishedSplit", "publishedStacked"] as const)(
    "retains native packed Landing FAQ rows for %s on both entries",
    name => {
      const ordinary = normal.landingCases![name];
      const native = server.landingCases![name];
      expect(ordinary.html?.match(/<summary /g)).toHaveLength(4);
      expect(ordinary.html?.match(/<details /g)).toHaveLength(4);
      expect(ordinary.html).not.toContain("<button");
      expect(ordinary.html).not.toContain("data-rac");
      expect(ordinary.html).toContain("Published questions");
      expect(ordinary.html).toContain("Packed question?");
      expect(ordinary.html).toContain("Packed answer.");
      expect(native.tags?.filter(tag => tag === "summary")).toHaveLength(4);
      expect(native.tags?.filter(tag => tag === "details")).toHaveLength(4);
      expect(native.tags).not.toContain("button");
      expect(native.text).toEqual(expect.arrayContaining([
        "Published questions", "Packed question?", "Packed answer.",
      ]));
    },
  );

  it("rejects a packed Designer 0.2.5 graph that the former lower bound accepted before SectionedView's missing blocks fail at import", () => {
    const adversarialRoot = join(fixtureRoot, "designer-0.2.5");
    mkdirSync(join(adversarialRoot, "dist", "atoms"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "blocks"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "shell"), { recursive: true });
    writeFileSync(
      join(adversarialRoot, "package.json"),
      JSON.stringify({
        name: "@clossys/designer",
        version: "0.2.5",
        type: "module",
        exports: {
          "./atoms/server": "./dist/atoms/server.js",
          "./blocks/server": "./dist/blocks/server.js",
          "./shell/server": "./dist/shell/server.js",
          "./tokens": "./dist/tokens.js",
        },
        files: ["dist"],
      }),
    );
    writeFileSync(
      join(adversarialRoot, "dist", "atoms", "server.js"),
      "export const Badge = ({ children }) => children; export const Card = ({ children }) => children; export const mergeUiClasses = (...names) => names.filter(Boolean).join(' ');\n",
    );
    writeFileSync(
      join(adversarialRoot, "dist", "blocks", "server.js"),
      "export const EmptyState = () => null; export const FeatureGrid = () => null; export const Hero = () => null; export const PageHeader = () => null;\n",
    );
    writeFileSync(
      join(adversarialRoot, "dist", "shell", "server.js"),
      "export const SiteFooter = () => null; export const SiteHeader = () => null;\n",
    );
    // Publisher's web entry also reads Designer's token registry; an empty one is enough here.
    writeFileSync(join(adversarialRoot, "dist", "tokens.js"), "export const TOKENS = {};\n");

    const adversarialPacked = join(fixtureRoot, "adversarial-packed");
    const designer023Tarball = packPackage(adversarialRoot, adversarialPacked);
    const controllerTarball = packPackage(join(repoRoot, "packages", "controller"), adversarialPacked);
    const writerTarball = packPackage(join(repoRoot, "packages", "writer"), adversarialPacked);

    const legacyPublisherRoot = join(fixtureRoot, "legacy-range-publisher");
    mkdirSync(legacyPublisherRoot, { recursive: true });
    execFileSync("tar", ["-xzf", publisherTarball, "--strip-components=1", "-C", legacyPublisherRoot]);
    const legacyManifestPath = join(legacyPublisherRoot, "package.json");
    const legacyManifest = JSON.parse(readFileSync(legacyManifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    // Premise guard: this test downgrades the range below to simulate the
    // former lower bound, so it must first confirm the packed manifest really
    // does carry the current one. Tracks Designer's current minor — a Designer
    // minor bump updates this line too, the same way `expectedVersions` in
    // scripts/run-candidate-qualification.test.mjs tracks every package.
    expect(legacyManifest.dependencies["@clossys/designer"]).toBe("^0.7.1");
    legacyManifest.dependencies["@clossys/designer"] = "^0.2.0";
    writeFileSync(legacyManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
    const legacyPublisherTarball = packPackage(legacyPublisherRoot, join(fixtureRoot, "legacy-packed"));

    const install = (publisher: string, root: string) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "package.json"), '{"name":"packed-consumer","private":true}\n');
      try {
        const stdout = execFileSync(
          "npm",
          [
            "install",
            "--offline",
            "--ignore-scripts",
            "--legacy-peer-deps",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--cache",
            join(root, ".npm-cache"),
            publisher,
            designer023Tarball,
            controllerTarball,
            writerTarball,
          ],
          { cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
        );
        return { ok: true as const, output: stdout };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        return { ok: false as const, output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}` };
      }
    };

    const legacyConsumer = join(fixtureRoot, "legacy-range-consumer");
    expect(install(legacyPublisherTarball, legacyConsumer).ok).toBe(true);
    for (const peer of ["react", "react-dom", "react-aria-components", "tailwind-merge", "@internationalized/date"]) {
      linkInstalledPeer(peer, legacyConsumer);
    }
    let legacyImportFailure = "";
    try {
      execFileSync(
        process.execPath,
        ["--conditions=react-server", "-e", 'import("@clossys/publisher/web")'],
        { cwd: legacyConsumer, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      legacyImportFailure = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
    }
    // Which gap Node reports first follows the module graph: a missing block
    // (`Faq`), or the `./icons` entry (absent from this shape) that
    // `LandingView` reads its scroll cue's glyph from.
    expect(legacyImportFailure).toMatch(/Faq|Package subpath '\.\/icons' is not defined/);

    const corrected = install(publisherTarball, join(fixtureRoot, "corrected-range-consumer"));
    expect(corrected.ok).toBe(false);
    expect(corrected.output).toMatch(/@clossys(?:%2f|\/)designer/i);
  }, 60_000);

  it("rejects a packed Designer 0.4.7 graph missing MarketingChapter that the former ^0.4.0 lower bound accepted (qualification defect, issue #1204)", () => {
    // This reproduces the real release-qualification failure observed for
    // Publisher 0.4.24: the currently-published Designer is 0.4.7 (the
    // registry has not caught up to the in-tree 0.4.17), and
    // `^0.4.0` happily resolved it. `dist/web/internal/compileConsumerTemplateBlocks.js`
    // imports `MarketingChapter` from `@clossys/designer/blocks/server`,
    // which Designer only started exporting at 0.4.12 — so a clean install
    // against the real registry installed a Designer that could not satisfy
    // Publisher's own web entry, and `import("@clossys/publisher/web")`
    // failed under both the ordinary and `react-server` conditions. This
    // fixture reproduces the exact 0.4.7 shape (every block Publisher's web
    // graph reaches, except `MarketingChapter`) without depending on the
    // live registry, so the test stays deterministic as the registry moves.
    const adversarialRoot = join(fixtureRoot, "designer-0.4.7-shaped");
    mkdirSync(join(adversarialRoot, "dist", "atoms"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "blocks"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "shell"), { recursive: true });
    writeFileSync(
      join(adversarialRoot, "package.json"),
      JSON.stringify({
        name: "@clossys/designer",
        version: "0.4.7",
        type: "module",
        exports: {
          "./atoms/server": "./dist/atoms/server.js",
          "./blocks/server": "./dist/blocks/server.js",
          "./shell/server": "./dist/shell/server.js",
          "./tokens": "./dist/tokens.js",
        },
        files: ["dist"],
      }),
    );
    writeFileSync(
      join(adversarialRoot, "dist", "atoms", "server.js"),
      "export const Badge = ({ children }) => children; export const Card = ({ children }) => children; export const mergeUiClasses = (...names) => names.filter(Boolean).join(' ');\n",
    );
    // Every block Publisher's web graph names, at the shape Designer 0.4.7
    // actually ships it — deliberately without `MarketingChapter`, which
    // Designer only added at 0.4.12.
    // The full named-export surface `@clossys/designer/blocks/server` ships
    // at 0.4.7 on the public registry, minus `MarketingChapter`.
    writeFileSync(
      join(adversarialRoot, "dist", "blocks", "server.js"),
      [
        "export const SECTION_GROUND_CLASSES = { base: '', inverse: '', sunken: '' };",
        "export const ArticleBody = ({ children }) => children;",
        "export const DetailView = () => null;",
        "export const EmptyState = () => null;",
        "export const FeatureGrid = () => null;",
        "export const OrderedStepSequence = () => null;",
        "export const StatusList = () => null;",
        "export const Faq = () => null;",
        "export const FieldGroup = () => null;",
        "export const Hero = () => null;",
        "export const PageHeader = () => null;",
        "export const PricingTable = () => null;",
        "export const SectionHeader = () => null;",
        "export const Stat = () => null;",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(adversarialRoot, "dist", "shell", "server.js"),
      "export const SiteFooter = () => null; export const SiteHeader = () => null;\n",
    );
    // Publisher's web entry also reads Designer's token registry; an empty one is enough here.
    writeFileSync(join(adversarialRoot, "dist", "tokens.js"), "export const TOKENS = {};\n");

    const adversarialPacked = join(fixtureRoot, "designer-0.4.7-shaped-packed");
    const designer047Tarball = packPackage(adversarialRoot, adversarialPacked);
    const controllerTarball = packPackage(join(repoRoot, "packages", "controller"), adversarialPacked);
    const writerTarball = packPackage(join(repoRoot, "packages", "writer"), adversarialPacked);

    const formerRangeRoot = join(fixtureRoot, "former-range-publisher");
    mkdirSync(formerRangeRoot, { recursive: true });
    execFileSync("tar", ["-xzf", publisherTarball, "--strip-components=1", "-C", formerRangeRoot]);
    const formerManifestPath = join(formerRangeRoot, "package.json");
    const formerManifest = JSON.parse(readFileSync(formerManifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    // Reproduce the exact former lower bound that let this defect through.
    formerManifest.dependencies["@clossys/designer"] = "^0.4.0";
    writeFileSync(formerManifestPath, `${JSON.stringify(formerManifest, null, 2)}\n`);
    const formerRangeTarball = packPackage(formerRangeRoot, join(fixtureRoot, "former-range-packed"));

    const install = (publisher: string, root: string) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "package.json"), '{"name":"packed-consumer","private":true}\n');
      try {
        const stdout = execFileSync(
          "npm",
          [
            "install",
            "--offline",
            "--ignore-scripts",
            "--legacy-peer-deps",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--cache",
            join(root, ".npm-cache"),
            publisher,
            designer047Tarball,
            controllerTarball,
            writerTarball,
          ],
          { cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
        );
        return { ok: true as const, output: stdout };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        return { ok: false as const, output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}` };
      }
    };

    // The former `^0.4.0` range resolved this 0.4.7-shaped Designer without
    // complaint — the install succeeded — and the resulting artifact could
    // not actually serve `@clossys/publisher/web`.
    const formerRangeConsumer = join(fixtureRoot, "former-range-consumer");
    expect(install(formerRangeTarball, formerRangeConsumer).ok).toBe(true);
    for (const peer of ["react", "react-dom", "react-aria-components", "tailwind-merge", "@internationalized/date"]) {
      linkInstalledPeer(peer, formerRangeConsumer);
    }
    let formerRangeImportFailure = "";
    try {
      execFileSync(
        process.execPath,
        ["--conditions=react-server", "-e", 'import("@clossys/publisher/web")'],
        { cwd: formerRangeConsumer, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      formerRangeImportFailure = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`;
    }
    // Which missing Designer export Node reports first follows the module
    // graph's link order: `MarketingChapter`, or `SkipLink` now that the
    // global-error document reaches the frame from the views barrel. Entry
    // resolution precedes linking, so the `./icons` entry this shape lacks
    // (read by `LandingView`) can surface first.
    expect(formerRangeImportFailure).toMatch(/does not provide an export named '(?:MarketingChapter|SkipLink)'|Package subpath '\.\/icons' is not defined/);

    // The corrected `^0.4.12` range (the packed manifest's actual declared
    // range) refuses to install against this same 0.4.7-shaped tarball at
    // all, so the defect can never reach a consumer's `node_modules`.
    const corrected = install(publisherTarball, join(fixtureRoot, "designer-0.4.7-corrected-consumer"));
    expect(corrected.ok).toBe(false);
    expect(corrected.output).toMatch(/@clossys(?:%2f|\/)designer/i);
  }, 60_000);
});
