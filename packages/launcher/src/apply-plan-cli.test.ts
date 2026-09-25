import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SNAPSHOT_USAGE, main, snapshotMain } from "./apply-plan-cli.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { createNodeHost } from "./host.js";
import { REGISTRY_SNAPSHOT_REL, registrySnapshotViolations, type Transport } from "./registry-snapshot.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "apply-plan-cli-"));
  roots.push(root);
  return root;
}

const VALID_PLAN = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "x", primaryProblemId: "unclear-positioning", roles: ["strategist"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: null,
  decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "compose", chosen: "approved", by: "sponsor" }],
  blockers: [],
};

const VALID_BRIEF = {
  schemaVersion: 1,
  problem: "x",
  roles: [{ role: "strategist", why: "y", goal: { metric: "m", direction: "increase" }, inputsFrom: [], outputsTo: [] }],
  sequence: ["strategist"],
  deliverables: ["z"],
};

describe("apply-plan-cli main", () => {
  it("writes clossys/brief.json and exits 0 when both files validate and the plan is approved", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toContain("clossys/brief.json");
    const written = JSON.parse(readFileSync(join(repoDir, "clossys", "brief.json"), "utf8"));
    expect(written).toEqual(VALID_BRIEF);
  });

  it("exits 1 and writes nothing when the plan is not approved", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    writeFileSync(planPath, JSON.stringify({ ...VALID_PLAN, decisions: [] }));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/refused/);
  });

  it("exits 2 when --plan does not point at readable JSON", () => {
    const workDir = tempDir();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", join(workDir, "missing.json"), "--brief", join(workDir, "also-missing.json"), "--repo", workDir], createNodeHost());
    expect(code).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/could not be read/);
  });

  it("exits 1 with a specific reason when --brief exists but does not validate", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, JSON.stringify({ schemaVersion: 1 }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/--brief does not validate/);
  });

  it("applies an Advisor-shaped plan with a blocker and no recommendedNext.due, and prints its canonical digest (#1475)", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    const plan = {
      ...VALID_PLAN,
      recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor" },
      blockers: [
        { capabilityId: "engagement", kind: "missing-authority", owner: "sponsor", nextAction: { who: "sponsor", how: "approve the plan", byWhen: "2026-09-29" }, since: "2026-09-20T00:00:00Z" },
      ],
    };
    writeFileSync(planPath, JSON.stringify(plan));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[1]?.[0])).toMatch(/^plan digest sha256:[0-9a-f]{64}$/);
  });

  it("exits 1 naming the field when --plan carries a field the contract does not declare", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify({ ...VALID_PLAN, notes: [] }));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toBe(
      "launcher-apply-plan: --plan does not validate: plan.notes is not a field the contract declares, and unknown fields are refused",
    );
  });

  it("exits 2, naming the key, when --plan or --brief repeats a key at the top level or nested (#1475)", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const cases: [string, string, string, RegExp][] = [
      ["plan nested", JSON.stringify(VALID_PLAN).replace('"problem":', '"problem":"EVIL","problem":'), JSON.stringify(VALID_BRIEF), /^launcher-apply-plan: --plan repeats the key "problem" in mandate; every key may appear once: /],
      ["plan top level", JSON.stringify(VALID_PLAN).replace('"schemaVersion":1', '"schemaVersion":1,"blockers":[]'), JSON.stringify(VALID_BRIEF), /--plan repeats the key "blockers" in the top-level object/],
      ["brief nested", JSON.stringify(VALID_PLAN), JSON.stringify(VALID_BRIEF).replace('"direction":', '"direction":"decrease","direction":'), /--brief repeats the key "direction" in roles\[0\]\.goal/],
    ];
    for (const [name, plan, brief, expected] of cases) {
      writeFileSync(planPath, plan);
      writeFileSync(briefPath, brief);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost()), name).toBe(2);
      expect(String(err.mock.calls.at(-1)?.[0]), name).toMatch(expected);
      expect(existsSync(join(workDir, "clossys")), name).toBe(false);
    }
  });

  it("prints a repeated key with its control characters escaped, never raw, and refuses a byte order mark (#1475)", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, '{"\\u001b[2J":1,"\\u001b[2J":2}');
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost())).toBe(2);
    const message = String(err.mock.calls[0]?.[0]);
    expect(message).toBe(`launcher-apply-plan: --brief repeats the key "\\u001b[2J" in the top-level object; every key may appear once: ${briefPath}`);
    expect(message).not.toContain("\u001b");
    writeFileSync(briefPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(VALID_BRIEF))]));
    expect(main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost())).toBe(2);
    expect(String(err.mock.calls.at(-1)?.[0])).toBe(
      `launcher-apply-plan: --brief is not valid JSON at position 0: it starts with a byte order mark, which strict JSON refuses: ${briefPath}`,
    );
  });

  it("exits 2 for malformed JSON with a position only, never quoting the file", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, '{"problem":"our biggest client is leaving",}');
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost())).toBe(2);
    const message = String(err.mock.calls[0]?.[0]);
    expect(message).toBe(`launcher-apply-plan: --brief is not valid JSON at position 43: ${briefPath}`);
    expect(message).not.toContain("client");
  });

  it("exits 2 when --plan is not valid UTF-8, instead of reading a replacement character (#1475)", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const bytes = Buffer.from(JSON.stringify(VALID_PLAN), "utf8");
    bytes[bytes.indexOf(Buffer.from('"x"')) + 1] = 0xff;
    writeFileSync(planPath, bytes);
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost())).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/^launcher-apply-plan: --plan is not valid UTF-8: /);
    expect(existsSync(join(workDir, "clossys"))).toBe(false);
  });

  it("--help prints usage and exits 0", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--help"], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/Usage: launcher-apply-plan/);
  });

  it("main() throws directly on malformed arguments -- only the run() executable wrapper maps that to exit 2", () => {
    expect(() => main(["--plan"], createNodeHost())).toThrow(/usage: launcher-apply-plan/);
  });
});

