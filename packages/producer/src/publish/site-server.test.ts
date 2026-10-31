import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { specimenRoots, specimenWorkspace } from "./publish.js";
import { startSiteServer } from "./site-server.js";

const library = fileURLToPath(new URL("../specimen/__fixtures__/library/", import.meta.url));
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const temps: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => { for (const close of closers) close(); for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "producer-site-server-")); temps.push(dir); return dir; };

describe("preview site server", () => {
  it("serves /__specimen beside the site when given library roots", async () => {
    const site = temp();
    writeFileSync(join(site, "index.html"), "<!doctype html><title>home</title>");
    const server = await startSiteServer(site, 0, { records: [library], workspace });
    closers.push(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/`)).text()).toContain("home");
    const specimen = await fetch(`${base}/__specimen?element=sample-card&theme=neutral`);
    expect(specimen.status).toBe(200);
    expect(await specimen.text()).toContain("<html");
    expect((await fetch(`${base}/__specimen?element=missing`)).status).toBe(404);
  }, 60_000);

  it("leaves /__specimen unmounted without roots", async () => {
    const site = temp();
    const server = await startSiteServer(site, 0);
    closers.push(() => server.close());
    expect((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/__specimen?element=sample-card`)).status).toBe(404);
  });

  it("defaults the roots to the consumer library and the workspace to an install with React", () => {
    const root = temp();
    expect(specimenRoots(root)).toEqual([]);
    mkdirSync(join(root, "clossys", "library"), { recursive: true });
    expect(specimenRoots(root)).toEqual([join(root, "clossys", "library")]);
    expect(specimenRoots(root, ["lib"])).toEqual([join(root, "lib")]);
    expect(specimenWorkspace(root)).not.toBe(join(root, "clossys"));
    mkdirSync(join(root, "clossys", "node_modules", "react"), { recursive: true });
    writeFileSync(join(root, "clossys", "node_modules", "react", "package.json"), "{}");
    expect(specimenWorkspace(root)).toBe(join(root, "clossys"));
  });
});
