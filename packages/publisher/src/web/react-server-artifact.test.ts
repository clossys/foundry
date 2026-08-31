import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(publisherRoot, "../..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "foundry-publisher-react-server-"));
const consumerRoot = join(fixtureRoot, "consumer");
const packedRoot = join(fixtureRoot, "packed");

function packAndExtract(packageName: "designer" | "publisher") {
  const packageRoot = join(repoRoot, "packages", packageName);
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packedRoot],
    { cwd: packageRoot, encoding: "utf8", timeout: 30_000 },
  );
  const [{ filename }] = JSON.parse(output) as Array<{ filename: string }>;
  const destination = join(consumerRoot, "node_modules", "@clossys", packageName);
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", join(packedRoot, filename), "--strip-components=1", "-C", destination], {
    timeout: 30_000,
  });
}

function linkInstalledPeer(name: string) {
  const source = realpathSync(join(repoRoot, "node_modules", name));
  const destination = join(consumerRoot, "node_modules", name);
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
        { slot: "faq", items: [{ index: 0, node: { question: "Does it render?", answer: "Yes." } }] },
      ],
    });

    const result = { keys: Object.keys(web).sort() };
    if (${reactServer ? "true" : "false"}) {
      const tags = [];
      const text = [];
      const visit = (node) => {
        if (node === null || node === undefined || typeof node === "boolean") return;
        if (typeof node === "string" || typeof node === "number") { text.push(String(node)); return; }
        if (Array.isArray(node)) { for (const child of node) visit(child); return; }
        if (typeof node.type === "function") { visit(node.type(node.props)); return; }
        if (typeof node.type === "string") tags.push(node.type);
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
  };
}

let normal: ReturnType<typeof runProbe>;
let server: ReturnType<typeof runProbe>;

beforeAll(() => {
  mkdirSync(packedRoot, { recursive: true });
  mkdirSync(join(consumerRoot, "node_modules", "@clossys"), { recursive: true });
  packAndExtract("designer");
  packAndExtract("publisher");
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

  it("keeps the ordinary packed entry on the React Aria FAQ implementation", () => {
    expect(normal.html).toContain("data-rac");
    expect(normal.html).toContain("<button");
    expect(normal.html).not.toContain("<summary");
  });

  it("exports the exact same runtime names from the ordinary and react-server targets", () => {
    expect(server.keys).toEqual(normal.keys);
  });
});
