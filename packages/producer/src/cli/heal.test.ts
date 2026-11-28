import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { runCli } from "./main.js";

const REPO = resolve(PRODUCER_ROOT, "../..");

describe("clossys heal", () => {
  it("routes to the Controller's incident loop: the report over the recorded fixtures has no repeat", async () => {
    const result = await runCli(["heal", "--report"], REPO);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^COUNT orphan-test-child 1$/m);
    expect(result.message).toMatch(/^heal report: 5 record\(s\), 0 repeat\(s\) after a guard landed, 0 new cause\(s\)$/m);
  });

  it("exits 1 on a guard's violation fixture and 2 on a usage error", async () => {
    const packet = await runCli(["heal", "check", "--packet", "scripts/rules/fixtures/R-PACKET-ONE-EXPECTATION/packet.md"], REPO);
    expect(packet.exitCode).toBe(1);
    expect(packet.message).toMatch(/R-PACKET-ONE-EXPECTATION\s+`npm run test -w @clossys\/designer` has two expectations/);
    const usage = await runCli(["heal", "--bogus"], REPO);
    expect(usage.exitCode).toBe(2);
    expect(usage.message).toMatch(/^heal: unknown option --bogus/);
  });
});
