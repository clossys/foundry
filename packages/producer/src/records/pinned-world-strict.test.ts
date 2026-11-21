// `clossys check --strict` on the committed pinned test world (foundry-build-0048 B1-STRICT). The one row this unit
// closes: the seeder runs `clossys migrate slots --apply`, so no Producer seat is left as clossys.slot/1 for
// records.computed-match. The loop, ledger and ref-verbatim rows below already passed on the base fixture; they are
// asserted so the regenerated fixture keeps them. The whole check does not exit 0 yet (see the B1-STRICT receipt);
// the exit-0 assertion lands with the decisions it waits on. Nothing here is a baseline: every assertion is a row that passes.
import { beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { strictFindings } from "../loop/cli.js";
import { FIXTURE } from "../../scripts/seed-pinned-world.mjs";

type Checked = { exitCode: number; message: string };
const row = (message: string, check: string) => message.split("\n").find(line => line.startsWith(`${check}: `));

describe("clossys check --strict on the pinned test world", () => {
  let result: Checked;
  let findings: ReturnType<typeof strictFindings>;
  beforeAll(async () => {
    result = await runCli(["check", "--strict", "--root", FIXTURE], FIXTURE) as Checked;
    findings = strictFindings(FIXTURE);
  }, 300_000);

  it("reaches every loop exit and keeps every loop connected", () => {
    for (const check of ["loop.reachable", "loop.connected"]) expect(row(result.message, check), check).toBe(`${check}: pass`);
  });

  it("keeps the queue and ledgers append-only and every pinned stock file verbatim", () => {
    expect(row(result.message, "ledger.append-only")).toBe("ledger.append-only: pass");
    expect(result.message).toMatch(/^ {2}Ref verbatim: \d+ pins, errors=0 /m);
  });

  it("holds no clossys.slot/1 record: every Producer seat computes from its base (clossys migrate slots)", () => {
    const seats = findings.filter(finding => finding.check === "records.computed-match" && finding.subject.startsWith("producer/"));
    expect(seats).toEqual([]);
  });
});
