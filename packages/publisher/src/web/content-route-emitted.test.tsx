/** @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { createContentRouteManifest, emitContentRoutePage } from "./content-route-source.js";
import { contentRouteFixture, writerField } from "./__fixtures__/content-route.js";

it("compiles and executes the emitted async page against the public isolated package entry", async () => {
  const legacy = contentRouteFixture({ pageMeta: [writerField("title", "Sign in"), writerField("description", "Continue to your account.")] });
  const input = {
    ...legacy,
    registry: { ...legacy.registry, workspace: { ...legacy.registry.workspace,
      deployTargets: legacy.registry.workspace.deployTargets.map(target => ({ ...target, origin: "https://example.test" })),
    } },
    publishing: {
      brand: "Example",
      manifest: { defaultLocale: "en", locales: [{ tag: "en", dir: "ltr" as const, state: "active" as const }], fallback: {} },
      bodyServedLocales: { en: ["en"] }, existingUrls: ["https://example.test/sign-in"],
    },
  };
  const loader = { file: "src/content-loader.ts", export: "loadContentRoute" };
  const route = createContentRouteManifest({ registry: input.registry, locale: input.locale, loader }).routes[0]!;
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const consumer = await mkdtemp(join(tmpdir(), "publisher-content-route-"));
  try {
    const pageFile = resolve(consumer, route.source.file), loaderFile = resolve(consumer, loader.file);
    // Package lookup starts from a real consumer directory and reaches the actual
    // linked packages. A nonexistent stdin resolveDir cannot provide that lookup.
    await mkdir(dirname(pageFile), { recursive: true });
    await mkdir(dirname(loaderFile), { recursive: true });
    await symlink(resolve(testDirectory, "../../../../node_modules"), join(consumer, "node_modules"), "dir");
    await writeFile(pageFile, emitContentRoutePage(route));
    await writeFile(loaderFile, `export async function loadContentRoute() { return ${JSON.stringify(input)}; }`);
    const bundleFile = join(consumer, "content-route.mjs");
    const result = await build({
      entryPoints: [pageFile], absWorkingDir: consumer, outfile: bundleFile,
      bundle: true, write: true, metafile: true, platform: "node", format: "esm", jsx: "automatic", target: "node22",
      external: ["react", "react/*", "react-dom", "react-dom/*"],
    });
    expect(Object.keys(result.metafile!.inputs).some(file => file.replaceAll("\\", "/").endsWith("/publisher/dist/web/content-route.js"))).toBe(true);
    // Execute native ESM in Node rather than Vitest's VM, preserving Designer
    // top-level await and resolving external React through the consumer link.
    const runnerFile = join(consumer, "render-content-route.mjs");
    await writeFile(runnerFile, 'import { renderToStaticMarkup } from "react-dom/server";\nimport ContentPage from "./content-route.mjs";\nprocess.stdout.write(renderToStaticMarkup(await ContentPage()));\n');
    const { stdout: html } = await promisify(execFile)(process.execPath, [runnerFile], { cwd: consumer, encoding: "utf8", timeout: 20_000 });
    expect(html).toContain('data-ds-leaf="frames.auth-shell"');
    expect(html).toContain('data-ds-leaf="sections.empty-state"');
    expect(html).toContain("<title>Sign in · Example</title>");
    expect(html).toContain("Sign in to continue"); expect(html).toContain("Skip to sign-in content");
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}, 30_000);
