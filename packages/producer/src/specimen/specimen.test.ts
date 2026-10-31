import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as publisher from "@clossys/publisher/specimen";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import {
  isSpecimenHealthMessage, parseSpecimenHealthMessage, specimenHealthValue,
  SPECIMEN_HEALTH_FIELDS, SPECIMEN_HEALTH_MESSAGE_TYPE, SPECIMEN_HEALTH_REQUEST_TYPE, SPECIMEN_HEALTH_VERSION,
  type SpecimenHealthMessage,
} from "./health-contract.js";
import { snapshotSpecimen, thumbnailKey } from "./thumbnails.js";

const records = fileURLToPath(new URL("../../../publisher/src/specimen/__fixtures__/records/", import.meta.url));
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const chrome = publisher.findChrome();
const temps: string[] = [];
afterAll(async () => { for (const dir of temps) await rm(dir, { recursive: true, force: true }); });

const sample: SpecimenHealthMessage = {
  type: SPECIMEN_HEALTH_MESSAGE_TYPE, version: SPECIMEN_HEALTH_VERSION, sequence: 1, element: "a", elementVersion: 1, kind: "visual", theme: "t:light", width: 480,
  errors: { count: 0, items: [] }, loadMs: 12, lcpMs: null, cls: 0, longTasks: { count: 0, totalMs: 0 }, weight: { jsBytes: 10, cssBytes: 20 }, atMs: 30,
};

describe("health contract", () => {
  it("matches the reporter Publisher ships", () => {
    expect(SPECIMEN_HEALTH_MESSAGE_TYPE).toBe(publisher.SPECIMEN_HEALTH_MESSAGE_TYPE);
    expect(SPECIMEN_HEALTH_REQUEST_TYPE).toBe(publisher.SPECIMEN_HEALTH_REQUEST_TYPE);
    expect(SPECIMEN_HEALTH_VERSION).toBe(publisher.SPECIMEN_HEALTH_VERSION);
    expect(SPECIMEN_HEALTH_FIELDS).toEqual(["errors", "loadMs", "lcpMs", "cls", "longTasks", "weight.jsBytes", "weight.cssBytes"]);
  });

  it("accepts a well-formed message and names each bad field", () => {
    expect(isSpecimenHealthMessage(sample)).toBe(true);
    expect(SPECIMEN_HEALTH_FIELDS.map(field => specimenHealthValue(sample, field))).toEqual([0, 12, null, 0, 0, 10, 20]);
    const bad = parseSpecimenHealthMessage({ ...sample, type: "x", cls: -1, weight: { jsBytes: 1 }, errors: { count: 1, items: [{ source: "x" }] } });
    expect(bad).toEqual({ ok: false, problems: ["type", "errors", "cls", "weight.cssBytes"] });
    expect(parseSpecimenHealthMessage(null).ok).toBe(false);
  });

  it("keys thumbnails by every input", () => {
    const base = { buildHash: "b", recordHash: "r", themeHash: "t", mode: "light" };
    const key = thumbnailKey(base);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    for (const change of [{ buildHash: "B" }, { recordHash: "R" }, { themeHash: "T" }, { mode: "dark" }]) expect(thumbnailKey({ ...base, ...change })).not.toBe(key);
  });
});

describe("clossys specimen", () => {
  it("prints usage and refuses missing inputs", async () => {
    expect(await runCli(["specimen", "--help"])).toMatchObject({ exitCode: 0 });
    expect(await runCli(["specimen", "snapshot", "--element", "x"])).toMatchObject({ exitCode: 2 });
    expect(await runCli(["specimen", "snapshot", "--records", records, "--width", "50"])).toMatchObject({ exitCode: 2 });
    expect(await runCli(["specimen", "snapshot", "--records", records, "--element", "nope", "--cache", join(tmpdir(), "unused-specimen-cache")])).toMatchObject({ exitCode: 1, message: "element nope not found" });
  });
});

describe.skipIf(!chrome)("snapshot thumbnails in Chrome", () => {
  it("renders once per content hash and width, then skips", async () => {
    const cache = await mkdtemp(join(tmpdir(), "producer-specimen-thumbs-"));
    temps.push(cache);
    const options = { records: [records], element: "sample-card", widths: [320, 480], cache, workspace, cwd: workspace };
    const first = await snapshotSpecimen(options);
    expect(first.thumbnails.map(thumb => [thumb.width, thumb.cached])).toEqual([[320, false], [480, false]]);
    for (const thumb of first.thumbnails) {
      const png = await readFile(thumb.path);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(thumb.path).toBe(join(cache, `${thumb.key}-${thumb.width}.png`));
      // Conformance: the message a real specimen posted satisfies the contract.
      expect(parseSpecimenHealthMessage(thumb.health)).toMatchObject({ ok: true });
      expect(thumb.health!.errors.count).toBe(0);
      expect(thumb.consoleErrors).toEqual([]);
    }
    const before = (await stat(first.thumbnails[0]!.path)).mtimeMs;
    const second = await snapshotSpecimen(options);
    expect(second.thumbnails.map(thumb => thumb.cached)).toEqual([true, true]);
    expect(second.thumbnails[0]!.key).toBe(first.thumbnails[0]!.key);
    expect(second.thumbnails[0]!.health?.element).toBe("sample-card");
    expect((await stat(second.thumbnails[0]!.path)).mtimeMs).toBe(before);
    const dark = await snapshotSpecimen({ ...options, theme: "neutral:dark", widths: [320] });
    expect(dark.thumbnails[0]).toMatchObject({ cached: false });
    expect(dark.thumbnails[0]!.key).not.toBe(first.thumbnails[0]!.key);
  }, 120_000);
});
