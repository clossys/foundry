import { describe, expect, it } from "vitest";
import { ApprovalSheetError, renderApprovalSheet } from "./approval-sheet.js";
import type { ApprovalSheetInput, ApprovalSheetRefusal } from "./approval-sheet.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, DependencyPlacement, RepositoryChangeSet } from "./change-set-contract.js";
import { createExistingDeclarationAdoptions, planApplyBundle } from "./plan-bundle.js";
import { clone, setupInputs, setupObservation, setupPlan, SITE_ID } from "./plan-bundle-setup-fixture.js";
import type { Loose } from "./plan-bundle-setup-fixture.js";

/** A bundle and its one change set, planned from the setup fixture: a real planner result, not a hand-built one. */
function planned(): ApprovalSheetInput {
  const { bundle, changeSets } = planApplyBundle(setupInputs(setupObservation()));
  return { bundle, changeSets };
}

/** Native consent for an observed declaration, retained by the setup planner. */
function plannedAdoption(placement: DependencyPlacement): ApprovalSheetInput {
  const base = setupPlan({ starterVersion: "0.3.0" });
  const plan = { ...base, packages: base.packages!.map((act) => act.act === "install" ? { ...act, placement } : act) };
  const act = plan.packages.find((candidate) => candidate.act === "install")!;
  const observation = setupObservation({
    manifestEntries: [{ placement, name: act.name, value: "^0.1.0" }],
    lockedPackages: [{ name: act.name, version: "0.1.2", integrity: act.integrity }],
  });
  const proofs = createExistingDeclarationAdoptions(observation, plan, [act.name], "adopt-existing-declaration");
  const { bundle, changeSets } = planApplyBundle(setupInputs(observation, plan, { existingDeclarationAdoptions: { [observation.id]: proofs } }));
  expect(changeSets).toHaveLength(1);
  expect(changeSets[0]!.existingDeclarationAdoptions).toEqual(proofs);
  return { bundle, changeSets };
}

/** `input` with `edit` applied to its (single) change set, and every digest recomputed so only the edited value is wrong. */
function edited(input: ApprovalSheetInput, edit: (set: Loose) => void): ApprovalSheetInput {
  const set = clone(input.changeSets[0]!) as unknown as Loose;
  edit(set);
  set.changeSetDigest = changeSetDigest(set);
  const short = set.changeSetDigest.slice("sha256:".length, "sha256:".length + 12);
  set.branch = `clossys/apply-${short}`;
  set.pullRequest = { ...set.pullRequest, title: `Clossys: apply plan ${short}` };
  const bundle = clone(input.bundle) as unknown as Loose;
  const entry = bundle.repositories.find((candidate: Loose) => candidate.id === set.repository.id);
  entry.changeSet = set.changeSetDigest;
  bundle.bundleDigest = bundleDigest(bundle.plan.digest, [{ id: set.repository.id, changeSetDigest: set.changeSetDigest }]);
  set.bundle = bundle.bundleDigest;
  return { bundle: bundle as ApplyBundle, changeSets: [set as RepositoryChangeSet] };
}

function refusal(input: ApprovalSheetInput): ApprovalSheetRefusal {
  try {
    renderApprovalSheet(input);
  } catch (error) {
    if (error instanceof ApprovalSheetError) return error.token;
    throw error;
  }
  throw new Error("the sheet was rendered");
}

