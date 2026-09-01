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

function extractPackage(tarball: string, packageName: "designer" | "publisher") {
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
      result.tags = tags;
      result.text = text;
    } else {
      const { renderToStaticMarkup } = await import("react-dom/server");
      result.html = renderToStaticMarkup(element);
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
  };
}

let normal: ReturnType<typeof runProbe>;
let server: ReturnType<typeof runProbe>;
let publisherTarball: string;

beforeAll(() => {
  mkdirSync(packedRoot, { recursive: true });
  mkdirSync(join(consumerRoot, "node_modules", "@clossys"), { recursive: true });
  extractPackage(packPackage(join(repoRoot, "packages", "designer")), "designer");
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

  it("keeps the packed native summary's list-item disclosure marker", () => {
    expect(server.summaryClasses).toHaveLength(1);
    expect(server.summaryClasses[0]).not.toMatch(/\b(?:flex|inline-flex|block|list-none)\b/);
  });

  it("keeps the ordinary packed entry on the React Aria FAQ implementation", () => {
    expect(normal.html).toContain("data-rac");
    expect(normal.html).toContain("<button");
    expect(normal.html).not.toContain("<summary");
  });

  it("exports the exact same runtime names from the ordinary and react-server targets", () => {
    expect(server.keys).toEqual(normal.keys);
  });

  it("rejects a packed Designer 0.2.3 graph that the former lower bound accepted before the missing Faq fails at import", () => {
    const adversarialRoot = join(fixtureRoot, "designer-0.2.3");
    mkdirSync(join(adversarialRoot, "dist", "atoms"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "blocks"), { recursive: true });
    mkdirSync(join(adversarialRoot, "dist", "shell"), { recursive: true });
    writeFileSync(
      join(adversarialRoot, "package.json"),
      JSON.stringify({
        name: "@clossys/designer",
        version: "0.2.3",
        type: "module",
        exports: {
          "./atoms/server": "./dist/atoms/server.js",
          "./blocks/server": "./dist/blocks/server.js",
          "./shell/server": "./dist/shell/server.js",
        },
        files: ["dist"],
      }),
    );
    writeFileSync(
      join(adversarialRoot, "dist", "atoms", "server.js"),
      "export const Card = ({ children }) => children; export const mergeUiClasses = (...names) => names.filter(Boolean).join(' ');\n",
    );
    writeFileSync(
      join(adversarialRoot, "dist", "blocks", "server.js"),
      "export const EmptyState = () => null; export const FeatureGrid = () => null; export const Hero = () => null;\n",
    );
    writeFileSync(
      join(adversarialRoot, "dist", "shell", "server.js"),
      "export const SiteFooter = () => null; export const SiteHeader = () => null;\n",
    );

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
    expect(legacyManifest.dependencies["@clossys/designer"]).toBe("^0.2.4");
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
    expect(legacyImportFailure).toMatch(/Faq/);

    const corrected = install(publisherTarball, join(fixtureRoot, "corrected-range-consumer"));
    expect(corrected.ok).toBe(false);
    expect(corrected.output).toMatch(/@clossys(?:%2f|\/)designer/i);
  }, 60_000);
});
