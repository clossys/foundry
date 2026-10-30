import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const names = ["studio", "voice", "meta", "writer", "writer-paging", "chat"] as const;
const recordPath = (name: string) => join(packageRoot, `src/catalog/records/admin-${name}.r1.en.json`);
const commonPath = join(packageRoot, "src/catalog/records/common-labels.r1.en.json");

it("packs complete admin copy and resolves every Designer route-label reference through public exports", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-admin-exports-"));
  const before = names.map(name => readFileSync(recordPath(name), "utf8"));
  // Additive draft records change the envelope size; derive the packed total from its sources.
  const commonBefore = readFileSync(commonPath, "utf8");
  const expectedRecordCount = new Set([...before, commonBefore].flatMap(raw => JSON.parse(raw).records.map((record: { id: string }) => record.id))).size;
  const labelsPath = resolve(packageRoot, "../designer/src/studio/route-labels.ts");
  const source = ts.createSourceFile(labelsPath, readFileSync(labelsPath, "utf8"), ts.ScriptTarget.Latest, true);
  const refs: string[] = [];
  function collectIds(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "id" && ts.isStringLiteral(node.initializer)) refs.push(node.initializer.text);
    ts.forEachChild(node, collectIds);
  }
  function findRefs(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "ROUTE_STUDIO_COPY_REFS") collectIds(node);
    else ts.forEachChild(node, findRefs);
  }
  findRefs(source);
  expect(refs).toHaveLength(149);
  expect(new Set(refs).size).toBe(149);
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: packageRoot, encoding: "utf8" }));
    const installed = join(root, "node_modules/@clossys/writer");
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", ["-xzf", join(root, packed[0].filename), "-C", installed, "--strip-components=1"]);
    // Mirror the declared runtime dependencies that an ordinary npm install provides.
    const { dependencies } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    for (const dependency of Object.keys(dependencies)) {
      mkdirSync(join(root, "node_modules", dependency, ".."), { recursive: true });
      symlinkSync(resolve(packageRoot, "../../node_modules", dependency), join(root, "node_modules", dependency), "dir");
    }
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
    writeFileSync(join(root, "refs.json"), JSON.stringify(refs));
    const probe = join(root, "probe.mjs");
    writeFileSync(probe, `
      import assert from "node:assert/strict";
      const expectedRecordCount = ${expectedRecordCount};
      import studio from "@clossys/writer/admin-studio.en.json" with { type: "json" };
      import voice from "@clossys/writer/admin-voice.en.json" with { type: "json" };
      import meta from "@clossys/writer/admin-meta.en.json" with { type: "json" };
      import refs from "./refs.json" with { type: "json" };
      import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      import { ADMIN_VOICE_COPY_EN, getAdminVoiceCopyRecord } from "@clossys/writer/admin-voice";
      import { ADMIN_META_COPY_EN, getAdminMetaCopyRecord } from "@clossys/writer/admin-meta";
      import { ADMIN_COPY_EN, ADMIN_WRITER_COPY_EN, ADMIN_CHAT_COPY_EN, ADMIN_COMMON_COPY_EN, createAdminCopy, getAdminCopy, getAdminCopyRecord } from "@clossys/writer/admin-copy";
      for (const [raw, catalog, getRecord] of [
        [studio, ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord],
        [voice, ADMIN_VOICE_COPY_EN, getAdminVoiceCopyRecord],
        [meta, ADMIN_META_COPY_EN, getAdminMetaCopyRecord],
      ]) {
        assert.deepEqual(catalog, raw);
        assert.equal(raw.state, "draft");
        assert.equal(raw.activation, "none");
        assert.equal(raw.locale, "en");
        for (const record of raw.records) {
          assert.deepEqual(getRecord(record.id), record);
          assert.deepEqual(getAdminCopyRecord(record.id), record);
          assert.equal(getRecord(record.id).status, "draft");
          assert.equal(Object.hasOwn(record, "approval"), false);
          assert.equal(Object.isFrozen(getRecord(record.id)), true);
        }
        assert.equal(Object.isFrozen(catalog), true);
        assert.equal(Object.isFrozen(catalog.records), true);
        assert.equal(getRecord("unknown"), undefined);
      }
      assert.equal(getAdminCopy(), ADMIN_COPY_EN);
      assert.deepEqual(ADMIN_COPY_EN.envelopes, [ADMIN_STUDIO_COPY_EN, ADMIN_VOICE_COPY_EN, ADMIN_META_COPY_EN, ADMIN_WRITER_COPY_EN, ADMIN_CHAT_COPY_EN, ADMIN_COMMON_COPY_EN]);
      assert.equal(ADMIN_COPY_EN.records.length, expectedRecordCount);
      assert.equal(new Set(ADMIN_COPY_EN.records.map(record => record.id)).size, expectedRecordCount);
      for (const value of [ADMIN_COPY_EN, ADMIN_COPY_EN.records, ADMIN_COPY_EN.envelopes]) assert.equal(Object.isFrozen(value), true);
      assert.equal(getAdminCopyRecord("unknown"), undefined);
      for (const id of refs) {
        const record = getAdminCopyRecord(id);
        assert.equal(record?.id, id);
        assert.equal(typeof record.text, "string");
        assert.ok(record.text.length > 0);
      }
      // Equal duplicates collapse regardless of object-property ordering.
      const reordered = Object.fromEntries(Object.entries(voice.records[0]).reverse());
      const repeated = createAdminCopy([studio, voice, meta, ADMIN_WRITER_COPY_EN, ADMIN_CHAT_COPY_EN, ADMIN_COMMON_COPY_EN, { ...voice, records: [reordered] }]);
      assert.equal(repeated.records.length, expectedRecordCount);
      assert.equal(getAdminCopyRecord(voice.records[0].id, repeated), voice.records[0]);
      assert.equal(Object.isFrozen(voice), false);
      assert.throws(() => createAdminCopy([voice, { ...voice, records: [{ ...voice.records[0], text: "conflicting test copy" }] }]), /Conflicting admin copy record/);
      console.log(JSON.stringify({ records: expectedRecordCount, routeRefs: refs.length, publicImports: 7 }));
    `);
    const output = execFileSync(process.execPath, [probe], { cwd: root, encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({ records: expectedRecordCount, routeRefs: 149, publicImports: 7 });
    for (const [index, name] of names.entries()) expect(readFileSync(join(installed, `src/catalog/records/admin-${name}.r1.en.json`), "utf8")).toBe(before[index]);
    expect(readFileSync(join(installed, "src/catalog/records/common-labels.r1.en.json"), "utf8")).toBe(commonBefore);

    const consumer = join(root, "consumer.ts");
    writeFileSync(consumer, `
      import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord, type AdminStudioCopy, type AdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      import { ADMIN_VOICE_COPY_EN, getAdminVoiceCopyRecord, type AdminVoiceCopy, type AdminVoiceCopyRecord } from "@clossys/writer/admin-voice";
      import { ADMIN_META_COPY_EN, getAdminMetaCopyRecord, type AdminMetaCopy, type AdminMetaCopyRecord } from "@clossys/writer/admin-meta";
      import { getAdminCopy, getAdminCopyRecord, createAdminCopy, type AdminCopy, type AdminCopyEnvelope, type AdminCopyRecord } from "@clossys/writer/admin-copy";
      const studio: AdminStudioCopy = ADMIN_STUDIO_COPY_EN;
      const voice: AdminVoiceCopy = ADMIN_VOICE_COPY_EN;
      const meta: AdminMetaCopy = ADMIN_META_COPY_EN;
      const records: [AdminStudioCopyRecord | undefined, AdminVoiceCopyRecord | undefined, AdminMetaCopyRecord | undefined] = [getAdminStudioCopyRecord("id"), getAdminVoiceCopyRecord("id"), getAdminMetaCopyRecord("id")];
      const envelopes: readonly AdminCopyEnvelope[] = [studio, voice, meta];
      const copy: AdminCopy = getAdminCopy();
      const record: AdminCopyRecord | undefined = getAdminCopyRecord(copy.records[0]!.id);
      const text: string | undefined = record?.text;
      // @ts-expect-error Shipped records cannot be rewritten through the accessor.
      studio.records[0]!.text = "changed";
      // @ts-expect-error The combined record list is immutable.
      copy.records.push(studio.records[0]!);
      void [text, records, createAdminCopy(envelopes)];
    `);
    const compiler = resolve(packageRoot, "../../node_modules/typescript/bin/tsc");
    execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "ES2022", "--resolveJsonModule", "--skipLibCheck", consumer], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [index, name] of names.entries()) expect(readFileSync(recordPath(name), "utf8")).toBe(before[index]);
  expect(readFileSync(commonPath, "utf8")).toBe(commonBefore);
}, 30_000);
