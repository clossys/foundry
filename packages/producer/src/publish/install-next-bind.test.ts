/**
 * `clossys publish --install --site <publication> --next app --bind`: the site template becomes a
 * Publisher install. The template (packages/publisher/templates/site, as `apps/site`) and the
 * fixture consumer are copied to a temp directory, the bound install writes every route file, the
 * assembly, the states and the page modules from the pinned page records, and the installed app is
 * bundled and server-rendered: the HTML is the pinned frame and section with Writer text. Items
 * install through `localItemRunner`, so nothing reaches a registry.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { NEXT_ROUTE_MARKER } from "@clossys/publisher/install";
import { parseArgs } from "../cli/args.js";
import { runPinCli } from "../cli/pin.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";
import { publishNext, type PublishNextResult } from "./install-next.js";
import { localItemRunner, NEXT_BIND_ASSEMBLY, NEXT_BIND_PROJECTION, NEXT_BIND_STATES } from "./install-next-bind.js";

const fixture = join(import.meta.dirname, "__fixtures__", "install-consumer");
const template = join(import.meta.dirname, "..", "..", "..", "publisher", "templates", "site");
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

/** A temp consumer holding the fixture records and the site template as `apps/site`. */
async function consumer(): Promise<{ root: string; site: string; app: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-next-bind-")));
  temps.push(root);
  cpSync(fixture, root, { recursive: true });
  await withDesignerSlots(join(root, "clossys"));
  const site = join(root, "apps", "site");
  cpSync(template, site, { recursive: true, filter: source => !/[\\/](?:node_modules|\.next)(?:[\\/]|$)/.test(source.slice(template.length)) });
  return { root, site, app: join(site, "app") };
}
const install = (root: string, app: string, check = false): Promise<PublishNextResult> => publishNext({
  root, publication: "example-site", app, check, out: join(root, ".out"),
  bind: { selection: { module: join(root, "component-selection.ts") }, runner: localItemRunner },
});
const blocking = (result: PublishNextResult) => result.findings.filter(finding => finding.severity !== "info");

/** Bundle the installed root layout around one installed route and render it to HTML, as Next would on the server. */
async function render(site: string, route: string): Promise<string> {
  const here = createRequire(import.meta.url);
  const entry = `import { createElement } from "react"; import Layout from "./app/layout"; import Page from "./app/${route}"; export default function Root() { return createElement(Layout, null, createElement(Page)); }`;
  const result = await build({
    stdin: { contents: entry, resolveDir: site, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    // Bundled CommonJS dependencies require React: give the ESM bundle this workspace's require.
    banner: { js: `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(${JSON.stringify(import.meta.filename)});` },
    loader: { ".css": "empty" },
    // The site's own dependencies (@clossys/publisher and the pinned items' imports) resolve from this workspace.
    nodePaths: [join(import.meta.dirname, "..", "..", "node_modules"), join(import.meta.dirname, "..", "..", "..", "..", "node_modules")],
    plugins: [{ name: "host-react", setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: here.resolve(args.path), external: true })); } }],
  });
  const out = join(site, ".render", `${route.replace(/\W/g, "-")}-${Date.now()}.mjs`);
  mkdirSync(join(site, ".render"), { recursive: true });
  writeFileSync(out, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(out).href) as { default: ComponentType };
  return renderToStaticMarkup(createElement(module.default));
}

