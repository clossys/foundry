import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkReferences, treeHash } from "./check-references.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-references.mjs");
const committed = join(here, "..", "references");
const manifest = JSON.parse(readFileSync(join(committed, "manifest.json"), "utf8"));

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "designer-references-"));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

let copies = 0;
function copy() {
  const root = join(scratch, `copy-${++copies}`);
  cpSync(committed, root, { recursive: true });
  return root;
}
const run = (root) => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
const extracted = manifest.items.find((item) => item.files.some((file) => file.origin.includes("#files[")));
const extractedFile = extracted.files.find((file) => file.origin.includes("#files["));

describe("check-references", () => {
  it("passes on the committed references", () => {
    const result = run(committed);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(checkReferences(committed).ok, true);
  });

  it("covers every registry with items and a license file", () => {
    assert.deepEqual(Object.keys(manifest.registries).sort(), ["diceui", "lucide", "magicui", "shadcn", "tailark-oss"]);
    for (const id of Object.keys(manifest.registries)) {
      assert.ok(manifest.items.some((item) => item.registry === id), `${id} has items`);
      assert.ok(manifest.licenses.some((license) => license.path.startsWith(`${id}/`)), `${id} keeps its license`);
    }
    for (const item of manifest.items) assert.equal(treeHash(item.files), item.hash, item.dir);
  });

  it("fails when one byte of a reference file is edited (mutation)", () => {
    const root = copy();
    const target = join(root, extracted.dir, extractedFile.path);
    const bytes = readFileSync(target);
    bytes[0] = bytes[0] === 0x20 ? 0x21 : 0x20;
    writeFileSync(target, bytes);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${extracted.dir}/${extractedFile.path}: sha256`));
    assert.match(result.stderr, /differs from .*files\[\d+\]\.content/);
  });

  it("fails when a license file changes, a file goes missing or an unlisted file appears", () => {
    const license = copy();
    appendFileSync(join(license, manifest.licenses[0].path), "\n");
    assert.equal(run(license).status, 1);

    const missing = copy();
    unlinkSync(join(missing, manifest.items[0].dir, manifest.items[0].files[0].path));
    assert.match(run(missing).stderr, /: missing/);

    const extra = copy();
    writeFileSync(join(extra, manifest.items[0].dir, "patched.tsx"), "export {}\n");
    assert.match(run(extra).stderr, /patched\.tsx: not listed in the manifest/);
  });

  it("fails when the manifest is edited to match a tampered file but the item hash is not", () => {
    const root = copy();
    const target = join(root, extracted.dir, extractedFile.path);
    writeFileSync(target, `${readFileSync(target, "utf8")}// local patch\n`);
    const edited = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const item = edited.items.find((entry) => entry.dir === extracted.dir);
    const file = item.files.find((entry) => entry.path === extractedFile.path);
    const bytes = readFileSync(target);
    file.bytes = bytes.length;
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(edited));
    const findings = checkReferences(root).findings.map((finding) => finding.message);
    assert.ok(findings.some((message) => /item hash .* does not match/.test(message)), findings.join("\n"));
    assert.ok(findings.some((message) => /differs from .*content/.test(message)), findings.join("\n"));
  });
});
