import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runVerb } from "./__fixtures__/flat-consumer.js";

// `clossys standard` through the built binary (dist/cli/index.js): the verb is bound in the pipeline
// dispatch, so the real CLI runs it instead of refusing `Unknown argument: standard`.
const FIXTURE = fileURLToPath(new URL("../constitution/__fixtures__/standards/fixture-headline/", import.meta.url));
const parts = ["--requirements", join(FIXTURE, "requirements.json"), "--taste", join(FIXTURE, "taste.md"), "--exemplars", join(FIXTURE, "exemplars", "exemplars.json"),
  "--exemplar-file", join(FIXTURE, "exemplars", "plain-claim.md"), "--exemplar-file", join(FIXTURE, "exemplars", "house-voice.md")];
const AT = ["--at", "2026-11-14T00:00:00.000Z"];

describe("clossys standard (built CLI)", () => {
  it("writes a standard by the planner, then --dry proves the recorded event through the same verb", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "standard-e2e-")));
    const config = join(root, "clossys", "clossys.config.ts");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, "export default {};\n");
    const write = runVerb(["standard", "writer/fixture-headline", "--by", "planner", ...parts, ...AT], root);
    expect(write.status, write.stdout + write.stderr).toBe(0);
    expect(write.stdout + write.stderr).not.toMatch(/Unknown argument/);
    const ledger = JSON.parse(readFileSync(join(root, "packages", "writer", "standards", "fixture-headline", "ledger.json"), "utf8")) as { events: { op: string; by: string; verb: string }[] };
    expect(ledger.events).toMatchObject([{ op: "standard", by: "planner", verb: "standard" }]);
    const dry = runVerb(["standard", "writer/fixture-headline", "--by", "planner", ...parts, "--at", "2026-11-14T01:00:00.000Z", "--dry"], root);
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.value).toMatchObject({ schema: "clossys.standard-dry/1", written: false, matches: true });
    const refused = runVerb(["standard", "writer/fixture-headline", "--by", "agent:writer", ...parts], root);
    expect(refused.status).toBe(1);
  });
});