describe("clossys publish --install --next --bind", () => {
  it("parses --bind with --next and --selection only", () => {
    expect(parseArgs(["publish", "--install", "--site", "site", "--next", "app", "--bind", "--selection", "sel.ts"])).toMatchObject({ bind: true, next: "app", selection: "sel.ts" });
    expect(() => parseArgs(["publish", "--install", "--site", "site", "--next", "app", "--bind"])).toThrow();
    expect(() => parseArgs(["publish", "--install", "--site", "site", "--next", "app", "--bind", "--selection", "s.ts", "--assembly", "a.tsx"])).toThrow();
  });

  it("the template ships no route file, and its publish:site script is the bound install", () => {
    const code = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? code(join(dir, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [entry.name] : []);
    expect(code(join(template, "app"))).toEqual([]);
    const scripts = JSON.parse(readFileSync(join(template, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["publish:site"]).toMatch(/^clossys publish --install --site \S+ --next app --bind --selection \S+$/);
    expect([scripts.predev, scripts.prebuild]).toEqual(["npm run publish:site", "npm run publish:site"]);
  });

  it("installs every route, the shell and the assembly from records, and the rendered HTML is the pinned frame with Writer text", { timeout: 60_000 }, async () => {
    const { root, site, app } = await consumer();
    // The verified native font output the template's fonts module is replaced with.
    writeFileSync(join(site, "src", "clossys", "fonts.ts"), "export const nativeFontVariables = 'font-probe';\n");
    const result = await install(root, app);
    expect(blocking(result)).toEqual([]);
    for (const file of ["page.tsx", "about/page.tsx", "layout.tsx", "loading.tsx", "not-found.tsx", "error.tsx", "global-error.tsx"]) {
      expect(readFileSync(join(app, file), "utf8").split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
    }
    for (const file of [NEXT_BIND_ASSEMBLY, NEXT_BIND_STATES, "clossys/pages/home.tsx", "clossys/pages/about.tsx", "clossys/pages/state.tsx"]) {
      expect(readFileSync(join(site, file), "utf8").split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
    }
    const projection = JSON.parse(readFileSync(join(site, NEXT_BIND_PROJECTION), "utf8"));
    expect(projection.pages.map((page: { id: string; route: string; frame: string; sections: string[] }) => [page.id, page.route, page.frame, page.sections])).toEqual([["home", "/", "frames.plain", ["sections.hero"]], ["about", "/about", "frames.plain", ["sections.hero"]]]);

    const home = await render(site, "page");
    expect(home).toContain('<html lang="en" class="font-probe">');
    expect(home).toContain('data-frame="plain"');
    expect(home).toContain("Pages assembled from records");
    expect(home).toContain("Every word here comes from a Writer key.");
    const about = await render(site, "about/page");
    expect(about).toContain("Read straight from the page cell");
    const missing = await render(site, "not-found");
    expect(missing).toContain('data-frame="plain"');
    expect(missing).not.toContain("data-section");

    // A rerun is stable; a hand edit under a copied marker is drift; an unmarked file is refused.
    expect((await install(root, app, true)).files.filter(file => file.state === "drift")).toEqual([]);
    writeFileSync(join(app, "about", "page.tsx"), `${NEXT_ROUTE_MARKER}\nexport default function Page() { return null; }\n`);
    expect((await install(root, app, true)).files.filter(file => file.state === "drift").map(file => file.file)).toEqual(["about/page.tsx"]);
    writeFileSync(join(site, NEXT_BIND_ASSEMBLY), "export function PublishedPage() { return null; }\n");
    const refused = await install(root, app);
    expect(refused.findings.map(finding => finding.detail)).toContain(`${NEXT_BIND_ASSEMBLY} exists and was not installed by Publisher`);
  });

  it("a re-pinned Writer string reaches the rendered page through a reinstall", { timeout: 60_000 }, async () => {
    const { root, site, app } = await consumer();
    expect(blocking(await install(root, app))).toEqual([]);
    const strings = join(root, "clossys", "agents", "writer", "strings.site", "candidates");
    const current = JSON.parse(readFileSync(join(strings, "..", "pin.json"), "utf8")).candidate as string;
    const next = `site-v${Number(/-v(\d+)\.md$/.exec(current)![1]) + 1}`;
    writeFileSync(join(strings, `${next}.md`), readFileSync(join(strings, current), "utf8").replace("Pages assembled from records", "Pages reinstalled from a new pin"));
    const pinned = await runPinCli(["writer/strings.site", next, "--by", "planner:SITE-TEMPLATE", "--at", "2026-11-04T00:00:00Z", "--root", root], root);
    expect(pinned.exitCode).toBe(0);
    // Until it is reinstalled, the installed page module is stale and the check run says so.
    expect((await install(root, app, true)).files.filter(file => file.state === "drift").map(file => file.file)).toContain("clossys/pages/home.tsx");
    expect(blocking(await install(root, app))).toEqual([]);
    const home = await render(site, "page");
    expect(home).toContain("Pages reinstalled from a new pin");
    expect(home).not.toContain("Pages assembled from records");
    expect(existsSync(join(site, "clossys", "pages", "home.tsx"))).toBe(true);
  });
});
