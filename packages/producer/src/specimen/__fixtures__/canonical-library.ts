/** Native migration of neutral payload fixtures; old stores are removed after conversion. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readLibrary } from "../../migrate/sources.js";
import { planMigration, writePlan } from "../../migrate/slots.js";
import { designerIa, jsonBytes, withExtensions } from "../../records/slot-model/index.js";

export async function canonicalLibrary(consumer: string): Promise<string> {
  cpSync(fileURLToPath(new URL("./library/", import.meta.url)), join(consumer, "library"), { recursive: true });
  consumer = realpathSync(consumer);
  const versions = readLibrary(join(consumer, "library"));
  const history = versions.map((row, i) => ({ id: `e${i}`, at: "2026-10-31T00:00:00Z", by: "fixture", action: "pin", slot: row.slot, element: row.element, version: row.version, hash: row.record.hash }));
  const pins = Object.fromEntries(versions.map((row, i) => [row.slot, { element: row.element, version: row.version, hash: row.record.hash, event: `e${i}` }]));
  writeFileSync(join(consumer, "selection.json"), jsonBytes({ pins, history }));
  await migrateFixtureLibrary(consumer);
  rmSync(join(consumer, "library"), { recursive: true });
  rmSync(join(consumer, "selection.json"));
  return consumer;
}

/** Convert only Designer fixture records; other agents keep their test inputs. */
export async function migrateFixtureLibrary(consumer: string): Promise<void> {
  consumer = realpathSync(consumer);
  const versions = readLibrary(join(consumer, "library"));
  // Only the Designer inputs belong to this fixture conversion. Other agents'
  // legacy transport fixtures deliberately exercise their own parser contracts.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "specimen-migration-")));
  try {
    cpSync(join(consumer, "library"), join(scratch, "library"), { recursive: true });
    if (existsSync(join(consumer, "selection.json"))) cpSync(join(consumer, "selection.json"), join(scratch, "selection.json"));
    mkdirSync(join(scratch, "agents/designer"), { recursive: true });
    writeFileSync(join(scratch, "agents/designer/ia.json"), jsonBytes(withExtensions("designer", designerIa().ia, versions.map(row => row.slot))));
    const plan = await planMigration(scratch);
    writePlan({ ...plan, consumer, files: new Map([...plan.files].filter(([path]) => path.startsWith("agents/designer/"))) });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
