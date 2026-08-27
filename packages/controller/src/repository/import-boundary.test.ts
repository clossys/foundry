import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsIo = vi.hoisted(() => ({
  existsSync: vi.fn(() => { throw new Error("unexpected existsSync during import"); }),
  readFileSync: vi.fn(() => { throw new Error("unexpected readFileSync during import"); }),
  realpathSync: vi.fn(() => { throw new Error("unexpected realpathSync during import"); }),
  statSync: vi.fn(() => { throw new Error("unexpected statSync during import"); }),
  writeFileSync: vi.fn(() => { throw new Error("unexpected writeFileSync during import"); }),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  ...fsIo,
}));

type Write = typeof process.stdout.write;

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  for (const spy of Object.values(fsIo)) spy.mockClear();
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe.each([
  ["the importable CLI module", () => import("./cli.js")],
  ["the importable full-runner CLI module", () => import("./run-cli.js")],
  ["the importable adoption CLI module", () => import("./adoption-cli.js")],
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
