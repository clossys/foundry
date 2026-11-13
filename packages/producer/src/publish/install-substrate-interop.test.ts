/**
 * The publishing substrate imports registry items the way a Next app does. shadcn examples
 * (`item-example`, used by the link-index, activity-feed, resource-list, status-list and
 * task-list sections) default-import `next/image`, a CommonJS module flagged `__esModule`. In a
 * `"type": "module"` substrate Vite 8 hands that import the CommonJS exports object, and every
 * `<Image>` throws React error #130 ("element type is invalid ... got: object") in Studio.
 * This builds such an import with the substrate's own package.json and renders it.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { ensureSubstrate } from "./install.js";

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
});
