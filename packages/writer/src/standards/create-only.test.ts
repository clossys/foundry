// R5 (K2): every Writer slot a consumer places either has a package default, or names a standard that seeds it or
// declares createOnly with a reason. The placed slots are the test consumer's (the one `clossys conform` reads by
// default); the defaults and the standards are this package's own data. A slot placed without one of the three, or
// a standard losing its createOnly reason, fails here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE = join(import.meta.dirname, "..", "..");
const CONSUMER_WRITER = join(PACKAGE, "..", "producer", "test-fixtures", "consumer", "clossys", "agents", "writer");
type Json = Record<string, unknown>;
const read = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;
const list = (value: unknown): Json[] => (Array.isArray(value) ? value : []).filter((item): item is Json => !!item && typeof item === "object");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");

/** The slots the consumer's writer ia.json places (but the agent's declared loop slots), with the standard each slot.json names. */
function placed(loops: ReadonlySet<string>): { id: string; standard: string | undefined }[] {
  const ia = read(join(CONSUMER_WRITER, "ia.json"));
  return list(ia.nodes).flatMap(node => list(node.children).flatMap(child => strings(child.slots))).filter(id => !loops.has(id)).map(id => {
    const path = join(CONSUMER_WRITER, id, "slot.json");
    const standard = existsSync(path) ? read(path).standard : undefined;
    return { id, standard: typeof standard === "string" ? standard : undefined };
  });
}

describe("placed writer slots without a package default", () => {
  const adapter = read(join(PACKAGE, "conform.json"));
  const defaults = new Set(strings(adapter.defaults).flatMap(dir => readdirSync(join(PACKAGE, dir))));
  const created = placed(new Set(strings(adapter.loops))).filter(slot => !defaults.has(slot.id));

  it("are the slots of the narrative, string, copy.headline and passage craft standards", () => {
    expect(created.length).toBeGreaterThan(0);
    expect([...new Set(created.map(slot => slot.standard ?? "(none)"))].sort()).toEqual(["copy.headline", "narrative", "passage", "string"]);
  });

  it("each name a standard that seeds them or declares createOnly with a one-sentence reason", () => {
    const gaps = created.filter(slot => {
      const path = join(PACKAGE, "standards", slot.standard ?? "", "requirements.json");
      if (!slot.standard || !existsSync(path)) return true;
      const standard = read(path);
      if (Array.isArray(standard.seeds) && standard.seeds.length) return false;
      const reason = standard.createOnlyReason;
      return !(standard.createOnly === true && typeof reason === "string" && /^[A-Z][^.]*\.$/.test(reason.trim()));
    }).map(slot => `${slot.id}: no package default, no seed, no createOnly reason`);
    expect(gaps).toEqual([]);
  });
});
