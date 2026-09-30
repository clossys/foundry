// The sheet checks every value it prints against a strict pattern, on top of
// the contract validators. The validators are already strict, so a hostile
// value cannot reach the patterns through a real bundle; this file lets a
// bundle through the validators to prove the patterns hold on their own.

import { describe, expect, it, vi } from "vitest";

vi.mock("./change-set-contract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./change-set-contract.js")>()),
  validateApplyBundle: () => ({ valid: true }),
  validateRepositoryChangeSet: () => ({ valid: true }),
}));

import { ApprovalSheetError, renderApprovalSheet } from "./approval-sheet.js";
import type { ApprovalSheetInput } from "./approval-sheet.js";
import { planApplyBundle } from "./plan-bundle.js";
import { clone, setupInputs, setupObservation } from "./plan-bundle-setup-fixture.js";
import type { Loose } from "./plan-bundle-setup-fixture.js";

function planned(): ApprovalSheetInput {
  const { bundle, changeSets } = planApplyBundle(setupInputs(setupObservation()));
  return { bundle, changeSets };
}

function edit(change: (input: { bundle: Loose; set: Loose }) => void): ApprovalSheetInput {
  const input = planned();
  const bundle = clone(input.bundle) as unknown as Loose;
  const set = clone(input.changeSets[0]!) as unknown as Loose;
  change({ bundle, set });
  return { bundle, changeSets: [set] } as unknown as ApprovalSheetInput;
}

/** A bundle whose only repository was skipped, for the given reason, and so has no change set. */
function skipped(reason: string): ApprovalSheetInput {
  const { bundle } = planApplyBundle(setupInputs(null, undefined, { repositories: [{ id: "example-owner/site", skipped: "not-in-inventory", verdict: "indeterminate" }] }));
  const edited = clone(bundle) as unknown as Loose;
  edited.repositories[0].reason = reason;
  return { bundle: edited, changeSets: [] } as unknown as ApprovalSheetInput;
}

function token(input: ApprovalSheetInput): string {
  try {
    renderApprovalSheet(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalSheetError);
    expect((error as Error).message).toBe((error as ApprovalSheetError).token);
    return (error as ApprovalSheetError).token;
  }
  return "rendered";
}

const HOSTILE = ["a|b", "a`b", "a<b", "a>b", "a\nb", "a\rb", "a b", "", "\u2028"] as const;

describe("the sheet's own value patterns", () => {
  it("render an unedited bundle through the mocked validators", () => {
    expect(token(planned())).toBe("rendered");
  });

  for (const value of HOSTILE) {
    const shown = JSON.stringify(value);
    it(`refuse ${shown} as a deferred plan item, a deferred or refused reason, a refused path, a check rule and a skipped reason`, () => {
      expect(token(edit(({ set }) => void (set.deferred = [{ planItem: value, reason: "after-setup" }])))).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.deferred = [{ planItem: "example-owner/site:@clossys/writer", reason: value }])))).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.refused = [{ path: value, reason: "unowned-existing", item: "skills" }])))).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.refused = [{ file: "package.json", pointer: value, reason: "unowned-existing", item: "skills" }])))).toBe("value-unsafe");
      expect(token(edit(({ bundle }) => void (bundle.repositories[0].checks = [{ check: "V8", verdict: "indeterminate", rule: value }])))).toBe("value-unsafe");
      expect(token(skipped(value))).toBe("value-unsafe");
    });

    it(`refuse ${shown} as a repository id, an item id, a package name, a version, the mode and the authorization`, () => {
      expect(
        token(
          edit(({ bundle, set }) => {
            bundle.repositories[0].id = value;
            set.repository.id = value;
          }),
        ),
      ).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.items[0].id = value)))).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.items.find((item: Loose) => item.act === "pin-starter").package.name = value)))).toBe("value-unsafe");
      expect(token(edit(({ set }) => void (set.items.find((item: Loose) => item.act === "pin-starter").package.version = value)))).toBe("value-unsafe");
      expect(token(edit(({ bundle }) => void (bundle.mode = value)))).toBe("value-unsafe");
      expect(token(edit(({ bundle }) => void (bundle.authorization.expiresAt = value)))).toBe("value-unsafe");
      expect(token(edit(({ bundle }) => void (bundle.authorization.planDigest = value)))).toBe("value-unsafe");
      expect(
        token(
          edit(({ bundle, set }) => {
            bundle.bundleDigest = value;
            set.bundle = value;
          }),
        ),
      ).toBe("value-unsafe");
    });
  }

  it("never echo the offending value", () => {
    for (const value of ["secret-looking|value", "a`b"]) {
      const input = edit(({ set }) => void (set.deferred = [{ planItem: value, reason: "after-setup" }]));
      try {
        renderApprovalSheet(input);
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(value);
        expect(String((error as Error).stack)).not.toContain(value);
      }
    }
  });
});