describe("launcher-apply-plan snapshot (#1178)", () => {
  const DESIGNER = `${PACKAGE_SCOPE.scope}/designer`;
  const STARTER = `${PACKAGE_SCOPE.scope}/starter`;
  const NOW = () => "2026-09-24T12:00:00.000Z";
  const MARKER = "RESPONSE-TEXT-never-printed";

  function packument(name: string): unknown {
    return {
      name,
      readme: MARKER,
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name, version: "1.0.0", dist: { integrity: "sha512-AAAA", tarball: `${PACKAGE_SCOPE.registry}/${name}/-/x-1.0.0.tgz` } } },
      time: { "1.0.0": "2026-09-01T00:00:00.000Z" },
    };
  }

  /** Answers every name from the packument above, except DESIGNER, which answers `designer` when given. */
  function registry(designer?: () => Response): { transport: Transport; calls: string[] } {
    const calls: string[] = [];
    const transport: Transport = async (url) => {
      calls.push(url.href);
      const name = decodeURIComponent(url.pathname.slice(1));
      if (name === DESIGNER && designer !== undefined) return designer();
      return new Response(JSON.stringify(packument(name)), { status: 200 });
    };
    return { transport, calls };
  }

  function hubWithRequest(request: unknown = { state: "satisfied", names: [STARTER, DESIGNER], findings: [] }): { hub: string; request: string } {
    const hub = tempDir();
    const path = join(hub, "request.json");
    writeFileSync(path, typeof request === "string" ? request : JSON.stringify(request));
    return { hub, request: path };
  }

  function quiet() {
    vi.stubGlobal("fetch", () => {
      throw new Error("a test reached the real fetch");
    });
    return { log: vi.spyOn(console, "log").mockImplementation(() => {}), err: vi.spyOn(console, "error").mockImplementation(() => {}) };
  }

  it("--help prints the snapshot usage and exits 0; the main usage names the subcommand", async () => {
    const { log } = quiet();
    expect(await snapshotMain(["--help"])).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toBe(SNAPSHOT_USAGE);
    expect(SNAPSHOT_USAGE).toMatch(/^Usage: launcher-apply-plan snapshot --request <file> \[--out <file>\]/);
    expect(main(["--help"], createNodeHost())).toBe(0);
    expect(String(log.mock.calls[1]?.[0])).toContain("launcher-apply-plan snapshot --request <file> [--out <file>]");
  });

  it("writes the snapshot to clossys/.state/apply/registry-snapshot.json under the hub by default, and exits 0", async () => {
    const { hub, request } = hubWithRequest();
    const { log } = quiet();
    const { transport } = registry(() => new Response('{"error":"Not found"}', { status: 404 }));
    expect(await snapshotMain(["--request", "request.json"], { transport, cwd: hub, now: NOW })).toBe(0);
    const target = join(hub, REGISTRY_SNAPSHOT_REL);
    expect(String(log.mock.calls[0]?.[0])).toBe(`wrote ${target}: 2 package(s), 1 found, 1 not found`);
    const text = readFileSync(target, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    const snapshot = JSON.parse(text) as { packages: { name: string; status: string }[] };
    expect(registrySnapshotViolations(snapshot)).toEqual([]);
    expect(snapshot.packages.map((entry) => [entry.name, entry.status])).toEqual([[DESIGNER, "not-found"], [STARTER, "found"]]);
    expect(text).not.toContain(MARKER);
    expect(existsSync(request)).toBe(true);
  });

  it("writes to --out, resolved against the hub", async () => {
    const { hub } = hubWithRequest();
    quiet();
    expect(await snapshotMain(["--out", "elsewhere/snap.json", "--request", "request.json"], { transport: registry().transport, cwd: hub, now: NOW })).toBe(0);
    expect(existsSync(join(hub, "elsewhere", "snap.json"))).toBe(true);
    expect(existsSync(join(hub, "clossys"))).toBe(false);
  });

  it("exits 2 on a usage error, without reading the request or the registry", async () => {
    const { hub } = hubWithRequest();
    const { err } = quiet();
    const cases: [string[], RegExp][] = [
      [[], /--request is required/],
      [["--out", "x.json"], /--request is required/],
      [["--request"], /usage: launcher-apply-plan snapshot --request <file> \[--out <file>\]/],
      [["--request", "request.json", "--request", "request.json"], /usage: /],
      [["--request", "request.json", "--registry", "https://registry.example.com"], /usage: /],
      [["request.json"], /usage: /],
    ];
    for (const [argv, expected] of cases) {
      const { transport, calls } = registry();
      expect(await snapshotMain(argv, { transport, cwd: hub, now: NOW }), argv.join(" ")).toBe(2);
      expect(String(err.mock.calls.at(-1)?.[0]), argv.join(" ")).toMatch(expected);
      expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/^launcher-apply-plan snapshot: .*; no snapshot was written$/);
      expect(calls).toEqual([]);
    }
    expect(existsSync(join(hub, "clossys"))).toBe(false);
  });

  it("exits 2 on a request that is missing, not strict JSON, or not a satisfied list of names in scope, never quoting it", async () => {
    const { err } = quiet();
    const cases: [unknown, RegExp][] = [
      ['{"names":["' + MARKER + '",}', /the --request file is not valid JSON at position \d+; /],
      ['{"names":[],"names":["x"]}', /the --request file repeats a key in one object; /],
      [{ state: "violated", findings: [{ message: MARKER }] }, /state is not satisfied/],
      [{ names: [`@${MARKER.toLowerCase()}/x`] }, /names\[0\] is not a package name in the @\S+ scope/],
    ];
    for (const [request, expected] of cases) {
      const { hub } = hubWithRequest(request);
      const { transport, calls } = registry();
      expect(await snapshotMain(["--request", "request.json"], { transport, cwd: hub, now: NOW })).toBe(2);
      const message = String(err.mock.calls.at(-1)?.[0]);
      expect(message).toMatch(expected);
      expect(message.toLowerCase()).not.toContain(MARKER.toLowerCase());
      expect(calls).toEqual([]);
      expect(existsSync(join(hub, "clossys"))).toBe(false);
    }
    const hub = tempDir();
    expect(await snapshotMain(["--request", "absent.json"], { transport: registry().transport, cwd: hub })).toBe(2);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/the --request file could not be read; no snapshot was written$/);
    expect(await snapshotMain(["--request", "."], { transport: registry().transport, cwd: hub })).toBe(2);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/the --request file is not a file/);
  });

  it("exits 2 and writes no file when any package's read fails, and prints nothing the registry sent", async () => {
    const { err, log } = quiet();
    const answers: [() => Response, RegExp][] = [
      [() => new Response(MARKER, { status: 500 }), /answered HTTP 500/],
      [() => new Response(MARKER, { status: 200 }), /is not valid JSON at position 0/],
      [() => new Response(null, { status: 301, headers: { location: "https://elsewhere.example.com/" } }), /redirect \(HTTP 301\)/],
    ];
    for (const [answer, expected] of answers) {
      const { hub } = hubWithRequest();
      expect(await snapshotMain(["--request", "request.json"], { transport: registry(answer).transport, cwd: hub, now: NOW })).toBe(2);
      const message = String(err.mock.calls.at(-1)?.[0]);
      expect(message).toMatch(new RegExp(`^launcher-apply-plan snapshot: names\\[1\\] ${DESIGNER}: `));
      expect(message).toMatch(expected);
      expect(message).not.toContain(MARKER);
      expect(existsSync(join(hub, "clossys"))).toBe(false);
    }
    const { hub } = hubWithRequest();
    const never: Transport = () => new Promise<Response>(() => {});
    expect(await snapshotMain(["--request", "request.json"], { transport: never, cwd: hub, now: NOW, timeoutMs: 20 })).toBe(2);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/did not answer within/);
    expect(existsSync(join(hub, "clossys"))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("exits 2 when the snapshot cannot be written, naming the path only", async () => {
    const { hub } = hubWithRequest();
    const { err } = quiet();
    mkdirSync(join(hub, "taken", "registry-snapshot.json"), { recursive: true });
    expect(await snapshotMain(["--request", "request.json", "--out", "taken/registry-snapshot.json"], { transport: registry().transport, cwd: hub, now: NOW })).toBe(2);
    expect(String(err.mock.calls.at(-1)?.[0])).toBe(`launcher-apply-plan snapshot: the snapshot could not be written to ${join(hub, "taken", "registry-snapshot.json")}; no snapshot was written`);
  });
});
