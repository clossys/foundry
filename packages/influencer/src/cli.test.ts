import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { AudienceResponseEvent, ResponseYieldInput, ResponseYieldRecord } from "./types.js";

const dirs: string[] = [];

function responseEvent(id: string): AudienceResponseEvent {
  return {
    eventId: id,
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    actionKind: "qualified-reply",
    occurredAt: "2026-08-23T10:05:00.000Z",
  };
}

function responseYieldRecord(events: AudienceResponseEvent[] = [responseEvent("response-one")]): ResponseYieldRecord {
  return {
    intentId: "intent-one",
    subjectId: "product-one",
    actionKind: "publish",
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    channelId: "channel-one",
    authority: {
      id: "authority-one", intentId: "intent-one", subjectId: "product-one", actorId: "agent-one",
      humanOwnerId: "owner-one", allowedActions: ["publish"], channelIds: ["channel-one"],
      issuedAt: "2026-08-23T09:00:00.000Z", expiresAt: "2026-08-23T11:00:00.000Z", paidSpendCeiling: 0,
    },
    windowOpensAt: "2026-08-23T10:00:00.000Z",
    windowClosesAt: "2026-08-23T10:10:00.000Z",
    exposures: { state: "observed", evidenceSource: "channel-report", observedAt: "2026-08-23T10:11:00.000Z", count: 2_000 },
    responses: { state: "observed", evidenceSource: "response-report", observedAt: "2026-08-23T10:11:00.000Z", events },
  };
}

function responseYieldInput(records: ResponseYieldRecord[] = [responseYieldRecord()]): ResponseYieldInput {
  return {
    evaluatedAt: "2026-08-23T10:12:00.000Z",
    setpointPerThousand: 2,
    minimumExposureCount: 1_000,
    qualifiedActionKinds: ["qualified-reply"],
    records,
  };
}

function evidence(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "influencer-check-"));
  dirs.push(dir);
  const path = join(dir, "evidence.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("influencer-check response-yield", () => {
  it("returns 1 for a measured violation", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(["response-yield", evidence(responseYieldInput())])).toBe(1);
  });

  it("returns 0 for a satisfied metric", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const next = responseYieldRecord(Array.from({ length: 5 }, (_, index) => ({
      eventId: `response-${index}`,
      experimentId: "experiment-one",
      contentId: "content-one",
      publicationId: "publication-one",
      actionKind: "qualified-reply",
      occurredAt: "2026-08-23T10:05:00.000Z",
    })));
    expect(main(["response-yield", evidence(responseYieldInput([next]))])).toBe(0);
  });

  it("returns 2 for indeterminate or invalid evidence", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const next = responseYieldRecord();
    next.exposures = { state: "could-not-read", evidenceSource: "channel-report", note: "unreachable" };
    expect(main(["response-yield", evidence(responseYieldInput([next]))])).toBe(2);
    expect(main(["response-yield", evidence({ records: [] })])).toBe(2);
    expect(main([])).toBe(2);
  });
});

// #909: the previous guard — `import.meta.url === \`file://${process.argv[1]}\`` —
// is never true for an installed CLI. `npm install` publishes a `bin` entry as a
// symlink under `node_modules/.bin`; `import.meta.url` always resolves that symlink
// to the real module path while `process.argv[1]` stays the symlink path, so the two
// were never equal and `main()` never ran — every invocation silently exited 0 with
// zero bytes of output, including `--help` and invalid input. An in-process `main()`
// test (above) cannot see this: it never touches `process.argv[1]` or a symlink, so
// it passes whether or not the guard works. This spawns the *built* `dist/cli.js`
// through a `node_modules/.bin`-shaped symlink — the actual consumer topology — to
// prove the guard fires there.
describe("influencer-check bin entry point (installed-symlink topology)", () => {
  let binPath: string;
  let installRoot: string;
  const evidenceDirs: string[] = [];

  beforeAll(() => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
    const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`influencer build failed: ${built.stderr || built.stdout}`);
    const realCli = join(packageRoot, "dist", "cli.js");

    // Reproduce the consumer topology, not the repo topology: a `.bin` directory
    // holding a symlink named after the declared `bin` entry, pointing at the real
    // compiled file — exactly what `npm install` creates under `node_modules/.bin`.
    // This directory lives for the whole describe block (cleaned in afterAll), not
    // per-test (afterEach) — it is shared install state, not per-test evidence.
    installRoot = mkdtempSync(join(tmpdir(), "influencer-check-install-"));
    const dotBin = join(installRoot, "node_modules", ".bin");
    mkdirSync(dotBin, { recursive: true });
    binPath = join(dotBin, "influencer-check");
    symlinkSync(realCli, binPath);
  });

  afterAll(() => {
    rmSync(installRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const dir of evidenceDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function evidenceFile(value: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "influencer-check-bin-evidence-"));
    evidenceDirs.push(dir);
    const path = join(dir, "evidence.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  it("prints usage and exits 0 for --help (the exact #909 reproduction)", () => {
    const result = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: influencer-check response-yield");
  });

  it("red case: exits 1 with a non-empty violated report", () => {
    const path = evidenceFile(responseYieldInput());
    const result = spawnSync(process.execPath, [binPath, "response-yield", path], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated" });
  });

  it("clean case: exits 0 with a non-empty satisfied report", () => {
    const next = responseYieldRecord(Array.from({ length: 5 }, (_, index) => ({
      eventId: `response-${index}`,
      experimentId: "experiment-one",
      contentId: "content-one",
      publicationId: "publication-one",
      actionKind: "qualified-reply",
      occurredAt: "2026-08-23T10:05:00.000Z",
    })));
    const path = evidenceFile(responseYieldInput([next]));
    const result = spawnSync(process.execPath, [binPath, "response-yield", path], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied" });
  });
});
