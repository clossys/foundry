import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

const dirs: string[] = [];

const audience = {
  id: "audience-one",
  name: "Maya Chen",
  description: "A product lead evaluating onboarding.",
};

function cleanKeep(overrides: Record<string, unknown> = {}) {
  return {
    speaker: "customer",
    inhabitedAs: "target-audience",
    audienceId: "audience-one",
    persona: { name: "Maya Chen" },
    stance: "I came to see whether this is for me.",
    impressions: {
      firstSeconds: "Immediate clarity.",
      isThisForMe: "yes",
      doIBelieve: "yes",
      wouldIStay: "yes",
      wouldITellAPeer: "yes",
    },
    visual: { impression: "Looks intentional." },
    verbal: { impression: "Sounds human." },
    verdict: "keep",
    ...overrides,
  };
}

function jsonPair(keep: unknown, aud = audience): [string, string] {
  const dir = mkdtempSync(join(tmpdir(), "customer-check-"));
  dirs.push(dir);
  const keepPath = join(dir, "keep.json");
  const audiencePath = join(dir, "audience.json");
  writeFileSync(keepPath, JSON.stringify(keep));
  writeFileSync(audiencePath, JSON.stringify(aud));
  return [keepPath, audiencePath];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("customer-check main()", () => {
  it("returns 0 for a satisfied keep form", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const [keepPath, audiencePath] = jsonPair(cleanKeep());
    expect(main([keepPath, audiencePath])).toBe(0);
  });

  it("returns 1 for inhabit findings", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const [keepPath, audiencePath] = jsonPair(cleanKeep({ speaker: "qa" }));
    expect(main([keepPath, audiencePath])).toBe(1);
  });

  it("returns 2 for wrong argv count and missing files", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main([])).toBe(2);
    expect(main(["only-one.json"])).toBe(2);
    const [keepPath] = jsonPair(cleanKeep());
    expect(main([keepPath, join(tmpdir(), "missing-audience.json")])).toBe(2);
  });

  it("returns 0 for --help", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(["--help"])).toBe(0);
  });

  it("returns 0 for lived feedback and 1 for empty compare alternatives", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const feedback = cleanKeep({
      intent: "feedback",
      topic: "the checkout flow",
      familiarity: "returning",
      functional: [{ happened: "The button did nothing.", expected: "The next step." }],
      experience: ["I felt stuck."],
      expectations: [],
      blockedMe: "yes",
      whatIDidInstead: "I clicked twice more, then left.",
      wantedInstead: "The next step.",
      stillForMe: "yes",
    });
    const [feedbackPath, audiencePath] = jsonPair(feedback);
    expect(main([feedbackPath, audiencePath])).toBe(0);

    const compare = cleanKeep({
      intent: "compare",
      topic: "competitors",
      familiarity: "returning",
      alternatives: [],
      versus: "I have no one to put this next to.",
      whatTheyDoBetter: "Nothing I can name, because I have no one to put this next to.",
      whatThisDoesBetter: "The first screen is calmer.",
      whenIReachForThem: "I do not, because I have no one.",
      switchingCost: "I would not know where to go.",
      iWouldSwitch: "no",
      whatKeepsMeHere: "Habit.",
      whatWouldMakeMeSwitch: "A reason.",
    });
    const [comparePath, compareAudience] = jsonPair(compare);
    expect(main([comparePath, compareAudience])).toBe(1);
  });

  it("returns 2 for an unknown intent", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const [keepPath, audiencePath] = jsonPair(cleanKeep({ intent: "audit" }));
    expect(main([keepPath, audiencePath])).toBe(2);
  });
});


/**
 * Runs a child process and resolves once its stdout/stderr have fully ended
 * AND the process has exited -- never before.
 *
 * #1333: the equivalent `spawnSync` calls this replaces flaked in CI under
 * load with `result.status === 1` (the child really did exit 1) but
 * `result.stdout` empty -- a report the exit code says exists but the
 * capture missed. `spawnSync`'s synchronous capture is implemented as its
 * own internal poll loop outside Node's normal stream machinery, and that
 * loop is what a heavily loaded CI runner's scheduling can starve.
 * `spawn()`'s stdout/stderr are ordinary `Readable` streams, whose own
 * contract (not a loop this test has to get right) guarantees every byte
 * written is delivered via `data` events before `end` fires, and this
 * helper's `close` handler -- which Node fires only after the process has
 * exited AND both stdio streams have ended -- cannot observe an exit code
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

describe("customer-check bin entry point (installed-symlink topology)", () => {
  let binPath: string;
  let installRoot: string;
  const evidenceDirs: string[] = [];

  beforeAll(() => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    // dist/ was built once, before any test file started, by the package's
    // vitest globalSetup (scripts/lib/vitest-build-package.mjs). Never rebuild
    // it here: a sibling test file may be executing or packing it (#1385).
    const realCli = join(packageRoot, "dist", "cli.js");

    installRoot = mkdtempSync(join(tmpdir(), "customer-check-install-"));
    const dotBin = join(installRoot, "node_modules", ".bin");
    mkdirSync(dotBin, { recursive: true });
    binPath = join(dotBin, "customer-check");
    symlinkSync(realCli, binPath);
  });

  afterAll(() => {
    rmSync(installRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const dir of evidenceDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function pair(keep: unknown): [string, string] {
    const dir = mkdtempSync(join(tmpdir(), "customer-check-bin-"));
    evidenceDirs.push(dir);
    const keepPath = join(dir, "keep.json");
    const audiencePath = join(dir, "audience.json");
    writeFileSync(keepPath, JSON.stringify(keep));
    writeFileSync(audiencePath, JSON.stringify(audience));
    return [keepPath, audiencePath];
  }

  it("prints usage and exits 0 for --help", async () => {
    const result = await spawnCapture(process.execPath, [binPath, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: customer-check");
  });

  it("red case: exits 1 with a violated report", async () => {
    const [keepPath, audiencePath] = pair(cleanKeep({ impressions: { ...cleanKeep().impressions, wouldIStay: "no" } }));
    const result = await spawnCapture(process.execPath, [binPath, keepPath, audiencePath]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated" });
  });

  it("clean case: exits 0 with a satisfied report", async () => {
    const [keepPath, audiencePath] = pair(cleanKeep());
    const result = await spawnCapture(process.execPath, [binPath, keepPath, audiencePath]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied" });
  });
});
