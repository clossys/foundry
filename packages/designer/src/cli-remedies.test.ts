/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cliErrorDetail } from "./cli-remedies.js";
import manifest from "../package.json" with { type: "json" };

it.each(Object.entries(manifest.bin))("%s keeps bad-input refusal and gives a readable next step", (name, bin) => {
  const result = spawnSync(process.execPath, [new URL(`../${bin}`, import.meta.url).pathname, "--unknown-option"], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/Remedy:/);
  expect(result.stderr).toContain(name);
  expect(result.stderr).toMatch(/--help/);
});
it("does not repeat rejected JSON payloads when advising library apply", () => {
  const root = mkdtempSync(join(tmpdir(), "designer-remedy-"));
  try {
    const path = join(root, "changes.json");
    writeFileSync(path, '{"privateMarker":"rejected-payload-marker", broken}');
    const result = spawnSync(process.execPath, [new URL("../dist/library-cli/cli.js", import.meta.url).pathname, "apply", "--changeset", path, "--root", root], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid JSON");
    expect(result.stderr).toMatch(/Remedy:/);
    expect(result.stderr).not.toContain("rejected-payload-marker");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("preserves useful causes while hiding JSON parser excerpts and opaque thrown values", () => {
  expect(cliErrorDetail(new Error("EACCES: input file is not readable"))).toBe("EACCES: input file is not readable");
  expect(cliErrorDetail(new SyntaxError("rejected-payload-marker"))).not.toContain("rejected-payload-marker");
  expect(cliErrorDetail({ payload: "rejected-payload-marker" })).not.toContain("rejected-payload-marker");
});
