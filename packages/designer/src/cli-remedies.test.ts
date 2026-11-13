/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { cliErrorDetail, cliRemedy } from "./cli-remedies.js";
import { runCli } from "./cli.js";
import { main as libraryMain } from "./library-cli/cli.js";
import * as styleScan from "./style-scan.js";

const marker = "rejected-payload-marker";
afterEach(() => vi.restoreAllMocks());

it.each([
  new Error(marker), Object.assign(new Error(marker), { stack: marker }),
  { message: marker, stack: marker, payload: marker }, marker,
  Object.assign(new Error(marker), { code: marker }),
  Object.defineProperty({}, "code", { get() { throw new Error(marker); } }),
  new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(marker); } }),
])("never copies an opaque error into a public diagnostic", error => {
  expect(cliErrorDetail(error)).toBe("unexpected error; the operation could not complete");
  expect(cliErrorDetail(error) + cliRemedy("designer-library")).not.toContain(marker);
});
it("keeps fixed JSON and filesystem categories without their original messages or paths", () => {
  expect(cliErrorDetail(new SyntaxError(marker))).toContain("invalid JSON");
  expect(cliErrorDetail(Object.assign(new Error(marker), { code: "EACCES" }))).toContain("permission denied");
});

it("captures library stdout/stderr without exposing malformed changeset bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "designer-remedy-"));
  try {
    const path = join(root, "changes.json");
    writeFileSync(path, `{"value":"${marker}", broken}`);
    const out: string[] = [], error: string[] = [];
    expect(await libraryMain(["apply", "--changeset", path, "--root", root], {
      out: value => out.push(value), error: value => error.push(value),
    })).toBe(2);
    expect(out).toEqual([]);
    expect(error.join("\n")).toMatch(/invalid JSON/);
    expect(error.join("\n")).toMatch(/Remedy:.*designer-library --help/);
    expect([...out, ...error].join("\n")).not.toContain(marker);
    const executable = spawnSync(process.execPath, [new URL("../dist/library-cli/cli.js", import.meta.url).pathname, "apply", "--changeset", path, "--root", root], { encoding: "utf8" });
    expect(executable.status).toBe(2);
    expect(executable.stdout).toBe("");
    expect(executable.stderr).toContain("invalid JSON");
    expect(executable.stderr).toContain("Remedy:");
    expect(executable.stdout + executable.stderr).not.toContain(marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("captures the token CLI executable's malformed JSON refusal", () => {
  const root = mkdtempSync(join(tmpdir(), "designer-remedy-"));
  try {
    const path = join(root, "tokens.json");
    writeFileSync(path, `{"value":"${marker}", broken}`);
    const result = spawnSync(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, root, "--tokens", path], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/invalid JSON/);
    expect(result.stderr).toMatch(/Remedy:.*designer-token-check --help/);
    expect(result.stdout + result.stderr).not.toContain(marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("captures unexpected token scanner errors without their message or stack", () => {
  const root = mkdtempSync(join(tmpdir(), "designer-remedy-"));
  const stdout: string[] = [], stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation(value => { stdout.push(String(value)); });
  vi.spyOn(console, "error").mockImplementation(value => { stderr.push(String(value)); });
  vi.spyOn(styleScan, "scanStyleSources").mockImplementation(() => { throw Object.assign(new Error(marker), { stack: marker }); });
  try {
    expect(runCli([root])).toBe(2);
    expect(stderr.join("\n")).toContain("unexpected error");
    expect(stderr.join("\n")).toMatch(/Remedy:/);
    expect([...stdout, ...stderr].join("\n")).not.toContain(marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("keeps help successful and silent on stderr", () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(runCli(["--help"])).toBe(0);
  expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  expect(stderr).not.toHaveBeenCalled();
});
