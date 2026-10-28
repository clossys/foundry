import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const recordPath = join(packageRoot, "src/catalog/records/admin-studio.r1.en.json");

it("packs and resolves the raw Studio record and its typed accessor through public exports", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-studio-exports-"));
  const before = readFileSync(recordPath, "utf8");
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: packageRoot, encoding: "utf8" }));
    const installed = join(root, "node_modules/@clossys/writer");
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", ["-xzf", join(root, packed[0].filename), "-C", installed, "--strip-components=1"]);
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const probe = join(root, "probe.mjs");
    writeFileSync(probe, `
      import assert from "node:assert/strict";
      import raw from "@clossys/writer/admin-studio.en.json" with { type: "json" };
      import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      assert.deepEqual(ADMIN_STUDIO_COPY_EN, raw);
      assert.equal(raw.state, "draft");
      assert.equal(raw.activation, "none");
      assert.equal(raw.locale, "en");
      for (const record of raw.records) {
        const actual = getAdminStudioCopyRecord(record.id);
        assert.deepEqual(actual, record);
        assert.equal(actual.status, "draft");
        assert.equal(Object.hasOwn(actual, "approval"), false);
        assert.equal(Object.isFrozen(actual), true);
      }
      assert.equal(Object.isFrozen(ADMIN_STUDIO_COPY_EN), true);
      assert.equal(Object.isFrozen(ADMIN_STUDIO_COPY_EN.records), true);
      assert.equal(getAdminStudioCopyRecord("unknown"), undefined);
      assert.equal(Object.keys(getAdminStudioCopyRecord(raw.records[0].id)).includes("text"), true);
      console.log(JSON.stringify({ records: raw.records.length, publicImports: 2 }));
    `);
    const output = execFileSync(process.execPath, [probe], { cwd: root, encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({ records: JSON.parse(before).records.length, publicImports: 2 });
    expect(readFileSync(join(installed, "src/catalog/records/admin-studio.r1.en.json"), "utf8")).toBe(before);

    const consumer = join(root, "consumer.ts");
    writeFileSync(consumer, `
      import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      import type { AdminStudioCopy, AdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      const catalog: AdminStudioCopy = ADMIN_STUDIO_COPY_EN;
      const record: AdminStudioCopyRecord | undefined = getAdminStudioCopyRecord(catalog.records[0]!.id);
      const text: string | undefined = record?.text;
      // @ts-expect-error Shipped records cannot be rewritten through the accessor.
      catalog.records[0]!.text = "changed";
      void text;
    `);
    const compiler = resolve(packageRoot, "../../node_modules/typescript/bin/tsc");
    execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "ES2022", "--resolveJsonModule", "--skipLibCheck", consumer], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  expect(readFileSync(recordPath, "utf8")).toBe(before);
}, 30_000);
