import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { readPinnedPublication } from "./pinned-publication.js";

// The one slot reader (records/slots.ts) feeds Publisher's pure projection. These cases
// pin the refusals that belong to the reader: links and drift in the slot model.
const repository = fileURLToPath(new URL("../../../../clossys/", import.meta.url));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function temp() { const path = await realpath(await mkdtemp(join(tmpdir(), "producer-pinned-publication-"))); roots.push(path); return path; }
async function consumer() {
  const root = await temp(), clossys = join(root, "clossys");
  await cp(join(repository, "agents", "publisher"), join(clossys, "agents", "publisher"), { recursive: true });
  return clossys;
}
const page = (clossys: string) => join(clossys, "agents", "publisher", "page.home");
async function pinned(clossys: string) { return JSON.parse(await readFile(join(page(clossys), "pin.json"), "utf8")).candidate as string; }

it("projects the repository's own Studio publication through the one reader", async () => {
  const fromRepository = await readPinnedPublication(repository, "studio");
  const fromCopy = await readPinnedPublication(await consumer(), "studio");
  expect(fromRepository.map.publicationId).toBe("studio");
  expect(fromRepository.routePack?.routes.length).toBeGreaterThan(0);
  expect(fromCopy).toEqual(fromRepository);
});

it("refuses a symlinked pinned candidate", async () => {
  const clossys = await consumer(), selected = join(page(clossys), "candidates", await pinned(clossys));
  const outside = join(await temp(), "candidate.json");
  await writeFile(outside, await readFile(selected)); await rm(selected); await symlink(outside, selected);
  await expect(readPinnedPublication(clossys, "studio")).rejects.toThrow(/Symbolic links are not followed/);
});

it("refuses a symlinked slot folder", async () => {
  const clossys = await consumer(), outside = await temp();
  await cp(page(clossys), join(outside, "page.home"), { recursive: true });
  await rm(page(clossys), { recursive: true }); await symlink(join(outside, "page.home"), page(clossys));
  await expect(readPinnedPublication(clossys, "studio")).rejects.toThrow(/Symbolic links are not followed/);
});

it("refuses pinned byte drift", async () => {
  const clossys = await consumer(), selected = join(page(clossys), "candidates", await pinned(clossys));
  await writeFile(selected, `${await readFile(selected, "utf8")} `);
  await expect(readPinnedPublication(clossys, "studio")).rejects.toThrow(/hash drift/);
});
