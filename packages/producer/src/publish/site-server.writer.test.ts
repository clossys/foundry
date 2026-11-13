import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { canonicalLibrary } from "../specimen/__fixtures__/canonical-library.js";

// Count every Writer scan the record handler makes; the scan itself runs unchanged.
const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock("../server/specimen-tree.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../server/specimen-tree.js")>();
  return { ...actual, pinnedWriterCopy: (...args: Parameters<typeof actual.pinnedWriterCopy>) => { scans.count++; return actual.pinnedWriterCopy(...args); } };
});
const { specimenMount, writerSnapshot } = await import("./site-server.js");
const { pinnedWriterCopy } = await import("../server/specimen-tree.js");

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const temps: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => { for (const close of closers) close(); for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "producer-site-writer-"))); temps.push(dir); return dir; };

async function serve(mount: NonNullable<Awaited<ReturnType<typeof specimenMount>>>): Promise<string> {
  const server = createServer(async (request, response) => { if (!await mount(request, response)) response.writeHead(404).end(); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("specimen record handler Writer reads", () => {
  it("scans Writer once for 20 concurrent record loads when given a Writer snapshot (a scan per load held the event loop per card)", async () => {
    const consumer = await canonicalLibrary(join(temp(), "clossys"));
    let snapshot: Readonly<Record<string, string>> | undefined;
    const mount = (await specimenMount({ records: [consumer], workspace, writerCopy: () => snapshot ??= pinnedWriterCopy(consumer) }))!;
    const base = await serve(mount);
    scans.count = 0;
    const pages = await Promise.all(Array.from({ length: 20 }, () => fetch(`${base}/__specimen?element=sample-card&theme=neutral`)));
    expect(pages.map(page => page.status)).toEqual(Array(20).fill(200));
    // The fixture's card declares Writer copy, so every load reads it: through the snapshot, never a scan of its own.
    expect(scans.count).toBe(1);
  }, 60_000);

  it("keeps one Writer snapshot until refreshed, then scans again", async () => {
    const consumer = await canonicalLibrary(join(temp(), "clossys"));
    const writer = writerSnapshot(consumer);
    scans.count = 0;
    const first = writer.read();
    expect(writer.read()).toBe(first);
    expect(scans.count).toBe(1);
    writer.refresh();
    expect(writer.read()).toEqual(first);
    expect(scans.count).toBe(2);
  });
});
