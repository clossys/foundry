import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsIo: {
    existsSync: vi.fn(() => { throw new Error("unexpected existsSync during import"); }),
    readFileSync: vi.fn(() => { throw new Error("unexpected readFileSync during import"); }),
    readdirSync: vi.fn(() => { throw new Error("unexpected readdirSync during import"); }),
    statSync: vi.fn(() => { throw new Error("unexpected statSync during import"); }),
  },
  injectedApi: "existsSync",
}));
const { fsIo } = mocks;

vi.mock("node:fs", () => fsIo);

const hostileFsApis = ["existsSync", "readFileSync", "readdirSync", "statSync"] as const;

type Write = typeof process.stdout.write;

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("./locate.js");
  for (const spy of Object.values(fsIo)) spy.mockClear();
});

afterEach(() => {
  vi.doUnmock("./locate.js");
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe.each(hostileFsApis)("hostile node:fs mock: %s", (api) => {
  it("proves this API red is reachable during the CLI import", async () => {
    mocks.injectedApi = api;
    vi.doMock("./locate.js", () => {
      mocks.fsIo[mocks.injectedApi as keyof typeof fsIo]();
      return { locateRepositoryProfile: () => undefined };
    });

    let failure: unknown;
    try { await import("./cli.js"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeInstanceOf(Error);
    expect(((failure as Error).cause as Error).message).toContain(`unexpected ${api} during import`);
    expect(fsIo[api]).toHaveBeenCalledTimes(1);
    vi.doUnmock("./locate.js");
    vi.resetModules();
  });
});

describe.each([
  ["the importable CLI module", () => import("./cli.js")],
  ["the importable full-runner CLI module", () => import("./run-cli.js")],
  ["the importable adoption CLI module", () => import("./adoption-cli.js")],
  ["the importable singular-authority CLI module", () => import("../release/singular-authority-cli.js")],
  ["the public repository entrypoint", () => import("./index.js")],
])("no-I/O import boundary: %s", (_label, importModule) => {
  it("performs no filesystem I/O, output, or process-state mutation", async () => {
    const argv = [...process.argv];
    const env = { ...process.env };
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as Write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as Write);

    await importModule();

    expect(Object.values(fsIo).every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCode);
    expect(process.argv).toEqual(argv);
    expect(process.env).toEqual(env);
  });
});
