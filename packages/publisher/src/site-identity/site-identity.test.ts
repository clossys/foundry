import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkSiteIdentityDrift, copyEntriesFromRegistry, readSiteIdentity, validateSiteIdentity } from "./index.js";

const fixture = fileURLToPath(new URL("../../test-fixtures/site-identity/", import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(join(fixture, path), "utf8"));
function files(dir: string): Array<{path: string; content: string}> {
  return readdirSync(join(fixture, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? entry.name === "_record" ? [] : files(`${dir}/${entry.name}`)
    : entry.name === "site-identity.json" ? [] : [{ path: `${dir}/${entry.name}`, content: readFileSync(join(fixture, dir, entry.name), "utf8") }]);
}
const expected = json("expected-drift.json");
describe("Publisher site identity", () => {
  it("reads its own record and validates the unchanged data contract", () => {
    const input = json("record/site-identity.json");
    expect(validateSiteIdentity(input)).toEqual({ ok: true, value: input });
    expect(readSiteIdentity(join(fixture, "record"))).toEqual({ status: "ok", identity: input });
    expect(readSiteIdentity(join(fixture, "clean")).status).toBe("missing");
    expect(validateSiteIdentity({ ...input, unknown: true }).ok).toBe(false);
  });
  it("reports malformed records and parse failures without a legacy path fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "publisher-identity-"));
    try {
      writeFileSync(join(root, "brand-facts.json"), JSON.stringify(json("record/site-identity.json")));
      expect(readSiteIdentity(root).status).toBe("missing");
      writeFileSync(join(root, "site-identity.json"), "{");
      expect(readSiteIdentity(root)).toMatchObject({ status: "invalid", issue: { reason: "unparseable" } });
      writeFileSync(join(root, "site-identity.json"), "{}");
      expect(readSiteIdentity(root)).toMatchObject({ status: "invalid", issue: { reason: "invalid-schema" } });
      rmSync(join(root, "site-identity.json"));
      mkdirSync(join(root, "site-identity.json"));
      expect(readSiteIdentity(root)).toMatchObject({ status: "invalid", issue: { reason: "unreadable" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("reads a site identity through the shipped content/node entry", () => {
    const source = `import { readSiteIdentity, validateSiteIdentity } from "@clossys/publisher/content/node";
      const result = readSiteIdentity(${JSON.stringify(join(fixture, "record"))});
      if (result.status !== "ok" || !validateSiteIdentity(result.identity).ok) process.exitCode = 1;`;
    const server = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
    expect(server.stderr).toBe("");
    expect(server.status).toBe(0);
  });
  it("refuses a real browser bundle of the content/node site identity reader", () => {
    expect(() => buildSync({
      stdin: {
        contents: 'import { readSiteIdentity } from "@clossys/publisher/content/node"; console.log(readSiteIdentity("."));',
        resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
      },
      bundle: true,
      platform: "browser",
      write: false,
      logLevel: "silent",
    })).toThrow(/Could not resolve "node:(?:fs|url)"/);
  });
  it.each(Object.keys(expected))("preserves 0.6 drift on moved fictional %s fixtures", dir => {
    const input = json(dir === "conflict-incorporation" ? `${dir}/_record/site-identity.json` : dir === "tagline-unresolved" ? `${dir}/site-identity.json` : "record/site-identity.json");
    const identity = validateSiteIdentity(input);
    const copy = copyEntriesFromRegistry(json("record/copy-registry.json"));
    expect(identity.ok && copy.ok).toBe(true);
    if (!identity.ok || !copy.ok) throw new Error("Invalid fictional fixture");
    expect(checkSiteIdentityDrift(files(dir), identity.value, { copyEntries: copy.value })).toEqual(expected[dir]);
  });
});
