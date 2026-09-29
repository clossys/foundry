import { describe, expect, it } from "vitest";
import { CANONICAL_KEYS, canonicalOrder, contentDigest, validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet, TemplateAct } from "./change-set-contract.js";
import { bundleDigest } from "./change-set-digest.js";
import { planApplyBundle } from "./plan-bundle.js";
import type { PlanApplyBundleInputs, RepositoryObservation } from "./plan-bundle.js";
import {
  SITE_ID,
  STARTER_INTEGRITY,
  STARTER_NAME,
  STARTER_PLAN_ITEM,
  STARTER_VERSION,
  WRITER_PLAN_ITEM,
  pnpmSetupObservation,
  setupInputs,
  setupObservation,
  setupPlan,
  sha,
} from "./plan-bundle-setup-fixture.js";
import { planDigest } from "./plan-digest.js";
import { editReleaseAgeExemption } from "./release-age-edit.js";
import { renderSetupTemplate } from "./setup-templates.js";

/*
 * Issue #1178. The planner computes a setup set for a repository still in the
 * setup phase: the four setup templates, the Starter pin, the deferred
 * installs, the release-age exemption for pnpm, and a skip with its own
 * reason wherever anything is ambiguous.
 */

const run = (inputs: PlanApplyBundleInputs) => planApplyBundle(inputs);
const only = (inputs: PlanApplyBundleInputs): RepositoryChangeSet => {
  const { changeSets } = run(inputs);
  expect(changeSets).toHaveLength(1);
  return changeSets[0]!;
};
const textOf = (set: RepositoryChangeSet, path: string): string | undefined => set.texts?.find((row) => row.path === path)?.text;
const fileAt = (set: RepositoryChangeSet, path: string) => set.files.find((file) => file.path === path);
const checksOf = (bundle: ApplyBundle) => bundle.repositories[0]!.checks;
const RELEASE_AGE_ITEM = { id: "release-age", act: "exempt-release-age", scope: "@clossys", surface: "pnpm-workspace", path: "pnpm-workspace.yaml" };

const TEMPLATE_ITEMS: readonly { readonly act: TemplateAct; readonly id: string }[] = [
  { act: "add-caller-workflow", id: "caller-workflow" },
  { act: "write-starter-request", id: "starter-request" },
  { act: "add-ci-template", id: "ci-template" },
  { act: "add-path-scope-job", id: "path-scope-job" },
];

function renderedFor(act: TemplateAct, manager: "npm" | "pnpm") {
  const input =
    act === "add-caller-workflow"
      ? { packageManager: manager }
      : act === "write-starter-request"
        ? { packageManager: manager, repository: SITE_ID, starter: { name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY } }
        : undefined;
  const rendered = renderSetupTemplate(act, input);
  if (!rendered.ok) throw new Error(`the template ${act} did not render`);
  return rendered.files;
}

