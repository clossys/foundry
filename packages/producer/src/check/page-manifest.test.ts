import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPageManifest } from "./page-manifest.js";

const directory = mkdtempSync(join(tmpdir(), "producer-page-manifest-"));
let sequence = 0;
const valid = () => ({ schemaVersion: 1, sourceHead: "a".repeat(40), pages: [{ url: "http://127.0.0.1:4300/agents/designer", cellIds: ["tokens.color.accent"] }] });
function file(value: unknown): string {
  const path = join(directory, `manifest-${++sequence}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("generated page inventory contract", () => {
  it("accepts a pinned, explicit canonical inventory", async () => {
    const manifest = valid();
    await expect(readPageManifest(file(manifest))).resolves.toEqual(manifest);
  });

  it("accepts explicit empty cell inventory and loopback IPv6 without inventing identifiers", async () => {
    const manifest = valid();
    manifest.pages = [{ url: "http://[::1]:4300/", cellIds: [] }];
    await expect(readPageManifest(file(manifest))).resolves.toEqual(manifest);
  });

  it.each([
    () => null,
    () => [],
    () => ({ ...valid(), schemaVersion: 2 }),
    () => ({ ...valid(), sourceHead: "short" }),
    () => ({ ...valid(), pages: [] }),
    () => ({ ...valid(), pages: [null] }),
    () => ({ ...valid(), pages: [{ url: "http://127.0.0.1:4300" }] }),
    () => ({ ...valid(), pages: [{ url: "http://127.0.0.1:4300", cellIds: [""] }] }),
    () => ({ ...valid(), pages: [{ url: "http://127.0.0.1:4300", cellIds: ["id", "id"] }] }),
    () => ({ ...valid(), pages: [{ url: "http://127.0.0.1:4300", cellIds: [], skip: true }] }),
    () => ({ ...valid(), pass: true }),
    () => ({ ...valid(), pages: [valid().pages[0], valid().pages[0]] }),
    () => ({ ...valid(), pages: [{ url: "http://192.0.2.1/", cellIds: [] }] }),
    () => ({ ...valid(), pages: [{ url: "http://user:password@localhost:4300/", cellIds: [] }] }),
    () => ({ ...valid(), pages: [{ url: "file:///example", cellIds: [] }] }),
    () => ({ ...valid(), pages: [{ url: "http://localhost:4300/#unchecked", cellIds: [] }] }),
  ])("refuses incomplete, ambiguous, stale-shaped or nonlocal inputs", async mutation => {
    await expect(readPageManifest(file(mutation()))).rejects.toThrow();
  });

  it("refuses missing, empty and malformed files", async () => {
    await expect(readPageManifest(join(directory, "absent.json"))).rejects.toThrow();
    const empty = join(directory, "empty.json");
    writeFileSync(empty, "");
    await expect(readPageManifest(empty)).rejects.toThrow();
    const broken = join(directory, "broken.json");
    writeFileSync(broken, "{");
    await expect(readPageManifest(broken)).rejects.toThrow();
  });
});
