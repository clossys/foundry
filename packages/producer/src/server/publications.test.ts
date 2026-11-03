import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agentModule, agentRoot } from "./cells.js";
import { startProducerServer, type ProducerServer } from "./index.js";
import { consumerApps } from "./publications.js";

// Flat Publisher slots: agents/publisher/<slot-id>/{slot.json,candidates/,pin.json}.
const fixture = fileURLToPath(new URL("../publish/__fixtures__/install-consumer/clossys/agents/publisher/", import.meta.url));
let root: string;
let server: ProducerServer | undefined;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "producer-publications-"))); });
afterEach(async () => { await server?.close(); server = undefined; await rm(root, { recursive: true, force: true }); });
async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(base: string, prefix = "") {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(join(base, entry.name), path);
      else files[path] = (await readFile(join(base, entry.name))).toString("base64");
    }
  }
  await walk(directory); return files;
}
const slot = () => join(agentRoot(root, "publisher"), "publication.example-site");
async function author() { await cp(fixture, agentRoot(root, "publisher"), { recursive: true }); }
/** Rewrite the pinned publication candidate and re-pin its exact bytes. */
async function repin(edit: (candidate: any) => unknown) {
  const file = join(slot(), "candidates/publication-v1.json");
  const next = edit(JSON.parse(await readFile(file, "utf8")));
  const bytes = typeof next === "string" ? next : JSON.stringify(next, null, 2) + "\n";
  await writeFile(file, bytes);
  const pin = JSON.parse(await readFile(join(slot(), "pin.json"), "utf8"));
  await writeFile(join(slot(), "pin.json"), JSON.stringify({ ...pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2) + "\n");
}

it("projects the pinned publication slot on each GET without compiling or writing the consumer", async () => {
  await author();
  await repin(candidate => ({ ...candidate, meta: { ...candidate.meta, tree: { ...candidate.meta.tree, name: "Example site" } } }));
  const childEntry = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/studio-child.mjs");
  server = await startProducerServer({ root, port: 0, studioEntry: childEntry, handleSignals: false });
  const before = await snapshot(root);
  const first = await (await fetch(`${server.url}/api/apps`)).json() as any;
  expect(first).toMatchObject({ state: "ready", publications: [{ id: "example-site", title: "Example site", source: "slots", format: "web.page.responsive" }] });
  const projections = await agentModule("publisher", "content-map/index.js");
  expect(first.publications[0].commands).toEqual(projections.projectCommands(first.publications[0].map));
  expect(await snapshot(root)).toEqual(before);
  await repin(candidate => ({ ...candidate, meta: { ...candidate.meta, tree: { ...candidate.meta.tree, name: "Renamed site" } } }));
  const changed = await snapshot(root);
  expect((await (await fetch(`${server.url}/api/apps`)).json() as any).publications[0].title).toBe("Renamed site");
  expect(await snapshot(root)).toEqual(changed);
  await rm(join(slot(), "pin.json"));
  expect(await (await fetch(`${server.url}/api/apps`)).json()).toMatchObject({ state: "missing", publications: [] });
});

it("reports missing publications and fails closed for drifted, malformed and linked slots", async () => {
  expect(await consumerApps(root)).toMatchObject({ state: "missing", publications: [] });
  await author();
  expect(await consumerApps(root)).toMatchObject({ state: "ready" });
  const candidate = join(slot(), "candidates/publication-v1.json");
  await writeFile(candidate, (await readFile(candidate, "utf8")) + " ");
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await repin(() => "{}");
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await rm(agentRoot(root, "publisher"), { recursive: true });
  const outside = join(root, "outside"); await cp(fixture, outside, { recursive: true });
  await symlink(outside, agentRoot(root, "publisher"));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
});

it("retains only declared app targets and refuses unavailable, escaping and aliased app mappings", async () => {
  await author();
  expect((await consumerApps(root)).publications[0]!.target).toBeUndefined();
  await mkdir(join(root, "apps/portal"), { recursive: true });
  await repin(candidate => ({ ...candidate, routePack: { ...candidate.routePack, appDir: "apps/portal", defaultRoute: "about" } }));
  expect((await consumerApps(root)).publications[0]).toMatchObject({ entryId: "about", target: { appDirectory: "apps/portal", entryId: "about", path: "/about" } });
  for (const routePack of [{ appDir: "../escape" }, { defaultRoute: "unknown" }]) {
    await repin(candidate => ({ ...candidate, routePack: { ...candidate.routePack, appDir: undefined, defaultRoute: undefined, ...routePack } }));
    expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  }
  await rm(join(root, "apps/portal"), { recursive: true }); await symlink(root, join(root, "apps/portal"));
  await repin(candidate => ({ ...candidate, routePack: { ...candidate.routePack, appDir: "apps/portal", defaultRoute: undefined } }));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
});

it("exposes only an explicitly declared local app server URL", async () => {
  await author();
  await repin(candidate => ({ ...candidate, routePack: { ...candidate.routePack, devServerUrl: "http://127.0.0.1:4329" } }));
  expect((await consumerApps(root)).publications[0]!.target?.devServerUrl).toBe("http://127.0.0.1:4329/");
  for (const devServerUrl of ["https://example.test", "javascript:alert(1)", "http://user@localhost:4329/"]) {
    await repin(candidate => ({ ...candidate, routePack: { ...candidate.routePack, devServerUrl } }));
    expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  }
});

it("projects the repository's own pinned Studio publication from its slots", async () => {
  const publisher = agentRoot(root, "publisher");
  await cp(fileURLToPath(new URL("../../../../clossys/agents/publisher/", import.meta.url)), publisher, { recursive: true });
  const before = await snapshot(root);
  const apps = await consumerApps(root);
  expect(apps).toMatchObject({ state: "ready", publications: [{ id: "studio", source: "slots", format: "web.page.responsive" }] });
  const { readPinnedPublication } = await import("@clossys/publisher/content-map/slots");
  expect(apps.publications[0]!.map).toEqual((await readPinnedPublication(publisher, "studio")).map);
  expect(await snapshot(root)).toEqual(before);
});
