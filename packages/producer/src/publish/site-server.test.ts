import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { specimenRoots } from "./publish.js";
import { specimenMount } from "./site-server.js";
import { canonicalLibrary } from "../specimen/__fixtures__/canonical-library.js";

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const temps: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => { for (const close of closers) close(); for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "producer-site-server-"))); temps.push(dir); return dir; };

describe("specimen mount", () => {
  it("serves /__specimen over canonical records after removing legacy stores", async () => {
    const consumer = await canonicalLibrary(join(temp(), "clossys"));
    const mount = (await specimenMount({ records: [consumer], workspace }))!;
    const server = createServer(async (request, response) => { if (!await mount(request, response)) response.writeHead(404).end(); });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    closers.push(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const specimen = await fetch(`${base}/__specimen?element=sample-card&theme=neutral`);
    expect(specimen.status).toBe(200);
    expect(await specimen.text()).toContain("<html");
    expect((await fetch(`${base}/__specimen?element=missing`)).status).toBe(404);
  }, 60_000);

  it("mounts nothing without roots", async () => {
    expect(await specimenMount({})).toBeUndefined();
  });

  it("defaults the roots to the canonical consumer", async () => {
    const root = temp();
    expect(specimenRoots(root)).toEqual([]);
    mkdirSync(join(root, "clossys", "library"), { recursive: true });
    expect(specimenRoots(root)).toEqual([]);
    await canonicalLibrary(join(root, "clossys"));
    expect(specimenRoots(root)).toEqual([join(root, "clossys")]);
    expect(specimenRoots(root, ["lib"])).toEqual([join(root, "lib")]);
  });
});