describe("planApplyBundle: a setup set for npm", () => {
  it("validates, and holds the four templates, one Starter pin, the deferred install and no exemption", () => {
    const { bundle, changeSets } = run(setupInputs(setupObservation()));
    const set = changeSets[0]!;
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    expect(set.phase).toBe("setup");
    expect(set.ledger.generation).toBe(0);
    expect(set.items.map((item) => item.id)).toEqual(["brief", "caller-workflow", "ci-template", STARTER_PLAN_ITEM, "ledger", "path-scope-job", "skills", "starter-request"]);
    for (const act of ["add-caller-workflow", "write-starter-request", "add-ci-template", "add-path-scope-job", "pin-starter"] as const) {
      expect(set.items.filter((item) => item.act === act)).toHaveLength(1);
    }
    expect(set.items.some((item) => item.act === "exempt-release-age" || item.act === "install")).toBe(false);
    expect(set.refused).toEqual([]);
  });

  it("puts every install in deferred with the reason after-setup, and gives it no item, key or invariant", () => {
    const set = only(setupInputs(setupObservation()));
    expect(set.deferred).toEqual([{ planItem: WRITER_PLAN_ITEM, reason: "after-setup" }]);
    expect(set.items.some((item) => "planItem" in item && item.planItem === WRITER_PLAN_ITEM)).toBe(false);
    expect(set.keys.map((key) => key.pointer)).toEqual([`/devDependencies/${STARTER_NAME.replace("/", "~1")}`]);
    const lockfile = set.files.find((file) => "derived" in file && file.path === "package-lock.json");
    expect(lockfile && "invariants" in lockfile ? lockfile.invariants : null).toEqual([{ item: STARTER_PLAN_ITEM, name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY }]);
    const pin = set.items.find((item) => item.act === "pin-starter");
    expect(pin).toMatchObject({ id: STARTER_PLAN_ITEM, planItem: STARTER_PLAN_ITEM, placement: "devDependencies", satisfiedInBase: false });
  });

  it("writes template bytes only from renderSetupTemplate(), each file a create, and lists the template patterns", () => {
    const set = only(setupInputs(setupObservation()));
    for (const { act, id } of TEMPLATE_ITEMS) {
      for (const file of renderedFor(act, "npm")) {
        expect(textOf(set, file.path)).toBe(file.bytes);
        expect(fileAt(set, file.path)).toEqual({ path: file.path, mode: "100644", before: null, after: contentDigest(file.bytes), item: id });
      }
    }
    for (const pattern of [".github/scripts/clossys-*", ".github/workflows/clossys-*", ".starter/request.json"]) expect(set.pathAllowList).toContain(pattern);
    expect(new Set(set.pathAllowList).size).toBe(set.pathAllowList.length);
  });

  it("names the repository, the manager and the pin in the Starter request, and no hub or advisor", () => {
    const set = only(setupInputs(setupObservation()));
    const request = JSON.parse(textOf(set, ".starter/request.json")!);
    expect(request.packageManager).toBe("npm");
    expect(request.snapshot.repository).toBe(SITE_ID);
    expect(request.starter).toMatchObject({ name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY });
    expect(JSON.stringify(request)).not.toMatch(/advisor|hub/u);
  });

  it("reports the lockfile as not run, and nothing else, for a set the templates and the pin fully describe", () => {
    const { bundle } = run(setupInputs(setupObservation()));
    expect(checksOf(bundle)).toEqual([{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V8", verdict: "satisfied" }]);
  });

  it("gives the same bytes for the same inputs", () => {
    const inputs = setupInputs(setupObservation());
    expect(JSON.stringify(run(inputs))).toBe(JSON.stringify(run(setupInputs(setupObservation()))));
    expect(JSON.stringify(run(inputs))).toBe(JSON.stringify(run(inputs)));
  });

  it("keeps the pin as an item that writes nothing when the base already holds it", () => {
    const observation = setupObservation({
      manifestEntries: [{ placement: "devDependencies", name: STARTER_NAME, value: STARTER_VERSION }],
      lockedPackages: [{ name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY }],
    });
    const set = only(setupInputs(observation));
    expect(set.items.find((item) => item.act === "pin-starter")).toMatchObject({ satisfiedInBase: true });
    expect(set.keys).toEqual([]);
  });

  it("gives a setup set with root entries needed the declare-root-entry item and the edited profile", () => {
    const profilePath = "governance/repository-profile.json";
    const text = `${JSON.stringify({ schemaVersion: 3, rootEntries: [{ name: "README.md", classification: "canonical", disposition: "allowed" }] }, null, 2)}\n`;
    const undeclaredRoots = [".agents", ".claude", ".cursor", ".github", ".starter", "clossys"];
    const observation = setupObservation({
      repositoryProfile: { path: profilePath, rootVocabulary: "checked", undeclaredRoots, prohibitedRoots: [] },
      repositoryProfileText: text,
      files: [
        { path: "package-lock.json", sha256: sha("lock") },
        { path: profilePath, sha256: sha(text) },
      ],
    });
    const set = only(setupInputs(observation));
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    const declared = set.items.find((item) => item.act === "declare-root-entry");
    expect(declared).toMatchObject({ path: profilePath });
    expect(declared && "entries" in declared ? declared.entries.map((entry) => entry.name) : []).toEqual(undeclaredRoots);
    expect(fileAt(set, profilePath)).toMatchObject({ before: sha(text), item: "root-entries" });
  });
});

describe("planApplyBundle: a setup set for pnpm", () => {
  it("creates the exemption file when the repository has none", () => {
    const set = only(setupInputs(pnpmSetupObservation(null)));
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(set.items.filter((item) => item.act === "exempt-release-age")).toEqual([RELEASE_AGE_ITEM]);
    const edited = editReleaseAgeExemption({ surface: "pnpm-workspace", text: null });
    if (edited.kind !== "edited") throw new Error("expected an edit");
    expect(textOf(set, "pnpm-workspace.yaml")).toBe(edited.text);
    expect(fileAt(set, "pnpm-workspace.yaml")).toEqual({ path: "pnpm-workspace.yaml", mode: "100644", before: null, after: contentDigest(edited.text), item: "release-age" });
    expect(set.pathAllowList).toContain("pnpm-workspace.yaml");
    expect(set.refused).toEqual([]);
  });

  it("edits the exemption file the repository has, from its observed digest", () => {
    const surface = "packages:\n  - 'apps/*'\n";
    const set = only(setupInputs(pnpmSetupObservation(surface)));
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    const edited = editReleaseAgeExemption({ surface: "pnpm-workspace", text: surface });
    if (edited.kind !== "edited") throw new Error("expected an edit");
    expect(textOf(set, "pnpm-workspace.yaml")).toBe(edited.text);
    expect(fileAt(set, "pnpm-workspace.yaml")).toMatchObject({ before: sha(surface), after: contentDigest(edited.text), item: "release-age" });
    expect(edited.text.startsWith(surface.slice(0, -1))).toBe(true);
  });

  it("gives the item and no file when the surface already lists the entry", () => {
    const surface = "minimumReleaseAgeExclude:\n  - '@clossys/*'\n";
    const set = only(setupInputs(pnpmSetupObservation(surface)));
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(set.items.filter((item) => item.act === "exempt-release-age")).toEqual([RELEASE_AGE_ITEM]);
    expect(fileAt(set, "pnpm-workspace.yaml")).toBeUndefined();
    expect(set.refused).toEqual([]);
    expect(textOf(set, "pnpm-workspace.yaml")).toBeUndefined();
    expect(set.pathAllowList).toContain("pnpm-workspace.yaml");
  });

  it("refuses an unparseable surface as a path refusal with the editor's reason, and reports it in V6", () => {
    const { bundle, changeSets } = run(setupInputs(pnpmSetupObservation("packages:\n\t- a\n")));
    const set = changeSets[0]!;
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(set.refused).toEqual([{ path: "pnpm-workspace.yaml", reason: "release-age-surface-unparseable", item: "release-age" }]);
    expect(fileAt(set, "pnpm-workspace.yaml")).toBeUndefined();
    expect(checksOf(bundle)).toContainEqual({ check: "V6", verdict: "indeterminate", rule: "release-age-surface-unparseable" });
    expect(bundle.repositories[0]!.verdict).toBe("indeterminate");
  });

  it("refuses a surface whose .npmrc sets the same list, with the editor's reason and a V6 check", () => {
    const npmrc = "minimum-release-age-exclude=example\n";
    const observation = pnpmSetupObservation(null, {
      releaseAgeSurfaces: [{ surface: "npmrc", path: ".npmrc" }],
      files: [
        { path: "pnpm-lock.yaml", sha256: sha("pnpm lock") },
        { path: ".npmrc", sha256: sha(npmrc) },
      ],
      npmrcText: npmrc,
    });
    const { bundle, changeSets } = run(setupInputs(observation));
    const set = changeSets[0]!;
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(set.refused).toEqual([{ path: "pnpm-workspace.yaml", reason: "release-age-surface-conflict", item: "release-age" }]);
    expect(fileAt(set, "pnpm-workspace.yaml")).toBeUndefined();
    expect(checksOf(bundle)).toContainEqual({ check: "V6", verdict: "indeterminate", rule: "release-age-surface-conflict" });
  });

  it("refuses a directory where the exemption file would go, rather than writing over it", () => {
    const observation = pnpmSetupObservation(null, { files: [{ path: "pnpm-lock.yaml", sha256: sha("pnpm lock") }, { path: "pnpm-workspace.yaml/inner.yaml", sha256: sha("x") }] });
    const set = only(setupInputs(observation));
    expect(set.refused).toEqual([{ path: "pnpm-workspace.yaml", reason: "release-age-surface-unparseable", item: "release-age" }]);
    expect(fileAt(set, "pnpm-workspace.yaml")).toBeUndefined();
  });

  it("gives the same bytes for the same inputs", () => {
    const build = () => setupInputs(pnpmSetupObservation("packages:\n  - 'apps/*'\n"));
    expect(JSON.stringify(run(build()))).toBe(JSON.stringify(run(build())));
  });

  it("writes the pnpm variant of the caller workflow", () => {
    const set = only(setupInputs(pnpmSetupObservation(null)));
    const rendered = renderedFor("add-caller-workflow", "pnpm");
    for (const file of rendered) expect(textOf(set, file.path)).toBe(file.bytes);
    expect(textOf(set, ".github/workflows/clossys-adoption-decision.yml")).toContain("pnpm install --frozen-lockfile --ignore-scripts");
  });
});

describe("planApplyBundle: the adoption pass of a setup set", () => {
  const OLD_WRITER = "# Writer, as an earlier Launcher composed it\n";

  it("adopts a composed skill whose bytes the skills manifest records, with a before equal to the base", () => {
    const path = ".agents/skills/clossys-writer/SKILL.md";
    const observation = setupObservation({
      files: [
        { path: "package-lock.json", sha256: sha("lock") },
        { path, sha256: sha(OLD_WRITER) },
      ],
      skillsManifest: [{ name: "writer", sha256: sha(OLD_WRITER).slice("sha256:".length) }],
    });
    const set = only(setupInputs(observation));
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(fileAt(set, path)).toMatchObject({ before: sha(OLD_WRITER), after: sha("# Writer\n"), item: "skills" });
    expect(set.refused).toEqual([]);
  });

  it("does not adopt a skill the manifest does not record, or records at other bytes", () => {
    const path = ".agents/skills/clossys-writer/SKILL.md";
    for (const skillsManifest of [null, [{ name: "writer", sha256: "0".repeat(64) }], [{ name: "strategist", sha256: sha(OLD_WRITER).slice(7) }]]) {
      const set = only(setupInputs(setupObservation({ files: [{ path: "package-lock.json", sha256: sha("lock") }, { path, sha256: sha(OLD_WRITER) }], skillsManifest })));
      expect(set.refused).toContainEqual({ path, reason: "unowned-existing", item: "skills" });
      expect(fileAt(set, path)).toBeUndefined();
    }
  });

  it("refuses a foreign clossys-ci.yml as unowned-existing, and writes nothing at it", () => {
    const path = ".github/workflows/clossys-ci.yml";
    const { bundle, changeSets } = run(setupInputs(setupObservation({ files: [{ path: "package-lock.json", sha256: sha("lock") }, { path, sha256: sha("name: Foreign\n") }] })));
    const set = changeSets[0]!;
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
    expect(set.refused).toEqual([{ path, reason: "unowned-existing", item: "ci-template" }]);
    expect(fileAt(set, path)).toBeUndefined();
    expect(set.items.some((item) => item.act === "add-ci-template")).toBe(true);
    expect(checksOf(bundle)).toContainEqual({ check: "V8", verdict: "indeterminate", rule: "unowned-existing" });
  });

  it("adopts a template file whose bytes are exactly the set's own", () => {
    const path = ".github/workflows/clossys-ci.yml";
    const own = renderedFor("add-ci-template", "npm")[0]!.bytes;
    const set = only(setupInputs(setupObservation({ files: [{ path: "package-lock.json", sha256: sha("lock") }, { path, sha256: sha(own) }] })));
    expect(fileAt(set, path)).toEqual({ path, mode: "100644", before: sha(own), after: sha(own), item: "ci-template" });
    expect(set.refused).toEqual([]);
  });
});

describe("planApplyBundle: what a setup repository is skipped for", () => {
  const skipped = (inputs: PlanApplyBundleInputs, reason: string) => {
    const { bundle, changeSets } = run(inputs);
    expect(changeSets).toEqual([]);
    expect(bundle.repositories).toEqual([{ id: inputs.plan.staffing![0]!.repository, verdict: "indeterminate", reason, checks: [] }]);
    expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(inputs.plan), []));
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
  };

  it("skips a package manager that is neither npm nor pnpm as package-manager-unsupported", () => {
    skipped(setupInputs(setupObservation({ packageManager: "yarn", lockfile: "yarn.lock" })), "package-manager-unsupported");
    skipped(setupInputs(setupObservation({ packageManager: "none", lockfile: "none" })), "package-manager-unsupported");
  });

  it("skips a plan with no Starter pin for the repository as starter-pin-absent", () => {
    skipped(setupInputs(setupObservation(), setupPlan({ withoutStarter: true })), "starter-pin-absent");
  });

  it("skips a pin outside STARTER_PIN_RANGE as starter-pin-unsupported", () => {
    for (const starterVersion of ["0.1.9", "0.3.0", "1.0.0"]) skipped(setupInputs(setupObservation(), setupPlan({ starterVersion })), "starter-pin-unsupported");
  });

  it("skips a pnpm surface or .npmrc without its exact text as release-age-text-absent", () => {
    const surface = "packages:\n  - 'apps/*'\n";
    const { pnpmWorkspaceText: _dropped, ...withoutText } = pnpmSetupObservation(surface);
    skipped(setupInputs(withoutText as RepositoryObservation), "release-age-text-absent");
    const npmrc = "registry=https://registry.npmjs.org/\n";
    const observation = pnpmSetupObservation(null, {
      releaseAgeSurfaces: [{ surface: "npmrc", path: ".npmrc" }],
      files: [{ path: "pnpm-lock.yaml", sha256: sha("pnpm lock") }, { path: ".npmrc", sha256: sha(npmrc) }],
    });
    skipped(setupInputs(observation), "release-age-text-absent");
  });

  it("skips a request that cannot be rendered as starter-request-invalid", () => {
    // A bare repository name is an inventory id, but the request names the repository as owner/name.
    skipped({ ...setupInputs(setupObservation({ id: "site" }), setupPlan({ repository: "site" })) }, "starter-request-invalid");
    // The request names one Starter only.
    const other = setupPlan({ starterName: "@example/starter" });
    skipped(setupInputs(setupObservation(), other), "starter-request-invalid");
  });

  it("skips an apply set whose pin-starter writes a key as starter-request-stale", () => {
    skipped(setupInputs(setupObservation({ phase: "apply" })), "starter-request-stale");
  });

  it("does not skip an apply set whose pin-starter writes nothing", () => {
    const observation = setupObservation({
      phase: "apply",
      manifestEntries: [{ placement: "devDependencies", name: STARTER_NAME, value: STARTER_VERSION }],
      lockedPackages: [{ name: STARTER_NAME, version: STARTER_VERSION, integrity: STARTER_INTEGRITY }],
    });
    const { changeSets } = run(setupInputs(observation, setupPlan({ withoutInstall: true })));
    expect(changeSets).toHaveLength(1);
  });

  it("leaves a skipped repository out of the digest of a bundle that also holds a computed one", () => {
    const plan = setupPlan();
    const staffed = { ...plan, staffing: [...plan.staffing!, { repository: "example-owner/docs", roles: ["writer"] }] };
    const docs: RepositoryObservation = { ...setupObservation({ id: "example-owner/docs", nodeId: "R_exampleDocs1", packageManager: "yarn", lockfile: "yarn.lock" }) };
    const inputs = setupInputs(setupObservation(), staffed, { repositories: [setupObservation(), docs] });
    const { bundle, changeSets } = run(inputs);
    expect(changeSets.map((set) => set.repository.id)).toEqual([SITE_ID]);
    expect(bundle.repositories.map((entry) => ("changeSet" in entry ? "computed" : entry.reason))).toEqual(["computed", "package-manager-unsupported"]);
    expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(staffed), changeSets.map((set) => ({ id: set.repository.id, changeSetDigest: set.changeSetDigest }))));
  });
});

