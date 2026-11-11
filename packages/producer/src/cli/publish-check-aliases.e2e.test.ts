/**
 * Bare `publish` dry run, end to end through the built CLI: a page copy ref `<cell>#<key>` whose cell
 * is no Writer slot (`page.home#meta-title`) resolves through the Writer declarations alias
 * `<cell>.<key>` (`page.home.meta-title`), the same rule `check --readiness` applies. In a full copy of
 * the repository's `clossys/`, no page reports `writer-slot-unpinned` while its aliases are declared;
 * removing one alias (mutation) brings exactly that ref back as a `writer-slot-unpinned` finding.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flatConsumer, runVerb, withBriefContracts } from "./__fixtures__/flat-consumer.js";

type Finding = { code: string; page?: string; message: string };
let root: string;
beforeAll(() => { root = withBriefContracts(flatConsumer(["director", "designer", "writer", "publisher"])); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const unpinned = (value: any): Finding[] => (value.checks.findings as Finding[]).filter(finding => finding.code === "writer-slot-unpinned");

describe("publish dry run: page copy refs through Writer declarations aliases", () => {
  it("reports no writer-slot-unpinned for aliased refs, and one when the alias is removed", () => {
    const baseline = runVerb(["publish"], root);
    expect(baseline.status).not.toBe(2);
    expect(unpinned(baseline.value)).toEqual([]);

    const file = join(root, "clossys", "agents", "writer", "declarations.json");
    const declarations = JSON.parse(readFileSync(file, "utf8")) as { locales: Record<string, { aliases: Record<string, string> }> };
    for (const locale of Object.values(declarations.locales)) {
      expect(Object.hasOwn(locale.aliases, "page.home.meta-title")).toBe(true);
      delete locale.aliases["page.home.meta-title"];
    }
    writeFileSync(file, `${JSON.stringify(declarations, null, 2)}\n`);

    const mutated = runVerb(["publish"], root);
    expect(mutated.status).toBe(1);
    const hits = unpinned(mutated.value);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ page: "page.home" });
  }, 600_000);
});
