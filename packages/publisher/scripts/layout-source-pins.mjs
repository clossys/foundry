import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const slots = JSON.parse(await readFile(new URL("../src/layouts/slots/layouts.json", import.meta.url), "utf8"));
const root = new URL("../", import.meta.url);
for (const leaf of ["stack", "split", "sidebar-content", "bento"]) {
  const path = new URL(`src/layouts/fills/foundry/layouts.${leaf}.json`, root);
  const original = await readFile(path, "utf8"), fill = JSON.parse(original);
  fill.configs = slots.find(slot => slot.id === fill.leaf).contract.configs.map(config => config.id);
  for (const file of fill.pin.files) file.sha256 = createHash("sha256").update(await readFile(new URL(file.path, root))).digest("hex");
  const updated = JSON.stringify(fill, null, 2) + "\n";
  if (process.argv.includes("--check")) { if (original !== updated) throw new Error(`Stale authored Layout source pin: ${leaf}`); }
  else await writeFile(path, updated);
}