describe("planApplyBundle: the exact text of the release-age surfaces", () => {
  it("throws, naming no value, when pnpmWorkspaceText is not the file the observation digests", () => {
    const surface = "packages:\n  - 'apps/*'\n";
    const observation = pnpmSetupObservation(surface, { pnpmWorkspaceText: `${surface}# edited\n` });
    expect(() => run(setupInputs(observation))).toThrow(/pnpmWorkspaceText/u);
    expect(() => run(setupInputs(observation))).toThrow(TypeError);
    expect(() => run(setupInputs(pnpmSetupObservation(null, { pnpmWorkspaceText: surface })))).toThrow(/pnpmWorkspaceText/u);
  });

  it("throws when npmrcText is not the file the observation digests", () => {
    const npmrc = "registry=https://registry.npmjs.org/\n";
    const observation = pnpmSetupObservation(null, {
      releaseAgeSurfaces: [{ surface: "npmrc", path: ".npmrc" }],
      files: [{ path: "pnpm-lock.yaml", sha256: sha("pnpm lock") }, { path: ".npmrc", sha256: sha(npmrc) }],
      npmrcText: `${npmrc}# edited\n`,
    });
    expect(() => run(setupInputs(observation))).toThrow(/npmrcText/u);
  });

  it("accepts an .npmrc that changes nothing about the exemption", () => {
    const npmrc = "registry=https://registry.npmjs.org/\n";
    const observation = pnpmSetupObservation(null, {
      releaseAgeSurfaces: [{ surface: "npmrc", path: ".npmrc" }],
      files: [{ path: "pnpm-lock.yaml", sha256: sha("pnpm lock") }, { path: ".npmrc", sha256: sha(npmrc) }],
      npmrcText: npmrc,
    });
    const set = only(setupInputs(observation));
    expect(fileAt(set, "pnpm-workspace.yaml")).toMatchObject({ before: null });
  });
});

describe("planApplyBundle: canonical order", () => {
  it("writes the items, files and deferrals of a setup set in canonical order", () => {
    const set = only(setupInputs(pnpmSetupObservation("packages:\n  - 'apps/*'\n")));
    expect(set.items).toEqual(canonicalOrder(set.items, CANONICAL_KEYS.item));
    expect(set.files).toEqual(canonicalOrder(set.files, CANONICAL_KEYS.file));
    expect(set.deferred).toEqual(canonicalOrder(set.deferred, CANONICAL_KEYS.deferral));
    expect(set.pathAllowList).toEqual(canonicalOrder(set.pathAllowList, CANONICAL_KEYS.pattern));
  });
});
