import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConfigError, defineConfig } from "./config.js";
import { loadConfig } from "./config/load.js";

let root: string;
const config = () => ({ id: "example", archetype: "product-saas", locales: { default: "en", supported: ["en"] }, targets: { site: { app: "apps/site", format: "web.page.responsive", publication: "site" } } });
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-config-")); await mkdir(join(root, "clossys")); await mkdir(join(root, "apps/site"), { recursive: true }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function write(value: unknown, wrapper = true) {
  await writeFile(join(root, "clossys/clossys.config.ts"), wrapper
    ? `import { defineConfig } from "@clossys/producer/config";\nexport default defineConfig(${JSON.stringify(value)});\n`
    : `export default ${JSON.stringify(value)};\n`);
}
async function snapshot(path: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const name of (await readdir(path)).sort()) {
    const file = join(path, name), info = await stat(file);
    result.push({ path: relative(root, file), mtime: info.mtimeMs, hash: info.isFile() ? createHash("sha256").update(await readFile(file)).digest("hex") : null });
    if (info.isDirectory()) result.push(...await snapshot(file));
  }
  return result;
}
it("loads the documented type-only defineConfig module without writing", async () => {
  const expected = defineConfig(config()); await write(expected); const before = await snapshot(root);
  expect(await loadConfig(root)).toEqual(expected); expect(await snapshot(root)).toEqual(before);
});
it("accepts a plain literal default and erased satisfies annotation", async () => {
  await write(config(), false); expect(await loadConfig(root)).toEqual(config());
  await writeFile(join(root, "clossys/clossys.config.ts"), `import type { ProducerConfig } from "@clossys/producer/config";\nexport default ${JSON.stringify(config())} satisfies ProducerConfig;\n`);
  expect(await loadConfig(root)).toEqual(config());
});
it.each([
  { extra: true },
  { locales: { default: "ar", supported: ["en"] } },
  { targets: { site: { app: "../site", format: "web.page.responsive", publication: "site" } } },
  { targets: { site: { app: "apps/site", format: "unknown", publication: "site" } } },
  { agents: ["unknown"] },
  { studio: { port: 65536 } },
  { bridge: { tools: [] } },
])("refuses invalid config data %#", async (change) => {
  await write({ ...config(), ...change }); await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 });
});
it("rejects unknown nested target keys and missing target directories", async () => {
  await write({ ...config(), targets: { site: { ...config().targets.site, unexpected: true } } });
  await expect(loadConfig(root)).rejects.toBeInstanceOf(ConfigError);
  await write({ ...config(), targets: { missing: { ...config().targets.site, app: "apps/missing" } } });
  await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 });
});
it("rejects a target directory whose real path leaves the repository", async () => {
  const outside = await mkdtemp(join(tmpdir(), "producer-outside-"));
  try { await symlink(outside, join(root, "apps/escape")); await write({ ...config(), targets: { site: { ...config().targets.site, app: "apps/escape" } } }); await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 }); }
  finally { await rm(join(root, "apps/escape")); await rm(outside, { recursive: true, force: true }); }
});
it("admits only the exact internal Studio target exception", async () => {
  await mkdir(join(root, "packages/producer/studio"), { recursive: true });
  const studio = { ...config().targets.site, app: "packages/producer/studio", publication: "studio" };
  await write({ ...config(), targets: { studio } }); expect((await loadConfig(root)).targets.studio).toEqual(studio);
  await write({ ...config(), targets: { site: studio } }); await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 });
});
it("refuses imperative code without executing it", async () => {
  const path = join(root, "clossys/clossys.config.ts");
  await writeFile(path, `import { writeFileSync } from "node:fs"; writeFileSync("unexpected", "bad"); export default ${JSON.stringify(config())};`);
  const before = await snapshot(root); await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 }); expect(await snapshot(root)).toEqual(before);
  await writeFile(path, `export default (() => (${JSON.stringify(config())}))();`); await expect(loadConfig(root)).rejects.toMatchObject({ exitCode: 2 });
});