describe("renderApprovalSheet", () => {
  it("renders the golden sheet: the bundle's ids and digests, one row per item, then what was held back", () => {
    expect(renderApprovalSheet(planned())).toBe(GOLDEN);
  });

  it.each(["dependencies", "devDependencies"] as const)("renders native adoption consent for %s without changing its input or digests", (placement) => {
    const input = plannedAdoption(placement);
    expect(validateApplyBundle(input.bundle)).toEqual({ valid: true });
    expect(validateRepositoryChangeSet(input.changeSets[0])).toEqual({ valid: true });
    const before = clone(input);
    const set = input.changeSets[0]!;
    const proof = set.existingDeclarationAdoptions![0]!;
    const sheet = renderApprovalSheet(input);
    expect(sheet).toContain(`\nExisting declaration adoption consent:\n- ${set.repository.id} ${proof.desired.planItem} ${placement} ${proof.beforeVersion} (${proof.beforeResolved.version}, ${proof.beforeResolved.integrity}) -> ${proof.desired.version} (${proof.desired.integrity}); explicit adoption consent; observed base ${proof.observedBaseCommit}; desired snapshot ${proof.desiredSnapshotDigest}\n`);
    expect(sheet.split("\n").filter((line) => line.startsWith("Approve "))).toEqual([`Approve subjectDigest: ${input.bundle.bundleDigest}`]);
    expect(input).toEqual(before);
    expect(changeSetDigest(set)).toBe(set.changeSetDigest);
    expect(bundleDigest(input.bundle.plan.digest, [{ id: set.repository.id, changeSetDigest: set.changeSetDigest }])).toBe(input.bundle.bundleDigest);
  });

  it.each(["optionalDependencies", "peerDependencies", "dev-dependencies", "Dependencies", "dependencies\n", "devDependencies|other", ""])("refuses malformed adoption placement %j with a fixed token", (placement) => {
    const input = edited(plannedAdoption("devDependencies"), (set) => {
      set.existingDeclarationAdoptions[0].placement = placement;
      set.existingDeclarationAdoptions[0].desired.placement = placement;
    });
    expect(refusal(input)).toBe("change-set-invalid");
  });

  it("prints Plan committed from the bundle's flag: yes when committed, no when not", () => {
    const uncommitted = planApplyBundle(setupInputs(setupObservation(), undefined, { planCommitted: false }));
    expect(renderApprovalSheet(planned()).split("\n")).toContain("Plan committed: yes");
    const sheet = renderApprovalSheet({ bundle: uncommitted.bundle, changeSets: uncommitted.changeSets });
    expect(sheet.split("\n")).toContain("Plan committed: no");
    expect(sheet.split("\n")).not.toContain("Plan committed: yes");
  });

  it("is deterministic, LF-terminated, and free of anything but printable ASCII and newlines", () => {
    const first = renderApprovalSheet(planned());
    expect(renderApprovalSheet(planned())).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(first).toMatch(/^[\x20-\x7e\n]+$/u);
  });

  it("asks for approval of exactly the bundle digest, and computes no approval", () => {
    const { bundle } = planned();
    const sheet = renderApprovalSheet(planned());
    expect(sheet.split("\n").filter((line) => line.startsWith("Approve "))).toEqual([`Approve subjectDigest: ${bundle.bundleDigest}`]);
    expect(sheet).not.toMatch(/approved|decision/iu);
  });

  it("orders the RFC 12.7 columns and prints the package as name@version and every other act as a path count", () => {
    const rows = renderApprovalSheet(planned())
      .split("\n")
      .filter((line) => line.startsWith("| "));
    expect(rows[0]).toBe("| Repository | Kind | Item | Change | Digest |");
    expect(rows[1]).toBe("| --- | --- | --- | --- | --- |");
    const cells = rows.slice(2).map((row) => row.split(" | ").map((cell) => cell.replace(/^\| | \|$/gu, "")));
    expect(cells.every((row) => row.length === 5 && /^[0-9a-f]{12}$/u.test(row[4]!))).toBe(true);
    expect(cells.find((row) => row[1] === "pin-starter")![3]).toMatch(/^@clossys\/starter@\d+\.\d+\.\d+$/u);
    expect(cells.filter((row) => row[1] !== "pin-starter" && row[1] !== "install").every((row) => /^\d+ paths?$/u.test(row[3]!))).toBe(true);
  });

  it("carries no brief or plan prose, no stored text and no file contents", () => {
    const input = planned();
    const sheet = renderApprovalSheet(input);
    for (const set of input.changeSets) {
      for (const text of Object.values(set.texts ?? {})) expect(sheet).not.toContain(String(text).slice(0, 24));
      for (const file of set.files) if ("after" in file && typeof file.after === "string") expect(sheet).not.toContain(file.after);
    }
    expect(sheet).not.toContain("Strategist");
  });

  it("lists a skipped repository by id and reason token, and prints a bundle with no change set", () => {
    const bundle = planApplyBundle(setupInputs(null, undefined, { repositories: [{ id: SITE_ID, skipped: "not-in-inventory", verdict: "indeterminate" }] })).bundle;
    const sheet = renderApprovalSheet({ bundle, changeSets: [] });
    expect(sheet).toContain(`\nSkipped:\n- ${SITE_ID} indeterminate not-in-inventory\n`);
    expect(sheet.split("\n").filter((line) => line.startsWith("| "))).toHaveLength(2);
  });

  describe("refuses, by a fixed token that echoes nothing", () => {
    it("a bundle that does not validate", () => {
      const input = planned();
      const bundle = { ...clone(input.bundle), schemaVersion: 2 } as unknown as ApplyBundle;
      expect(refusal({ ...input, bundle })).toBe("bundle-invalid");
    });

    it("a change set that does not validate", () => {
      const input = planned();
      const set = { ...clone(input.changeSets[0]!), kind: "other" } as unknown as RepositoryChangeSet;
      expect(refusal({ ...input, changeSets: [set] })).toBe("change-set-invalid");
    });

    it("a change set whose digest does not recompute (the change-set validator recomputes it)", () => {
      const input = planned();
      const set = clone(input.changeSets[0]!) as unknown as Loose;
      set.files[0].path = "changed-after-digest.txt";
      expect(refusal({ ...input, changeSets: [set as RepositoryChangeSet] })).toBe("change-set-invalid");
    });

    it("a bundle whose digest does not recompute (the bundle validator recomputes it)", () => {
      const input = planned();
      const bundle = clone(input.bundle) as unknown as Loose;
      bundle.bundleDigest = `sha256:${"0".repeat(64)}`;
      const set = { ...clone(input.changeSets[0]!), bundle: bundle.bundleDigest } as RepositoryChangeSet;
      expect(refusal({ bundle: bundle as ApplyBundle, changeSets: [set] })).toBe("bundle-invalid");
    });

    it("sets that are not exactly the bundle's", () => {
      const input = planned();
      expect(refusal({ ...input, changeSets: [] })).toBe("set-mismatch");
      expect(refusal({ ...input, changeSets: [input.changeSets[0]!, input.changeSets[0]!] })).toBe("set-mismatch");
      const other = { ...clone(input.changeSets[0]!), bundle: `sha256:${"1".repeat(64)}` } as RepositoryChangeSet;
      expect(refusal({ ...input, changeSets: [other] })).toBe("set-mismatch");
    });

    describe("with two computed sets, only one of which the bundle names", () => {
      const DOCS_ID = "example-owner/docs";

      /** A real two-repository bundle, cut down to its first entry, and the two sets it was planned with. */
      function twoSets(): { bundle: Loose; site: Loose; docs: Loose } {
        const plan = setupPlan();
        const staffed = { ...plan, staffing: [...plan.staffing!, { repository: DOCS_ID, roles: ["writer"] }], packages: [...plan.packages!, ...setupPlan({ repository: DOCS_ID }).packages!] };
        const docsObservation = setupObservation({ id: DOCS_ID, nodeId: "R_exampleDocs1" });
        const planned2 = planApplyBundle(setupInputs(setupObservation(), staffed, { repositories: [setupObservation(), docsObservation] }));
        expect(planned2.changeSets.map((set) => set.repository.id)).toEqual([SITE_ID, DOCS_ID]);
        const bundle = clone(planned2.bundle) as unknown as Loose;
        bundle.repositories = bundle.repositories.slice(0, 1);
        return { bundle, site: clone(planned2.changeSets[0]!) as unknown as Loose, docs: clone(planned2.changeSets[1]!) as unknown as Loose };
      }

      /** Names `named` (a set) in the bundle's only entry, and binds every set to the recomputed bundle digest. */
      function bound(bundle: Loose, named: Loose, ...sets: Loose[]): ApprovalSheetInput {
        bundle.repositories[0].changeSet = named.changeSetDigest;
        bundle.bundleDigest = bundleDigest(bundle.plan.digest, [{ id: bundle.repositories[0].id, changeSetDigest: named.changeSetDigest }]);
        for (const set of sets) set.bundle = bundle.bundleDigest;
        expect(validateApplyBundle(bundle).valid).toBe(true);
        for (const set of sets) expect(validateRepositoryChangeSet(set).valid).toBe(true);
        return { bundle: bundle as ApplyBundle, changeSets: sets as RepositoryChangeSet[] };
      }

      it("refuses a valid extra set the bundle does not name (the set count must match)", () => {
        const { bundle, site, docs } = twoSets();
        expect(refusal(bound(bundle, site, site, docs))).toBe("set-mismatch");
        // The same bundle with exactly its own set renders.
        const { bundle: again, site: own } = twoSets();
        expect(() => renderApprovalSheet(bound(again, own, own))).not.toThrow();
      });

      it("refuses a set that is valid and bound to the bundle but belongs to another repository than the entry naming it", () => {
        const { bundle, docs } = twoSets();
        expect(bundle.repositories[0].id).toBe(SITE_ID);
        expect(refusal(bound(bundle, docs, docs))).toBe("set-mismatch");
      });
    });
  });
});

