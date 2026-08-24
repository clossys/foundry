import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as root from "./index.js";
import { RESEND_DECLARED_RANGE } from "./providers/resend/index.js";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  exports: Record<string, unknown>;
  peerDependencies: Record<string, string>;
};

describe("public migration contract", () => {
  it("accounts for the useful donor capabilities without depending on the donor", () => {
    const donorDisposition = {
      "finished-message-validation": "moved",
      "provider-neutral-transport": "moved",
      "idempotent-claim-complete": "moved",
      "normalized-delivery-events": "moved",
      "resend-adapter": "moved",
      "optional-policy-default-allow": "deliberately-changed-to-required",
      "optional-ledger": "deliberately-changed-to-required",
      "generic-inbound-admission": "deliberately-omitted-butler-owns-person-requests",
      "reserved-unimplemented-channels": "deliberately-omitted",
    } as const;

    expect(Object.values(donorDisposition)).not.toContain("unaccounted");
    expect(root).toMatchObject({
      createMessenger: expect.any(Function),
      validateMessage: expect.any(Function),
      checkDeliveryClosure: expect.any(Function),
    });
    expect(manifest.exports).toHaveProperty("./providers/resend");
  });

  it("keeps the optional provider peer range aligned with its public adapter declaration", () => {
    expect(manifest.peerDependencies.resend).toBe(RESEND_DECLARED_RANGE);
  });
});
