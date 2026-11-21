/**
 * The publishing substrate imports registry items the way a Next app does. shadcn examples
 * (`item-example`, used by the link-index, activity-feed, resource-list, status-list and
 * task-list sections) default-import `next/image`, a CommonJS module flagged `__esModule`. In a
 * `"type": "module"` substrate Vite 8 hands that import the CommonJS exports object, and every
 * `<Image>` throws React error #130 ("element type is invalid ... got: object") in Studio.
 * This builds such an import with the substrate's own package.json and renders it.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { INSTALL_STATE_DIR, type BoundPage } from "@clossys/publisher/install";
import { ensureSubstrate, renderBoundPage, SUBSTRATE_HOST_FILE, SUBSTRATE_VITE_CONFIG } from "./install.js";
import { placeholderImages, SPECIMEN_IMAGE_PLACEHOLDER } from "../specimen/specimen-images.js";

const requireHere = createRequire(import.meta.url);
const temps: string[] = [];
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "producer-substrate-interop-"))); temps.push(dir); return dir; };
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

describe("publishing substrate CommonJS interop", () => {
  it("writes a package.json without \"type\": \"module\"", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).type).toBeUndefined();
  });

  it("brings a substrate written with \"type\": \"module\" to the current shape, keeping its dependencies", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...manifest, type: "module", dependencies: { ...manifest.dependencies, next: "latest" } }));
    await ensureSubstrate(dir);
    const after = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(after.type).toBeUndefined();
    expect(after.dependencies.next).toBe("latest");
  });

  // reactflow's base-node, base-handle, labeled-handle and node-status import `cn` from
  // `@/lib/utils` and list no registry dependency for it, as every shadcn-init project has it.
  // Without it /designer/components/flow failed to build, or (with @tailwindcss/typography's
  // src/utils.js installed at lib/utils.js) threw "(0 , cn) is not a function".
  const stockUtils = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../designer/references/shadcn-aria/utils@4.23.0/utils.json"), "utf8"));

  it("writes the flavor's lib/utils.ts, the stock aria-nova utils item, and declares the cn package", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    expect(readFileSync(join(dir, "lib", "utils.ts"), "utf8")).toBe(stockUtils.files[0].content);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies)).toEqual(expect.arrayContaining(stockUtils.dependencies));
  });

  it("gives a substrate written without lib/utils.ts the module and the cn package, keeping an installed one", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    delete manifest.dependencies.cn;
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    unlinkSync(join(dir, "lib", "utils.ts"));
    await ensureSubstrate(dir);
    expect(readFileSync(join(dir, "lib", "utils.ts"), "utf8")).toBe(stockUtils.files[0].content);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies.cn).toBeDefined();
    writeFileSync(join(dir, "lib", "utils.ts"), "export { cn } from \"./installed\"\n");
    await ensureSubstrate(dir);
    expect(readFileSync(join(dir, "lib", "utils.ts"), "utf8")).toBe("export { cn } from \"./installed\"\n");
  });

  it("loads @tailwindcss/typography at the reference version, and gives an older substrate the plugin once", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    const css = () => readFileSync(join(dir, "app.css"), "utf8");
    const pkgJson = () => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(css().split("\n").slice(0, 3)).toEqual(['@import "tailwindcss";', '@import "tw-animate-css";', '@plugin "@tailwindcss/typography";']);
    expect(pkgJson().devDependencies["@tailwindcss/typography"]).toBe("0.5.20");
    const manifest = pkgJson();
    delete manifest.devDependencies["@tailwindcss/typography"];
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "app.css"), css().replace('@plugin "@tailwindcss/typography";\n', ""));
    await ensureSubstrate(dir);
    await ensureSubstrate(dir);
    expect(css().split("\n").filter(line => line === '@plugin "@tailwindcss/typography";')).toHaveLength(1);
    expect(css().indexOf("@plugin")).toBeGreaterThan(css().lastIndexOf("@import"));
    expect(pkgJson().devDependencies["@tailwindcss/typography"]).toBe("0.5.20");
  });

  it("inserts the typography plugin after the last @import, else after @charset, else first (R2F-TYPO fix 8)", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    const PLUGIN = '@plugin "@tailwindcss/typography";';
    const rewrite = async (css: string) => {
      writeFileSync(join(dir, "app.css"), css);
      await ensureSubstrate(dir);
      return readFileSync(join(dir, "app.css"), "utf8");
    };
    // No @import at all: the plugin is the first line, before the rules.
    expect(await rewrite(".x { color: red; }\n")).toBe(`${PLUGIN}\n.x { color: red; }\n`);
    // No @import, a leading @charset: the charset stays first.
    expect(await rewrite('@charset "UTF-8";\n.x { color: red; }\n')).toBe(`@charset "UTF-8";\n${PLUGIN}\n.x { color: red; }\n`);
    // A leading comment, blank line and a multi-line @import: after the import's last line, never before any @import line.
    expect(await rewrite('/* app */\n\n@import "tailwindcss";\n@import "tw-animate-css"\n  layer(utilities);\n.x { color: red; }\n'))
      .toBe(`/* app */\n\n@import "tailwindcss";\n@import "tw-animate-css"\n  layer(utilities);\n${PLUGIN}\n.x { color: red; }\n`);
    // Already present: untouched.
    const present = `@import "tailwindcss";\n.x { color: red; }\n${PLUGIN}\n`;
    expect(await rewrite(present)).toBe(present);
  });

  it("a default import of next/image built in the substrate is a component React can render (no #130)", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    // The substrate resolves packages from its node_modules; the workspace install stands in for it.
    symlinkSync(dirname(dirname(requireHere.resolve("next/package.json"))), join(dir, "node_modules"), "dir");
    mkdirSync(join(dir, "probe"));
    // The import exactly as the shadcn item ships it.
    writeFileSync(join(dir, "probe", "entry.tsx"), 'import Image from "next/image"\n\nexport function Probe() {\n  return <Image src="https://avatar.vercel.sh/Project" alt="Project" width={40} height={40} unoptimized />\n}\n');
    const { build } = await import("vite");
    await build({
      root: dir, configFile: false, logLevel: "silent",
      oxc: { jsx: { runtime: "automatic", importSource: "react" } },
      build: {
        outDir: join(dir, "probe-out"), minify: false, emptyOutDir: true,
        lib: { entry: join(dir, "probe", "entry.tsx"), formats: ["es"], fileName: () => "probe.mjs" },
        // One React: the rendering process's own.
        rolldownOptions: { external: [/^react(-dom)?(\/.*)?$/] },
      },
    } as any);
    const { Probe } = await import(pathToFileURL(join(dir, "probe-out", "probe.mjs")).href);
    expect(renderToStaticMarkup(createElement(Probe))).toContain('src="https://avatar.vercel.sh/Project"');
  }, 120_000);

  /**
   * The substrate's node_modules: the workspace install, with `@tailwindcss/vite` (which the
   * substrate installs and this workspace does not) as a no-op plugin, so the substrate's own
   * vite.config.ts loads as written.
   */
  function substrateModules(dir: string): void {
    const workspace = dirname(dirname(requireHere.resolve("next/package.json")));
    const modules = join(dir, "node_modules");
    mkdirSync(join(modules, "@tailwindcss", "vite"), { recursive: true });
    for (const name of readdirSync(workspace)) if (name !== "@tailwindcss" && name !== ".bin") symlinkSync(join(workspace, name), join(modules, name));
    for (const name of readdirSync(join(workspace, "@tailwindcss"))) if (name !== "vite") symlinkSync(join(workspace, "@tailwindcss", name), join(modules, "@tailwindcss", name));
    writeFileSync(join(modules, "@tailwindcss", "vite", "package.json"), JSON.stringify({ name: "@tailwindcss/vite", type: "module", exports: "./index.js" }));
    writeFileSync(join(modules, "@tailwindcss", "vite", "index.js"), 'export default () => ({ name: "tailwind-stand-in" })\n');
  }

  // A specimen site has no Next server: next/image built with Next's default config rewrote
  // every src to /_next/image?url=..., which nothing serves and the specimen CSP refuses
  // (`img-src <origin>/__specimen-site/<key>/ data:`) on 15 section specimens.
  it("next/image built with the substrate's own Vite config keeps the item's src (no /_next/image)", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    substrateModules(dir);
    mkdirSync(join(dir, "probe"));
    // No `unoptimized` prop, as the shadcn item ships it.
    writeFileSync(join(dir, "probe", "entry.tsx"), 'import Image from "next/image"\n\nexport function Probe() {\n  return <Image src="/__specimen-site/k/photo.png" alt="Photo" width={40} height={40} />\n}\n');
    const { build } = await import("vite");
    await build({
      root: dir, configFile: join(dir, "vite.config.ts"), logLevel: "silent",
      build: {
        outDir: join(dir, "probe-out"), minify: false, emptyOutDir: true,
        lib: { entry: join(dir, "probe", "entry.tsx"), formats: ["es"], fileName: () => "probe.mjs" },
        rolldownOptions: { external: [/^react(-dom)?(\/.*)?$/] },
      },
    } as any);
    const { Probe } = await import(pathToFileURL(join(dir, "probe-out", "probe.mjs")).href);
    const markup = renderToStaticMarkup(createElement(Probe));
    expect(markup).not.toContain("/_next/image");
    expect(markup).toContain('src="/__specimen-site/k/photo.png"');
  }, 120_000);

  it("brings a substrate written with the earlier Vite config to the one that configures next/image, leaving another config alone", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    const earlier = [
      'import { fileURLToPath } from "node:url";', 'import tailwindcss from "@tailwindcss/vite";', 'import { defineConfig } from "vite";', "",
      "export default defineConfig({", "  plugins: [tailwindcss()],", '  oxc: { jsx: { runtime: "automatic", importSource: "react" } },',
      '  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },', "});", "",
    ].join("\n");
    writeFileSync(join(dir, "vite.config.ts"), earlier);
    await ensureSubstrate(dir);
    expect(readFileSync(join(dir, "vite.config.ts"), "utf8")).toBe(SUBSTRATE_VITE_CONFIG);
    writeFileSync(join(dir, "vite.config.ts"), "export default {}\n");
    await ensureSubstrate(dir);
    expect(readFileSync(join(dir, "vite.config.ts"), "utf8")).toBe("export default {}\n");
  });

  // sections.legal-prose v1 (with article v1 and sectioned-document v1) installs
  // @tailwindcss/typography's CommonJS src/utils.js at lib/utils.js. Vite tries .js before .ts, so
  // `@/lib/utils` resolved to it and every section importing cn from there (link-index,
  // activity-feed, resource-list, status-list, task-list, media v2) threw "(0 , Be.cn) is not a function".
  it("`@/lib/utils` resolves to the flavor's lib/utils.ts with an item's lib/utils.js beside it", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    substrateModules(dir);
    writeFileSync(join(dir, "lib", "utils.js"), "function isObject(value) { return typeof value === 'object' && value !== null }\nmodule.exports = { isObject }\n");
    mkdirSync(join(dir, "probe"));
    writeFileSync(join(dir, "probe", "entry.tsx"), 'import { cn } from "@/lib/utils"\n\nexport function Probe() {\n  return <div className={cn("p-2", "p-4")} />\n}\n');
    const { build } = await import("vite");
    await build({
      root: dir, configFile: join(dir, "vite.config.ts"), logLevel: "silent",
      build: {
        outDir: join(dir, "probe-out"), minify: false, emptyOutDir: true,
        lib: { entry: join(dir, "probe", "entry.tsx"), formats: ["es"], fileName: () => "probe.mjs" },
        rolldownOptions: { external: [/^react(-dom)?(\/.*)?$/] },
      },
    } as any);
    const { Probe } = await import(pathToFileURL(join(dir, "probe-out", "probe.mjs")).href);
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<div class="p-4"></div>');
  }, 120_000);

  // The stock shadcn examples (item-example, aspect-ratio-example, message-example) hard-code
  // remote images (`https://avatar.vercel.sh/Project`). Only a Studio specimen build swaps them for
  // the inline placeholder its CSP (`img-src <site> data:`) allows; a consumer site keeps them.
  const AVATAR = "https://avatar.vercel.sh/Project";
  const avatarProbe = 'import Image from "next/image"\n\nexport function Probe() {\n  return <Image src="' + AVATAR + '" alt="Project" width={40} height={40} />\n}\n';

  async function buildProbe(dir: string, source: string): Promise<string> {
    mkdirSync(join(dir, "probe"), { recursive: true });
    writeFileSync(join(dir, "probe", "entry.tsx"), source);
    const { build } = await import("vite");
    await build({
      root: dir, configFile: join(dir, "vite.config.ts"), logLevel: "silent",
      build: {
        outDir: join(dir, "probe-out"), emptyOutDir: true,
        lib: { entry: join(dir, "probe", "entry.tsx"), formats: ["es"], fileName: () => "probe.mjs" },
        rolldownOptions: { external: [/^react(-dom)?(\/.*)?$/] },
      },
    } as any);
    return join(dir, "probe-out");
  }

  it("a Studio specimen build swaps a placeholder host's image for the inline placeholder: no remote host is left", async () => {
    const dir = temp();
    await ensureSubstrate(dir);
    substrateModules(dir);
    const out = await buildProbe(dir, avatarProbe);
    // What buildPass runs on every built specimen dist.
    await placeholderImages(out);
    const { Probe } = await import(pathToFileURL(join(out, "probe.mjs")).href);
    const markup = renderToStaticMarkup(createElement(Probe));
    expect(SPECIMEN_IMAGE_PLACEHOLDER).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
    expect(markup).toContain(`src="${SPECIMEN_IMAGE_PLACEHOLDER}"`);
    expect(markup).not.toContain("avatar.vercel.sh");
    expect(readFileSync(join(out, "probe.mjs"), "utf8")).not.toContain("avatar.vercel.sh");
  }, 120_000);

  /** A substrate with a host stub and one page whose frame is `probe/item.tsx`'s Probe: what the site's static render bundles. */
  async function renderProbePage(source: string, title?: string, dir = temp()): Promise<string> {
    await ensureSubstrate(dir);
    substrateModules(dir);
    mkdirSync(join(dir, "probe"));
    writeFileSync(join(dir, "probe", "item.tsx"), source);
    mkdirSync(join(dir, "clossys"), { recursive: true });
    writeFileSync(join(dir, SUBSTRATE_HOST_FILE), "import type { ReactNode } from \"react\";\nexport function PageHost({ children }: { children?: ReactNode }) { return <>{children}</>; }\n");
    const frame = { slot: "sections.probe", key: "sections.probe", role: "frame", id: "probe", version: 1, entry: { file: "probe/item.tsx", export: "Probe" }, props: {}, copy: {}, text: {}, assets: {} };
    const page = { schema: "clossys.bound-page/1", id: "probe", frame, sections: [], parts: [] } as unknown as BoundPage;
    return renderBoundPage(page, dir, title);
  }

  it("the static per-route HTML titles the document with the Writer title text, and leaves no render bundle in the substrate", async () => {
    const dir = temp();
    const html = await renderProbePage("export function Probe() {\n  return <p>probe</p>\n}\n", "Plain <Studio> & home", dir);
    expect(html).toContain("<title>Plain &lt;Studio&gt; &amp; home</title>");
    expect(html).not.toContain("<title>probe</title>");
    // The bundle imports the host React by its absolute path: a release copies the substrate, so it must not stay there.
    expect(readdirSync(join(dir, INSTALL_STATE_DIR)).filter(name => name.startsWith("render-"))).toEqual([]);
    // The substrate's machine folder is not the consumer layout's legacy root state folder.
    expect(existsSync(join(dir, ".clossys"))).toBe(false);
    expect(await renderProbePage("export function Probe() {\n  return <p>probe</p>\n}\n")).not.toContain("<title>");
  }, 120_000);

  it("a real site's static per-route HTML keeps a placeholder host's image as the item wrote it", async () => {
    const html = await renderProbePage(avatarProbe);
    expect(html).toContain(`src="${AVATAR}"`);
    expect(html).not.toContain("data:image/svg+xml");
  }, 120_000);

  it("the static per-route HTML builds next/image unoptimized, as the client bundle does (no /_next/image)", async () => {
    const html = await renderProbePage('import Image from "next/image"\n\nexport function Probe() {\n  return <Image src="/photo.png" alt="Photo" width={40} height={40} />\n}\n');
    expect(html).not.toContain("/_next/image");
    expect(html).toContain('src="/photo.png"');
  }, 120_000);
});
