import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadCatalog, libraryHash } from "../../catalog-core/index.js";
import { completedCatalogLibrary } from "../../catalog-core/__fixtures__/completed-catalog-library.js";
import { emitLibrary, libraryFiles, writeLibrary } from "../fs-library.js";

export const catalog = loadCatalog();
const fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-27");
/** Synthetic test setup; subsequent consumer mutations use the stamped writer. */
export async function seedLibrary(root: string): Promise<void> {
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true });
    await fs.writeFile(join(root, name), content);
  }
  await emitLibrary(root, catalog);
  await writeLibrary(root, catalog, { baseHash: libraryHash(fixture), changes: [{ op: "author", slot: "tokens.blur", tokens: { glass: { $type: "dimension", $value: { value: 18, unit: "px" } } } }] }, { command: "synthetic fixture", inputs: { leaf: "tokens.blur" } });
}
export async function temporaryLibrary() {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-agent-")));
  const root = join(directory, "library"); await seedLibrary(root);
  return { directory, root };
}
export async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(path: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name), prefix + entry.name + "/");
      else files[prefix + entry.name] = (await fs.readFile(join(path, entry.name))).toString("base64");
    }
  }
  await walk(root, ""); return files;
}
