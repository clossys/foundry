import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatConsumer, repoConsumer, snapshot } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { sha256Hex } from "../records/hash.js";
import { writerRecords } from "../records/slot-check.js";
import { applyCopyKeyMigration, foundryCopyKeyCatalog, kebabCopyKey, planCopyKeyMigration } from "./copy-keys.js";

const camel = (id: string) => id.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
const RENAMED = ["page.previous-label", "page.next-label", "page.page-text", "page.no-results-label", "page.page-size-label", "total.range-text"];

/**
 * A copy of the repository consumer with the pagination slots put back in the legacy camelCase
 * form: Designer and Writer slot.json keys, the Writer candidate's record ids, and a pin that
 * matches those legacy bytes.
 */
function legacyConsumer() {
  const root = flatConsumer(["designer", "writer"]);
  const consumer = join(root, "clossys");
  const designer = join(consumer, "agents", "designer", "sections.pagination", "slot.json");
  const writerDir = join(consumer, "agents", "writer", "passages.pagination");
  const pin = JSON.parse(readFileSync(join(writerDir, "pin.json"), "utf8")) as { candidate: string; sha256: string };
  const candidate = join(writerDir, "candidates", pin.candidate);
  const migrated = { designer: readFileSync(designer, "utf8"), writer: readFileSync(join(writerDir, "slot.json"), "utf8"), candidate: readFileSync(candidate, "utf8"), pin: readFileSync(join(writerDir, "pin.json"), "utf8") };
  const legacyKeys = (text: string) => RENAMED.reduce((out, key) => out.split(`"key": "${key}"`).join(`"key": "${camel(key)}"`), text);
  const legacyIds = (text: string) => text.split("\n").map(line => line.startsWith("### ") || /^<!-- \{"id":/.test(line) ? line.replace(/studio\.pages\.[a-z0-9.-]+/, id => camel(id)) : line).join("\n");
  writeFileSync(designer, legacyKeys(migrated.designer));
  writeFileSync(join(writerDir, "slot.json"), legacyKeys(migrated.writer));
  const legacyCandidate = legacyIds(migrated.candidate);
  writeFileSync(candidate, legacyCandidate);
  writeFileSync(join(writerDir, "pin.json"), migrated.pin.replace(pin.sha256, sha256Hex(legacyCandidate)));
  return { root, consumer, designer, writerDir, candidate, migrated, legacyCandidate };
}

describe("clossys migrate copy-keys", () => {
  it("derives kebab-case ids segment by segment and keeps array markers", () => {
    expect(kebabCopyKey("plans[].priceByInterval[].priceText")).toBe("plans[].price-by-interval[].price-text");
    expect(kebabCopyKey("labels.showAllVariants")).toBe("labels.show-all-variants");
    expect(kebabCopyKey("page.label")).toBe("page.label");
  }, 60_000);

  it("renames only catalog-declared ids, restores the migrated bytes, and carries a matching pin", () => {
    const fixture = legacyConsumer();
    const catalog = foundryCopyKeyCatalog();
    for (const key of RENAMED) expect(catalog.writer.get("passages.pagination")?.has(key)).toBe(true);
    const plan = planCopyKeyMigration(fixture.consumer, catalog);
    expect(plan.findings).toEqual([]);
    expect(plan.renames.filter(rename => rename.agent === "writer").map(rename => rename.to).sort()).toEqual([...RENAMED].sort());
    expect(plan.repinned).toEqual(["writer/passages.pagination"]);
    applyCopyKeyMigration(fixture.consumer, plan);
    expect(readFileSync(fixture.designer, "utf8")).toBe(fixture.migrated.designer);
    expect(readFileSync(join(fixture.writerDir, "slot.json"), "utf8")).toBe(fixture.migrated.writer);
    expect(readFileSync(fixture.candidate, "utf8")).toBe(fixture.migrated.candidate);
    expect(readFileSync(join(fixture.writerDir, "pin.json"), "utf8")).toBe(fixture.migrated.pin);
  }, 60_000);

  it("touches only ids: every record's text, locale and non-id meta are byte-identical", () => {
    const fixture = legacyConsumer();
    applyCopyKeyMigration(fixture.consumer, planCopyKeyMigration(fixture.consumer));
    const before = writerRecords(fixture.legacyCandidate), after = writerRecords(readFileSync(fixture.candidate, "utf8"));
    expect(after.length).toBe(before.length);
    after.forEach((record, index) => {
      const old = before[index]!;
      expect(record.text).toBe(old.text);
      expect(record.locale).toBe(old.locale);
      expect({ ...record.meta, id: undefined }).toEqual({ ...old.meta, id: undefined });
      expect(record.key).toBe(record.meta.id);
      expect(camel(record.key)).toBe(old.key);
    });
    const strip = (text: string) => text.split("\n").filter(line => !line.startsWith("### ") && !/^<!-- \{"id":/.test(line)).join("\n");
    expect(strip(readFileSync(fixture.candidate, "utf8"))).toBe(strip(fixture.legacyCandidate));
  }, 60_000);

  it("is idempotent: a second run plans nothing and writes nothing", async () => {
    const fixture = legacyConsumer();
    const first = await runCli(["migrate", "copy-keys", "--root", fixture.root], fixture.root);
    expect(first.exitCode, first.message).toBe(0);
    const after = snapshot(fixture.root);
    expect(planCopyKeyMigration(fixture.consumer).files).toEqual([]);
    const second = await runCli(["migrate", "copy-keys", "--root", fixture.root], fixture.root);
    expect(second.exitCode, second.message).toBe(0);
    expect(second.message).toMatch(/^migrate copy-keys: 0 copy key\(s\) renamed, 0 file\(s\) rewritten/);
    expect(snapshot(fixture.root)).toEqual(after);
    expect((await runCli(["migrate", "copy-keys", "--check", "--root", fixture.root], fixture.root)).exitCode).toBe(0);
  }, 60_000);

  it("reports a camelCase key the catalog does not declare and leaves a drifted pin alone", async () => {
    const fixture = legacyConsumer();
    const slot = join(fixture.writerDir, "slot.json");
    writeFileSync(slot, readFileSync(slot, "utf8").replace('"key": "page.label"', '"key": "page.ariaLabel"'));
    const pin = join(fixture.writerDir, "pin.json");
    writeFileSync(pin, readFileSync(pin, "utf8").replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${"0".repeat(64)}"`));
    const check = await runCli(["migrate", "copy-keys", "--check", "--root", fixture.root], fixture.root);
    expect(check.exitCode).toBe(1);
    expect(check.message).toContain("copy key page.ariaLabel has no catalog id (page.aria-label is not declared)");
    const plan = planCopyKeyMigration(fixture.consumer);
    expect(plan.repinned).toEqual([]);
    expect(plan.files.some(file => file.path.endsWith("pin.json"))).toBe(false);
  }, 60_000);

  it("leaves nothing pending on the repository consumer", () => {
    const plan = planCopyKeyMigration(repoConsumer);
    expect(plan.findings).toEqual([]);
    expect(plan.files.map(file => file.path)).toEqual([]);
  }, 60_000);
});
