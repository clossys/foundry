import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

/**
 * Runs a child process and resolves once its stdout/stderr have fully ended
 * AND the process has exited — never before.
 *
 * #1333: the equivalent `spawnSync` calls this replaces flaked in CI under
 * load with `result.status === 1` (the child really did exit 1) but
 * `result.stdout` empty — a report the exit code says exists but the
 * capture missed. `spawnSync`'s synchronous capture is implemented as its
 * own internal poll loop outside Node's normal stream machinery, and that
 * loop is what a heavily loaded CI runner's scheduling can starve.
 * `spawn()`'s stdout/stderr are ordinary `Readable` streams, whose own
 * contract (not a loop this test has to get right) guarantees every byte
 * written is delivered via `data` events before `end` fires, and this
 * helper's `close` handler — which Node fires only after the process has
 * exited AND both stdio streams have ended — cannot observe an exit code
 * before the output that produced it has been fully read. That ordering
 * guarantee is the fix; it holds regardless of scheduler pressure.
 */
function spawnCapture(command: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

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
    // dist/ was built once, before any test file started, by the package's
    // vitest globalSetup (scripts/lib/vitest-build-package.mjs). Never rebuild
    // it here: a sibling test file may be executing or packing it (#1385).
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

  it("prints usage and exits 0 for --help (the exact #909 reproduction)", async () => {
    const result = await spawnCapture(process.execPath, [binPath, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: messenger-check delivery-closure");
  });

  it("clean case: exits 0 with a non-empty satisfied report", async () => {
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
    const result = await spawnCapture(process.execPath, [binPath, "delivery-closure", path]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied" });
  });

  it("red case: exits 1 with a non-empty violated report", async () => {
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
    const result = await spawnCapture(process.execPath, [binPath, "delivery-closure", path]);
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated" });
  });
});

