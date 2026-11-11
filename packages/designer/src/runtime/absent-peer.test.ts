import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { isAbsentPackage, loadUnlessPeerAbsent } from "./absent-peer.js";

/**
 * WD-REG: `components/server` must import when an optional peer that only its
 * deferred stock boundaries (LinkButton, Spinner) reach is omitted. Measured by
 * `npm run check:packed-consumer -- --package @clossys/designer`; this suite pins
 * the same guarantee against the real compiled entry, with a resolve hook that
 * makes the omitted peer unresolvable exactly as an uninstalled package is.
 */
/** Each case spawns Node on the real compiled entry; a cold import of that graph takes seconds under load. */
const SPAWN_TIMEOUT_MS = 30_000;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hooks = (() => {
  const dir = mkdtempSync(join(tmpdir(), "designer-absent-peer-"));
  writeFileSync(join(dir, "hooks.mjs"), [
    "const omitted = JSON.parse(process.env.OMIT_PEERS);",
    "export async function resolve(specifier, context, next) {",
    "  if (omitted.some((peer) => specifier === peer || specifier.startsWith(peer + '/'))) {",
    "    const error = new Error(`Cannot find package '${specifier}' imported from ${context.parentURL}`);",
    "    error.code = 'ERR_MODULE_NOT_FOUND';",
    "    throw error;",
    "  }",
    "  return next(specifier, context);",
    "}",
  ].join("\n"));
  writeFileSync(join(dir, "register.mjs"), `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(join(dir, "hooks.mjs")).href)});\n`);
  return join(dir, "register.mjs");
})();

function importServerEntry(omit: readonly string[]): string[] {
  const script = `const m = await import(${JSON.stringify(pathToFileURL(join(packageRoot, "dist/components/server.js")).href)}); console.log(JSON.stringify(Object.keys(m).sort()));`;
  return JSON.parse(execFileSync(process.execPath, ["--import", hooks, "--input-type=module", "-e", script], {
    cwd: packageRoot, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS, env: { ...process.env, OMIT_PEERS: JSON.stringify(omit) },
  }));
}

describe("components/server with an omitted optional peer", () => {
  let all: string[] = [];
  beforeAll(() => { all = importServerEntry([]); }, SPAWN_TIMEOUT_MS);

  it.each(["react-aria-components", "react-dom", "@internationalized/date", "lucide-react"])("imports without %s and keeps every export", (peer) => {
    expect(all).toEqual(expect.arrayContaining(["LinkButton", "Spinner", "Badge"]));
    expect(importServerEntry([peer])).toEqual(all);
  }, SPAWN_TIMEOUT_MS);

  it("still rejects, naming the peer, when a peer the server-safe members import statically is omitted", () => {
    expect(() => importServerEntry(["react"])).toThrow(/Cannot find package 'react'/);
  }, SPAWN_TIMEOUT_MS);
});

describe("loadUnlessPeerAbsent", () => {
  it("returns the module when it loads", async () => {
    await expect(loadUnlessPeerAbsent(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("returns undefined only for an absent package", async () => {
    const absent = Object.assign(new Error("Cannot find package 'lucide-react' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" });
    expect(isAbsentPackage(absent)).toBe(true);
    await expect(loadUnlessPeerAbsent(async () => { throw absent; })).resolves.toBeUndefined();
  });

  it("propagates a missing shipped file and any other failure", async () => {
    const missingFile = Object.assign(new Error("Cannot find module '/pkg/dist/spinner.js' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" });
    expect(isAbsentPackage(missingFile)).toBe(false);
    await expect(loadUnlessPeerAbsent(async () => { throw missingFile; })).rejects.toBe(missingFile);
    const thrown = new TypeError("boom");
    await expect(loadUnlessPeerAbsent(async () => { throw thrown; })).rejects.toBe(thrown);
  });
});
