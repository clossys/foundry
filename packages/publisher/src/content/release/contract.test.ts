import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ContentApproval, HandoverReceipt, ReleaseBundle, ReleaseInput, ReleaseManifest, ReleaseResult, TargetBuildManifest } from "../index.js";
import { reviewCandidate, validateContentRegistry } from "../index.js";
import { createContentOwnerApproval, computeContentDigest, computeReleaseDigest, prepareContentRelease } from "../node.js";
import { reviewInput } from "../review/__fixtures__/review.js";
import { refreshReleaseInput, releaseInput } from "./__fixtures__/release.js";

describe("release contract", () => {
  it("releases a real reviewed and approved bilingual admin revision", () => {
    const input: ReleaseInput = releaseInput();
    const before = structuredClone(input);
    const candidate = input.registry.candidates[0]!;
    const slot = input.registry.slots[0]!;
    const review = input.selections[0]!.review;
    expect(validateContentRegistry(input.registry)).toEqual([]);
    expect(slot).toMatchObject({ l1: "websites", l2: "admin", deployTarget: "product-admin", route: "/agents/sample", locales: ["en", "fr"] });
    expect(candidate).toMatchObject({ state: "active", revision: "r1", approval: { source: "owner", revision: "r1", digest: computeContentDigest(candidate) } });
    expect(review).toEqual(reviewCandidate({ registry: input.registry, candidateId: candidate.id, libraries: reviewInput().libraries, digest: computeContentDigest(candidate), raisedAt: input.at }));
    expect(review).toEqual({ candidateId: candidate.id, revision: "r1", digest: computeContentDigest(candidate), findings: [], needs: [], copyFindings: expect.any(Array), checkedAgainst: { libraryVersion: "1", locales: ["en", "fr"] } });
    expect(review.copyFindings?.every(finding => finding.severity === "warning" && finding.rule === "legacy-inline-copy")).toBe(true);

    const result: ReleaseResult = prepareContentRelease(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.findings));
    expect(result.findings).toEqual([]);
    expect(result.releases).toHaveLength(1);
    const bundle: ReleaseBundle = result.releases[0]!;
    const manifest: ReleaseManifest = bundle.manifest;
    const build: TargetBuildManifest = bundle.build;
    const handover: HandoverReceipt = bundle.handover;
    const { digest, ...unsigned } = manifest;
    expect(digest).toBe(computeReleaseDigest(unsigned));
    expect(manifest).toEqual({ targetId: "product-admin", n: 1, at: input.at, approvedBy: input.approvedBy, entries: [{ slotId: slot.id, candidateId: candidate.id, revision: candidate.revision, digest: computeContentDigest(candidate), route: "/agents/sample" }], digest });
    expect(build).toEqual({ targetId: "product-admin", releaseN: 1, routes: [{ slotId: slot.id, path: "/agents/sample", kind: "content", locales: ["en", "fr"], revision: candidate.revision, digest: computeContentDigest(candidate) }] });
    expect(handover).toEqual({ targetId: "product-admin", releaseN: 1, receiver: "builder", matches: false, status: "pending", observedAt: null });
    expect(input).toEqual(before);
  });

  it("refreshes actual Review evidence after a translation is removed", () => {
    const input = releaseInput();
    const oldDigest = input.selections[0]!.review.digest;
    const candidate = input.registry.candidates[0]!;
    candidate.composition!.sections[0]!.fields = candidate.composition!.sections[0]!.fields.filter(field => field.locale !== "fr");
    expect(refreshReleaseInput(input)).toBe(input);
    expect(input.selections[0]!.review.digest).not.toBe(oldDigest);
    expect(candidate.history[0]!.digest).toBe(computeContentDigest(candidate));
    expect(candidate.approval!.digest).toBe(computeContentDigest(candidate));
    expect(input.selections[0]!.review.findings).toEqual(expect.arrayContaining([expect.objectContaining({ check: "locale-coverage", rule: "missing-copy-locale" })]));
    expect(input.selections[0]!.review.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy", target: "writer" })]));
    expect(prepareContentRelease(input)).toMatchObject({ ok: false, releases: [] });
  });

  it("keeps the source content barrel loadable while all Node builtins are refused", () => {
    const input = releaseInput();
    const candidate = input.registry.candidates[0]!;
    const target = new URL("../index.ts", import.meta.url).href;
    const review = { registry: input.registry, candidateId: candidate.id, libraries: reviewInput().libraries, digest: computeContentDigest(candidate), raisedAt: input.at };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { builtinModules, register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent(
        "const builtins = new Set(" + JSON.stringify(builtinModules) + ");" +
        "export async function resolve(specifier, context, next) {" +
        "if (specifier.startsWith('node:') || builtins.has(specifier)) throw new Error('Node builtin reached: ' + specifier);" +
        "if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) specifier = specifier.slice(0, -3) + '.ts';" +
        "return next(specifier, context); }"
      ));
      const content = await import(${JSON.stringify(target)});
      const report = content.reviewCandidate(${JSON.stringify(review)});
      if (report.findings.length || report.needs.length) throw new Error('Real release fixture Review failed');
      if (JSON.stringify(report.checkedAgainst.locales) !== '["en","fr"]') throw new Error('Release locales were lost');
      for (const name of ['computeContentDigest', 'prepareContentRelease', 'computeReleaseDigest', 'createContentOwnerApproval']) {
        if (name in content) throw new Error('Node API reached source content barrel: ' + name);
      }
    `], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("digest-bound owner approval recording", () => {
  it("records explicit owner evidence without changing the candidate", () => {
    const candidate = releaseInput().registry.candidates[0]!;
    delete candidate.approval;
    const before = structuredClone(candidate);
    const evidence = { by: "release-owner", at: "2026-03-04T05:06:07Z", revision: candidate.revision, digest: computeContentDigest(candidate) };
    const approval: ContentApproval = createContentOwnerApproval(candidate, evidence);
    expect(approval).toEqual({ source: "owner", ...evidence });
    expect(candidate).toEqual(before);
    expect(candidate).not.toHaveProperty("approval");
    expect(evidence).not.toHaveProperty("source");
  });

  it.each(["digest", "revision"] as const)("refuses stale %s evidence without changing candidate metadata", key => {
    const candidate = releaseInput().registry.candidates[0]!;
    const before = structuredClone(candidate);
    const evidence = { by: "release-owner", at: "2026-03-04T05:06:07Z", revision: candidate.revision, digest: computeContentDigest(candidate) };
    if (key === "digest") evidence.digest = "0".repeat(64);
    else evidence.revision = "r2";
    expect(() => createContentOwnerApproval(candidate, evidence)).toThrow(new RegExp(`approval-${key}`));
    expect(candidate).toEqual(before);
  });
});
