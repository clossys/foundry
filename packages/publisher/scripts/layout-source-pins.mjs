import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// Refresh the byte digests of each render engine's source closure (src/engines/sources/<engine>.json).
const engines = JSON.parse(await readFile(new URL("../src/engines/engines.json", import.meta.url), "utf8"));
const root = new URL("../", import.meta.url);
for (const engine of ["stack", "split", "sidebar-content", "bento"]) {
  const path = new URL(`src/engines/sources/${engine}.json`, root);
  const original = await readFile(path, "utf8"), record = JSON.parse(original);
  record.configs = engines.find(entry => entry.engine === record.engine).contract.configs.map(config => config.id);
  for (const file of record.files) file.sha256 = createHash("sha256").update(await readFile(new URL(file.path, root))).digest("hex");
  const updated = JSON.stringify(record, null, 2) + "\n";
  if (process.argv.includes("--check")) { if (original !== updated) throw new Error(`Stale engine source digests: ${engine}`); }
  else await writeFile(path, updated);
}