const PLAN_DIGEST = "sha256:6395298da2ed12341ef1e86139dce75ecf9ee7a2402290627e6d46d1b6412a8d";
const BUNDLE_DIGEST = "sha256:719d13e4fd78b1e9557899eaaaaf99a9768ed0f8d19a585cdf865a8ba76325ad";

const GOLDEN = `Clossys apply plan: approval sheet
Mode: report
Plan digest: ${PLAN_DIGEST}
Plan committed: yes
Bundle digest: ${BUNDLE_DIGEST}
Authorization: plan ${PLAN_DIGEST} expires 2999-01-01T00:00:00Z
Approve subjectDigest: ${BUNDLE_DIGEST}

| Repository | Kind | Item | Change | Digest |
| --- | --- | --- | --- | --- |
| example-owner/site | write-record | agents-guide | 1 path | c20a407f12bc |
| example-owner/site | write-record | brief | 1 path | c20a407f12bc |
| example-owner/site | add-caller-workflow | caller-workflow | 3 paths | c20a407f12bc |
| example-owner/site | add-ci-template | ci-template | 1 path | c20a407f12bc |
| example-owner/site | pin-starter | example-owner/site:@clossys/starter | @clossys/starter@0.2.0 | c20a407f12bc |
| example-owner/site | write-ledger | ledger | 1 path | c20a407f12bc |
| example-owner/site | add-path-scope-job | path-scope-job | 1 path | c20a407f12bc |
| example-owner/site | compose-skills | skills | 10 paths | c20a407f12bc |
| example-owner/site | write-starter-request | starter-request | 1 path | c20a407f12bc |

Deferred:
- example-owner/site example-owner/site:@clossys/writer after-setup

Checks not satisfied:
- example-owner/site V6 indeterminate lockfile-not-run
`;
