// The pinned test world (foundry-build-0048 Unit A): test-fixtures/consumer is the output of
// scripts/seed-pinned-world.mjs, which pins the fixture pages' upstream closure through the verbs.
// The drift check seeds once from BASE (the unpinned fixture git keeps at the commit BASE_FILE names, never the
// committed tree itself) and compares every file and byte: a hand edit to a pin, a candidate, a ledger or the event
// log, or a verb whose output changed, fails here. BASE_FILE is the one place the base is named: when the
// integration line moves the unpinned fixture, that file moves with it, and a base HEAD does not hold fails first.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, BASE_FILE, BLOCKED, FIXTURE, REPO, assertBaseAncestor, blockedIn, closure, seed, treeFiles } from "../../scripts/seed-pinned-world.mjs";

const consumer = join(FIXTURE, "clossys");
const pinned = (ref: string) => { const [agent, id] = ref.split("/") as [string, string]; return existsSync(join(consumer, "agents", agent, id, "pin.json")); };

describe("the pinned test world", () => {
  let scratch: string;
  let out: string;
  let blocked: Map<string, string>;
  beforeAll(async () => {
    // A base HEAD does not hold is a stale base file: say so before any seeding.
    assertBaseAncestor(REPO, BASE.commit);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "pinned-world-drift-")));
    out = join(scratch, "consumer");
    ({ blocked } = await seed({ out }));
  }, 900_000);
  afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

  it("seeds from the base BASE_FILE names, an ancestor of HEAD", () => {
    expect(BASE).toEqual(JSON.parse(readFileSync(BASE_FILE, "utf8")));
    expect(BASE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(() => assertBaseAncestor(REPO, BASE.commit)).not.toThrow();
  });

  it("is byte for byte what one seeder pass writes from the unpinned base BASE_FILE names", () => {
    const committed = treeFiles(FIXTURE);
    expect(treeFiles(out)).toEqual(committed);
    const drift = committed.filter((file: string) => !readFileSync(join(out, file)).equals(readFileSync(join(FIXTURE, file))));
    expect(drift).toEqual([]);
  });

  it("pins every closure slot but the BLOCKED ones and the slots that read them", () => {
    const order: string[] = closure(consumer);
    expect(order.length).toBe(115);
    expect(Object.keys(BLOCKED).every(ref => order.includes(ref))).toBe(true);
    expect([...blockedIn(consumer, order).keys()]).toEqual([...blocked.keys()]);
    expect(order.filter(ref => !pinned(ref))).toEqual(order.filter(ref => blocked.has(ref)));
  });

  it("pins the consumer-supplied logo and semantic content as originals, and holds no retired component (B1 r5, owner 2026-11-20)", () => {
    for (const id of ["components.logo", "components.semantic-content"]) {
      const dir = join(consumer, "agents", "designer", id);
      expect(pinned(`designer/${id}`)).toBe(true);
      const candidates = treeFiles(join(dir, "candidates")).map((file: string) => readFileSync(join(dir, "candidates", file), "utf8"));
      expect(candidates.length).toBeGreaterThan(0);
      for (const text of candidates) expect(JSON.parse(text).clossys.source.kind).toBe("original");
    }
    for (const ref of ["designer/components.link", "designer/components.media-player", "designer/components.status-mark", "writer/components.media-player.copy"]) {
      const [agent, id] = ref.split("/") as [string, string];
      expect(existsSync(join(consumer, "agents", agent, id, "slot.json"))).toBe(false);
    }
  });

  it("pins no retired strings.* slot", () => {
    expect(treeFiles(consumer).filter((file: string) => /\/strings\.[^/]+\/pin\.json$/.test(file))).toEqual([]);
  });
});
