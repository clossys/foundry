import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

const dirs: string[] = [];

function evidence(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "messenger-check-"));
  dirs.push(dir);
  const path = join(dir, "evidence.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function record(windowClosesAt: string, deliveredAt?: string) {
  return {
    intentId: "intent-1",
    authorization: {
      id: "authorization-1",
      intentId: "intent-1",
      policy: "transactional-v1",
      authorizedAt: "2026-08-23T09:59:00.000Z",
    },
    windowOpensAt: "2026-08-23T10:00:00.000Z",
    windowClosesAt,
    ...(deliveredAt === undefined ? {} : {
      observation: {
        eventId: "event-1",
        evidenceSource: "signed-provider-webhook",
        outcome: "delivered",
        observedAt: "2026-08-23T10:09:00.000Z",
        deliveredAt,
      },
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("messenger-check delivery-closure", () => {
  it("returns 0 for a satisfied observed metric", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z", "2026-08-23T10:04:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(0);
  });

  it("returns 1 for a measured violation", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(1);
  });

  it("returns 2 when no intent is due", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = evidence({
      evaluatedAt: "2026-08-23T10:01:00.000Z",
      setpoint: 1,
      records: [record("2026-08-23T10:05:00.000Z")],
    });
    expect(main(["delivery-closure", path])).toBe(2);
  });

  it("returns 2 for unreadable, malformed, or schema-invalid evidence", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main(["delivery-closure", "/not/a/real/evidence-file.json"])).toBe(2);
    expect(main(["delivery-closure", evidence({ records: [] })])).toBe(2);
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
describe("messenger-check bin entry point (installed-symlink topology)", () => {
  let binPath: string;
  let installRoot: string;
  const evidenceDirs: string[] = [];

  beforeAll(() => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
    const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`messenger build failed: ${built.stderr || built.stdout}`);
    const realCli = join(packageRoot, "dist", "cli.js");

    // Reproduce the consumer topology, not the repo topology: a `.bin` directory
    // holding a symlink named after the declared `bin` entry, pointing at the real
    // compiled file — exactly what `npm install` creates under `node_modules/.bin`.
    // This directory lives for the whole describe block (cleaned in afterAll), not
    // per-test (afterEach) — it is shared install state, not per-test evidence.
    installRoot = mkdtempSync(join(tmpdir(), "messenger-check-install-"));
    const dotBin = join(installRoot, "node_modules", ".bin");
    mkdirSync(dotBin, { recursive: true });
    binPath = join(dotBin, "messenger-check");
    symlinkSync(realCli, binPath);
  });

  afterAll(() => {
    rmSync(installRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const dir of evidenceDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function evidenceFile(value: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "messenger-check-bin-evidence-"));
    evidenceDirs.push(dir);
    const path = join(dir, "evidence.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  it("prints usage and exits 0 for --help (the exact #909 reproduction)", () => {
    const result = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: messenger-check delivery-closure");
  });

  it("clean case: exits 0 with a non-empty satisfied report", () => {
    const path = evidenceFile({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [
        {
          intentId: "intent-1",
          authorization: {
            id: "authorization-1",
            intentId: "intent-1",
            policy: "transactional-v1",
            authorizedAt: "2026-08-23T09:59:00.000Z",
          },
          windowOpensAt: "2026-08-23T10:00:00.000Z",
          windowClosesAt: "2026-08-23T10:05:00.000Z",
          observation: {
            eventId: "event-1",
            evidenceSource: "signed-provider-webhook",
            outcome: "delivered",
            observedAt: "2026-08-23T10:09:00.000Z",
            deliveredAt: "2026-08-23T10:04:00.000Z",
          },
        },
      ],
    });
    const result = spawnSync(process.execPath, [binPath, "delivery-closure", path], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied" });
  });

  it("red case: exits 1 with a non-empty violated report", () => {
    const path = evidenceFile({
      evaluatedAt: "2026-08-23T10:10:00.000Z",
      setpoint: 1,
      records: [
        {
          intentId: "intent-1",
          authorization: {
            id: "authorization-1",
            intentId: "intent-1",
            policy: "transactional-v1",
            authorizedAt: "2026-08-23T09:59:00.000Z",
          },
          windowOpensAt: "2026-08-23T10:00:00.000Z",
          windowClosesAt: "2026-08-23T10:05:00.000Z",
        },
      ],
    });
    const result = spawnSync(process.execPath, [binPath, "delivery-closure", path], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated" });
  });
});

