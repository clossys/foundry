import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slotIndex } from "../records/slots.js";
import type { SnapshotOptions, SnapshotResult } from "../specimen/thumbnails.js";
import { flatConsumer } from "./__fixtures__/flat-consumer.js";
import { dependencyPins, parseRenderArgs, renderKey, runRenderCli } from "./render.js";

/** A stand-in for the specimen harness: records each call and writes one PNG per width. */
function fakeHarness(root: string) {
  const calls: SnapshotOptions[] = [];
  const snapshot = async (options: SnapshotOptions): Promise<SnapshotResult> => {
    calls.push(options);
    const thumbnails = (options.widths ?? [480]).map(width => {
      const path = join(root, `fake-${calls.length}-${width}.png`);
      writeFileSync(path, `png ${options.element} v${options.version} ${width}`);
      return { width, key: `fake${calls.length}`, path, healthPath: `${path}.json`, cached: false };
    });
    return { element: options.element, version: options.version ?? 0, theme: options.theme ?? "light", cache: root, thumbnails };
  };
  return { calls, snapshot };
}

describe("clossys render <slot> <candidate>", () => {
  let root: string;
  let slot: string, candidate: string, dependency: string;
  beforeAll(() => {
    root = flatConsumer(["director", "designer", "writer"]);
    const consumer = join(root, "clossys"), index = slotIndex(consumer);
    // A pinned Designer element whose every dependency is pinned and which has at least one.
    const pick = [...index.values()].find(entry => {
      if (entry.agent !== "designer" || !entry.pin?.candidate.endsWith(".json")) return false;
      const deps = dependencyPins(consumer, entry.id, index);
      return deps.unresolved.length === 0 && deps.entries.length > 0;
    });
    if (!pick) throw new Error("no pinned Designer element with resolved dependencies in the repository consumer");
    slot = pick.id; candidate = pick.pin!.candidate;
    dependency = dependencyPins(consumer, slot, index).entries[0]!.slot;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("renders once, then reuses the render cached by (candidate sha256, dependency pin-set hash)", async () => {
    const harness = fakeHarness(root);
    const first = await runRenderCli([slot, candidate, "--width", "480,960"], root, harness.snapshot);
    expect(first.exitCode, first.message).toBe(0);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({ element: `${slot}/${/^(.*)-v\d+\.json$/.exec(candidate)![1]}`, version: Number(/-v(\d+)\.json$/.exec(candidate)![1]), widths: [480, 960] });
    expect(first.output!.renders.map(row => [row.width, row.cached])).toEqual([[480, false], [960, false]]);
    for (const row of first.output!.renders) {
      expect(existsSync(row.path)).toBe(true);
      expect(row.key).toBe(renderKey({ candidateSha: first.output!.sha256, pinSetHash: first.output!.pinSetHash, theme: "light", width: row.width }));
      expect(JSON.parse(readFileSync(row.path.replace(/\.png$/, ".json"), "utf8"))).toMatchObject({ slot, candidate, sha256: first.output!.sha256, pinSetHash: first.output!.pinSetHash });
    }
    expect(first.output!.dependencies.map(row => row.slot)).toContain(dependency);

    const again = await runRenderCli([slot, candidate, "--width", "480,960"], root, harness.snapshot);
    expect(again.exitCode, again.message).toBe(0);
    expect(harness.calls).toHaveLength(1);
    expect(again.output!.renders.every(row => row.cached)).toBe(true);

    // A new width renders only that width.
    const wider = await runRenderCli([slot, candidate, "--width", "480,1280"], root, harness.snapshot);
    expect(wider.output!.renders.map(row => [row.width, row.cached])).toEqual([[480, true], [1280, false]]);
    expect(harness.calls[1]!.widths).toEqual([1280]);
  });

  it("a dependency repin is a new pin-set hash and a new render", async () => {
    const harness = fakeHarness(root);
    const before = await runRenderCli([slot, candidate], root, harness.snapshot);
    expect(before.exitCode, before.message).toBe(0);
    const pinPath = join(root, "clossys", "agents", slotIndex(join(root, "clossys")).get(dependency)!.agent, dependency, "pin.json");
    const original = readFileSync(pinPath, "utf8");
    try {
      const pin = JSON.parse(original);
      writeFileSync(pinPath, `${JSON.stringify({ ...pin, sha256: "0".repeat(64) }, null, 2)}\n`);
      const after = await runRenderCli([slot, candidate], root, harness.snapshot);
      expect(after.exitCode, after.message).toBe(0);
      expect(after.output!.pinSetHash).not.toBe(before.output!.pinSetHash);
      expect(after.output!.renders[0]!.cached).toBe(false);
      expect(after.output!.renders[0]!.key).not.toBe(before.output!.renders[0]!.key);
    } finally { writeFileSync(pinPath, original); }
    const restored = await runRenderCli([slot, candidate], root, harness.snapshot);
    expect(restored.output!.renders[0]!.cached).toBe(true);
  });

  it("an unpinned dependency is refused (exit 1): the key would not name what the render shows", async () => {
    const agent = slotIndex(join(root, "clossys")).get(dependency)!.agent;
    const pinPath = join(root, "clossys", "agents", agent, dependency, "pin.json");
    const original = readFileSync(pinPath, "utf8");
    try {
      rmSync(pinPath);
      const harness = fakeHarness(root);
      const result = await runRenderCli([slot, candidate], root, harness.snapshot);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain(`${dependency} (unpinned)`);
      expect(harness.calls).toHaveLength(0);
    } finally { writeFileSync(pinPath, original); }
  });

  it("refuses usage errors with exit 2: a missing candidate, a non-element name, a Writer slot", async () => {
    const harness = fakeHarness(root);
    expect((await runRenderCli([slot], root, harness.snapshot)).exitCode).toBe(2);
    expect((await runRenderCli([slot, "nope-v999.json"], root, harness.snapshot)).message).toContain(`has no candidate nope-v999.json`);
    expect((await runRenderCli([slot, "notes.md"], root, harness.snapshot)).exitCode).toBe(2);
    const writer = [...slotIndex(join(root, "clossys")).values()].find(entry => entry.agent === "writer" && entry.candidates.length)!;
    const refused = await runRenderCli([writer.id, writer.candidates[0]!], root, harness.snapshot);
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain("copy renders inside its pinned frame and section");
    expect(harness.calls).toHaveLength(0);
    expect(() => parseRenderArgs([slot, candidate, "--width", "10"])).toThrow(/--width/);
    expect(() => parseRenderArgs([slot, candidate, "extra"])).toThrow(/unexpected extra/);
  });
});
