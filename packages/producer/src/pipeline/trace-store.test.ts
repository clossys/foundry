/**
 * The run store (`.clossys/runs/<step>.jsonl`) gains one record per distinct invocation, and each
 * record lists every file its run read, so a store grows with every `clossys ia <slot>` call (3S-ND
 * saw a 305 MB ia.jsonl, and `ia` aborted out of heap after its write). appendRecord and readStore
 * scan it line by line: these tests pin the kept-per-invocation rule and bound the memory of one
 * append under a heap far smaller than the store.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRecord, readStore, RUN_SCHEMA, RUNS_KEPT, storeFile, type RunRecord } from "./trace.js";

const TRACE = fileURLToPath(new URL("./trace.ts", import.meta.url));
let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "clossys-store-")));
  writeFileSync(join(root, ".gitignore"), "/.clossys/runs/\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A record in buildRecord's key order; `reads` entries make it as large as a whole-model ia run's. */
function record(invocation: string, run: string, reads = 1): RunRecord {
  return {
    schema: RUN_SCHEMA, run, step: "ia", invocation, argv: invocation.split(" "), start: "2026-11-14T00:00:00.000Z", end: "2026-11-14T00:00:01.000Z",
    exit: 0, head: null, tool: "@clossys/producer@0.1.0", inputs: "0".repeat(64),
    reads: Array.from({ length: reads }, (_, index) => ({ path: `clossys/agents/designer/slot-${index}/slot.json`, sha256: "a".repeat(64) })), writes: [],
  } as unknown as RunRecord;
}
const storePath = () => join(root, ...storeFile("ia").split("/"));
const runsOf = () => readStore(root, storeFile("ia")).map(entry => `${entry.line}:${entry.record.invocation}:${entry.record.run}`);

describe("run store", () => {
  it("keeps the newest RUNS_KEPT records per invocation, appending while none goes over", () => {
    expect(RUNS_KEPT).toBe(3);
    const lines = ["a", "b", "a", "a", "c"].map((invocation, index) => appendRecord(root, record(invocation, `r${index}`))!.line);
    expect(lines).toEqual([1, 2, 3, 4, 5]);
    expect(runsOf()).toEqual(["1:a:r0", "2:b:r1", "3:a:r2", "4:a:r3", "5:c:r4"]);
    // A fourth `a` drops the oldest `a`; every other line is kept, unchanged and in order.
    const before = readFileSync(storePath(), "utf8").split("\n");
    expect(appendRecord(root, record("a", "r5"))!.line).toBe(5);
    expect(runsOf()).toEqual(["1:b:r1", "2:a:r2", "3:a:r3", "4:c:r4", "5:a:r5"]);
    expect(readFileSync(storePath(), "utf8").split("\n").slice(0, 4)).toEqual([before[1], before[2], before[3], before[4]]);
  });

  it("appends after a last line with no newline, skips blank lines and still refuses a malformed line", () => {
    mkdirSync(join(root, ".clossys", "runs"), { recursive: true });
    writeFileSync(storePath(), `${JSON.stringify(record("a", "r0"))}\n\n${JSON.stringify(record("b", "r1"))}`);
    expect(appendRecord(root, record("c", "r2"))!.line).toBe(4);
    expect(runsOf()).toEqual(["1:a:r0", "3:b:r1", "4:c:r2"]);
    writeFileSync(storePath(), `${JSON.stringify(record("a", "r0"))}\n{"schema":"other"}\n`);
    expect(() => appendRecord(root, record("a", "r1"))).toThrow(/runs\/ia\.jsonl:2: schema is other/);
    writeFileSync(storePath(), `${JSON.stringify(record("a", "r0"))}\nnot json\n`);
    expect(() => appendRecord(root, record("a", "r1"))).toThrow(/runs\/ia\.jsonl:2: not a run record/);
    expect(() => readStore(root, storeFile("ia"))).toThrow(/runs\/ia\.jsonl:2: not a run record/);
  });

  it("appends to a store far larger than the heap: memory is one line, not the store", () => {
    // 120 records of about 0.65 MB, each a distinct invocation (one per slot), as `clossys ia` leaves them.
    mkdirSync(join(root, ".clossys", "runs"), { recursive: true });
    const fd = openSync(storePath(), "w");
    const template = JSON.stringify(record("INVOCATION", "RUN", 6000));
    for (let index = 0; index < 120; index++) writeSync(fd, `${template.replace("\"INVOCATION\"", JSON.stringify(`ia designer/slot-${index % 117} --contract c.json`)).replace("\"RUN\"", `"r${index}"`)}\n`);
    closeSync(fd);
    const size = statSync(storePath()).size;
    expect(size).toBeGreaterThan(64 * 1024 * 1024);
    // One new invocation (append) and one that goes over RUNS_KEPT (rewrite), under a 32 MB heap.
    const script = `const t = await import(${JSON.stringify(TRACE)});
      const make = (invocation, run) => ({ schema: t.RUN_SCHEMA, run, step: "ia", invocation, argv: [], start: "s", end: "e", exit: 0, head: null, tool: null, inputs: "0", reads: [], writes: [] });
      const first = t.appendRecord(${JSON.stringify(root)}, make("ia designer/new --contract c.json", "n1"));
      const second = t.appendRecord(${JSON.stringify(root)}, make("ia designer/slot-0 --contract c.json", "n2"));
      console.log(JSON.stringify([first.line, second.line]));`;
    const child = spawnSync(process.execPath, ["--max-old-space-size=32", "--input-type=module", "-e", script], { encoding: "utf8", maxBuffer: 1 << 20 });
    expect(child.status, child.stderr.slice(0, 600)).toBe(0);
    // slot-0, slot-1 and slot-2 each had 2 records; slot-0 now has 3, so the second append is an append too.
    expect(JSON.parse(child.stdout.trim())).toEqual([121, 122]);
    const over = spawnSync(process.execPath, ["--max-old-space-size=32", "--input-type=module", "-e", script.replace("\"n1\"", "\"n3\"").replace("\"n2\"", "\"n4\"")], { encoding: "utf8", maxBuffer: 1 << 20 });
    expect(over.status, over.stderr.slice(0, 600)).toBe(0);
    // Now slot-0 has 4: its oldest is dropped (rewrite), as is nothing else; `new` has 2.
    expect(JSON.parse(over.stdout.trim())).toEqual([123, 123]);
    expect(statSync(storePath()).size).toBeLessThan(size);
  });
});
