// @vitest-environment jsdom
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkImportPurity } from "../../../../scripts/lib/import-purity.mjs";
import {
  WEB_ROLE_PAIR_EVIDENCE, WEB_ROLE_PAIR_BINDINGS, validateWebRolePairEvidence, validateBlockRoleBinding,
} from "./index.js";
import type { WebRolePairEvidence, WebRolePairCheck } from "./index.js";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { SiteFrame, LegalView, CaptureView, SITE_MAIN_ID } from "../web/index.js";
import { LandingView } from "@clossys/designer/frames";
import type { SiteShellInput } from "../web/index.js";
import { LEGAL_SECTION_IDS } from "../document/legal.js";
import type { LegalDocument } from "../document/legal.js";
import type { CopyResolver } from "@clossys/writer";

const fixture = {
  shell: { brand: { assetId: "example-mark", label: { id: "brand" }, size: "md", variant: "mark" },
    skipLink: { id: "skip" }, footer: { legal: { entity: { id: "entity" }, links: [] } } } satisfies SiteShellInput,
  asset: { type: "image", src: "/example.svg", width: 32, height: 32, alt: "Example" },
  landing: {
    id: "example-landing",
    resolutions: [{ ref: { id: "heading" }, text: "Example landing", recordId: "example", revision: "1", locale: "en-US",
      source: { kind: "consumer", reference: "fixture" }, entryId: "heading" }],
    sections: [{ id: "hero", kind: "hero", ground: "base", heading: "Example landing" }],
  },
  legal: { id: "example-terms", title: { id: "title" }, sections: LEGAL_SECTION_IDS.terms.map(id => ({
    kind: "section", id, level: 2, heading: { id: id + ".heading" },
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: { id: id + ".body" } }] }],
  })), legal: { kind: "terms", status: "counsel-reviewed", effectiveDate: "2026-01-01", lastUpdated: "2026-01-02",
    variables: { entity: "Example entity", jurisdiction: "Example jurisdiction", contact: "Example contact" } } } as LegalDocument,
  labels: { effectiveDate: { id: "effective" }, lastUpdated: { id: "updated" }, draftHeading: { id: "draft" } },
  capture: { heading: "Example capture", formLabel: "Example form", fields: "Example fields" },
  locale: "en-US", copy: "Example ",
} as const;
const resolveCopy: CopyResolver = ref => ({ ref, text: fixture.copy + ref.id, recordId: "example", revision: "1", locale: fixture.locale,
  source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
function view(name: string, mutant = ""): ReactElement {
  if (name === "LandingView") return <LandingView document={fixture.landing} landmark={mutant === "landing" ? undefined : "none"} />;
  if (name === "LegalView") return <LegalView document={fixture.legal}
    {...(mutant === "legal" ? { brand: "Example" } : { framed: true as const })}
    labels={fixture.labels} locale={fixture.locale} resolveCopyId={resolveCopy} />;
  const content = <CaptureView heading={fixture.capture.heading} formLabel={fixture.capture.formLabel}
    {...(mutant === "ground" ? { ground: "base" as const } : {})} {...(mutant === "header" ? { header: null } : {})}
    form={<p>{fixture.capture.fields}</p>} />;
  return mutant === "view" ? <div role="main">{content}</div> : content;
}
function parse(element: ReactElement): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(element);
  return root;
}
function measure(name: string, mutant = "") {
  const standalone = parse(view(name, mutant));
  const composed = parse(<SiteFrame shell={fixture.shell} resolveCopy={resolveCopy} resolveAsset={() => fixture.asset}>{view(name, mutant)}</SiteFrame>);
  const target = composed.querySelector(`main#${SITE_MAIN_ID}`)!;
  if (mutant === "frame") target.replaceWith(...target.childNodes);
  if (mutant === "missing") target.removeAttribute("id");
  if (mutant === "duplicate") composed.appendChild(target.cloneNode(false));
  if (mutant === "mismatch") composed.querySelector(`a[href='#${SITE_MAIN_ID}']`)!.setAttribute("href", "#different");
  const main = composed.querySelector(`main#${SITE_MAIN_ID}`);
  const chrome = "header, footer, [role~='banner'], [role~='contentinfo']";
  const pageChrome = (root: HTMLElement) => [...root.querySelectorAll(chrome)].filter(node =>
    node.matches("[role~='banner'], [role~='contentinfo']") || node.parentElement?.closest("article, aside, nav, section") === null);
  const observations = {
    standaloneMain: standalone.querySelectorAll("main, [role~='main']").length,
    standaloneChrome: pageChrome(standalone).length,
    composedMain: composed.querySelectorAll("main, [role~='main']").length,
    frameMain: composed.querySelectorAll(`:scope > div > main#${SITE_MAIN_ID}`).length,
    skipLinks: composed.querySelectorAll(`a[href='#${SITE_MAIN_ID}']`).length,
    skipTargets: composed.querySelectorAll(`[id='${SITE_MAIN_ID}']`).length,
    viewMain: main?.querySelectorAll("main, [role~='main']").length ?? 0,
    viewContent: main?.querySelectorAll("h1").length ?? 0,
    chromeOutsideMain: pageChrome(composed).filter(node => !node.closest("main, [role~='main']")).length,
    chromeInsideMain: pageChrome(composed).filter(node => node.closest("main, [role~='main']")).length,
  };
  return observations;
}
const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const sourcePath = (path: string) => resolve(PACKAGE_ROOT, path);
const gitSourcePath = (path: string) => path.startsWith("../designer/") ? `packages/designer/${path.slice("../designer/".length)}` : `packages/publisher/${path}`;
const SOURCE_FILES = [
  "src/web/index.ts",
  "src/web/frame/index.ts",
  "src/web/server.ts",
  "../designer/src/frames/site-frame/site-frame-contract.ts",
  "../designer/src/frames/site-frame/NavLinks.tsx",
  "../designer/src/frames/site-frame/NavDisclosure.client.tsx",
  "../designer/src/frames/site-frame/NavDisclosure.server.tsx",
  "../designer/src/frames/site-frame/NavDisclosure.boundary.client.tsx",
  "../designer/src/frames/site-frame/SiteFrame.tsx",
  "../designer/src/frames/site-frame/types.ts",
  "../designer/src/frames/site-frame/SkipLink.client.tsx",
  "../designer/src/frames/site-frame/internal/resolveShell.ts",
  "src/web/views/index.ts",
  "../designer/src/frames/site-frame/landing/web/views/LandingView.tsx",
  "../designer/src/frames/site-frame/landing/web/views/LandingViewContent.tsx",
  "src/web/views/SectionedViewContent.tsx",
  "src/web/views/SectionedViewBlocks.tsx",
  "src/web/views/LegalView.tsx",
  "src/web/views/CaptureView.tsx",
  "src/web/internal/viewContentRoot.ts",
  "src/web/internal/PageLayout.tsx",
  "src/document/legal.ts",
  "src/document/render.ts",
  "../designer/src/frames/index.ts",
  "../designer/src/frames/server.ts",
  "../designer/src/frames/site-frame/copy-contract.ts",
  "../designer/src/frames/site-frame/landing/core/content-asset.ts",
  "../designer/src/frames/site-frame/landing/core/content-contract.ts",
  "../designer/src/frames/site-frame/landing/core/content-ground.ts",
  "../designer/src/frames/site-frame/landing/core/page-flow.ts",
  "../designer/src/frames/site-frame/landing/core/sectioned-view.ts",
  "../designer/src/frames/site-frame/landing/core/status-list-catalog.ts",
  "../designer/src/frames/site-frame/landing/core/types.ts",
  "../designer/src/frames/site-frame/landing/internal/assets.ts",
  "../designer/src/frames/site-frame/landing/internal/errors.ts",
  "../designer/src/frames/site-frame/landing/internal/href.ts",
  "../designer/src/frames/site-frame/landing/internal/prose-text.ts",
  "../designer/src/frames/site-frame/landing/web/buildAssetElement.tsx",
  "../designer/src/frames/site-frame/landing/web/types.ts",
  "../designer/src/frames/site-frame/landing/web/views/LandingView.server.tsx",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewActions.tsx",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewBlocks.server.tsx",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewBlocks.tsx",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewCanonical.ts",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewContent.tsx",
  "../designer/src/frames/site-frame/landing/web/views/SectionedViewContentSection.tsx",
  "../designer/src/frames/site-frame/landing/web/views/landingViewGrounds.ts",
  "../designer/src/frames/site-frame/viewChromeGround.ts",
];

const SELECTORS: Record<WebRolePairCheck, string> = {
  standaloneMain: "main, [role~='main']", standaloneChrome: "header, footer, [role~='banner'], [role~='contentinfo']",
  composedMain: "main, [role~='main']", frameMain: ":scope > div > main#publisher-main-content",
  skipLinks: "a[href='#publisher-main-content']", skipTargets: "[id='publisher-main-content']",
  viewMain: "main#publisher-main-content main, main#publisher-main-content [role~='main']", viewContent: "main#publisher-main-content h1",
  chromeOutsideMain: "header, footer, [role~='banner'], [role~='contentinfo']", chromeInsideMain: "header, footer, [role~='banner'], [role~='contentinfo']",
};
const expected = { standaloneMain: 0, standaloneChrome: 0, composedMain: 1, frameMain: 1,
  skipLinks: 1, skipTargets: 1, viewMain: 0, viewContent: 1, chromeOutsideMain: 2, chromeInsideMain: 0 };
const sha = (value: string | Buffer): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function fresh(index: number, mutant = "", measuredAt = WEB_ROLE_PAIR_EVIDENCE[index]!.measuredAt): WebRolePairEvidence {
  const record = WEB_ROLE_PAIR_EVIDENCE[index]!;
  const observations = measure(record.identity.viewBlockRef.adapter.export, mutant);
  const joined = validateBlockRoleBinding(WEB_ROLE_PAIR_BINDINGS[index], WEB_ROLE_PAIR_BINDINGS.flatMap(binding => [binding.frameBlockRef, binding.viewBlockRef]));
  if (!("identity" in joined) || !joined.identity) throw new Error("Missing fresh identity");
  return { ...JSON.parse(JSON.stringify(record)), identity: joined.identity, measuredAt, fixtureDigest: sha(JSON.stringify(fixture)),
    sourceDigests: Object.fromEntries(SOURCE_FILES.map(path => [path, sha(readFileSync(sourcePath(path)))])),
    checks: Object.fromEntries(Object.entries(observations).map(([key, count]) => [key, {
      count, selector: SELECTORS[key as WebRolePairCheck],
      status: count === expected[key as WebRolePairCheck] ? "measured" : "violated",
    }])) as WebRolePairEvidence["checks"] };
}
const validate = validateWebRolePairEvidence;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
describe("web role-pair evidence", () => {
  it.each([0, 1, 2])("re-measures the independent real pair %i", index => {
    const record = WEB_ROLE_PAIR_EVIDENCE[index]!;
    const measurement = fresh(index);
    expect(Object.fromEntries(Object.entries(measurement.checks).map(([key, value]) => [key, value.count]))).toEqual(expected);
    expect(validate(record, WEB_ROLE_PAIR_BINDINGS[index], measurement)).toEqual({ status: "measured", reasons: [] });
    expect(measurement).toEqual(fresh(index));
    expect(validate(record, WEB_ROLE_PAIR_BINDINGS[index]).status).toBe("unmeasured");
    expect(record.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(record.measuredAt).toBe(WEB_ROLE_PAIR_BINDINGS[index]!.frameBlockRef.evidence.measuredAt);
    expect(record.measuredAt).toBe(WEB_ROLE_PAIR_BINDINGS[index]!.viewBlockRef.evidence.measuredAt);
    expect(record.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(record.identity.viewBlockRef.adapter.export).toBe(["LandingView", "LegalView", "CaptureView"][index]);
    expect(WEB_ROLE_PAIR_BINDINGS[index]!.viewBlockRef.adapter.config).toEqual([{ landmark: "none" }, { framed: true }, {}][index]);
    expect(WEB_ROLE_PAIR_BINDINGS[index]!.frameBlockRef.adapter.config).toEqual({});
    expect(Object.keys(record.sourceDigests)).toEqual(SOURCE_FILES);
    expect(Object.fromEntries(Object.entries(record.checks).map(([key, check]) => [key, check.selector]))).toEqual(SELECTORS);
    for (const [path, digest] of Object.entries(record.sourceDigests)) {
      expect(sha(execFileSync("git", ["show", `${record.sourceRevision}:${gitSourcePath(path)}`]))).toBe(digest);
    }
  });
  it.each([
    ["Landing drops landmark none", "LandingView", "landing", "standaloneMain", 1],
    ["Legal drops framed", "LegalView", "legal", "standaloneMain", 1],
    ["Capture adds ground base", "CaptureView", "ground", "standaloneMain", 1],
    ["Capture header null", "CaptureView", "header", "standaloneMain", 1],
    ["frame loses main", "CaptureView", "frame", "frameMain", 0],
    ["view adds main", "CaptureView", "view", "standaloneMain", 1],
    ["skip target missing", "CaptureView", "missing", "skipTargets", 0],
    ["skip target duplicate", "CaptureView", "duplicate", "skipTargets", 2],
    ["skip target mismatched", "CaptureView", "mismatch", "skipLinks", 0],
  ] as const)("kills %s", (_label, name, mutant, check, count) => {
    const observations = measure(name, mutant);
    expect(observations[check]).toBe(count);
    expect(observations).not.toEqual(expected);
    const index = ["LandingView", "LegalView", "CaptureView"].indexOf(name);
    const changed = fresh(index, mutant);
    expect(changed.checks[check].status).toBe("violated");
    expect(validate(WEB_ROLE_PAIR_EVIDENCE[index], WEB_ROLE_PAIR_BINDINGS[index], changed).status).toBe("violated");
  });
  it("refuses refs or roles swapped, config/context drift and unknown adapters", () => {
    const binding = WEB_ROLE_PAIR_BINDINGS[0]!;
    const record = WEB_ROLE_PAIR_EVIDENCE[0]!;
    const mutations = [
      { ...copy(binding), frameBlockRef: { ...copy(binding.frameBlockRef), qualified: true } },
      { ...copy(binding), viewBlockRef: { ...copy(binding.viewBlockRef), evidence: { ...binding.viewBlockRef.evidence, sourceRevision: "0".repeat(40) } } },
      { ...copy(binding), viewBlockRef: { ...copy(binding.viewBlockRef), status: "qualified" } },
      { ...copy(binding), frameBlockRef: copy(binding.viewBlockRef), viewBlockRef: copy(binding.frameBlockRef) },
      { ...copy(binding), frameBlockRef: { ...copy(binding.frameBlockRef), role: "view" } },
      { ...copy(binding), context: { ...binding.context, brand: "another" } },
      { ...copy(binding), context: { ...binding.context, consumer: "another" } },
      { ...copy(binding), viewBlockRef: { ...copy(binding.viewBlockRef), adapter: { ...copy(binding.viewBlockRef.adapter), config: {} } } },
      { ...copy(binding), viewBlockRef: { ...copy(binding.viewBlockRef), adapter: { ...copy(binding.viewBlockRef.adapter), export: "Unknown" } } },
    ];
    for (const changed of mutations) expect(validate(record, changed, fresh(0)).status).toBe("violated");
  });
  it("refuses source drift, forged observation, fake qualified, and record substitution", () => {
    const record = WEB_ROLE_PAIR_EVIDENCE[0]!;
    const binding = WEB_ROLE_PAIR_BINDINGS[0]!;
    for (const changed of [
      { ...copy(record), sourceRevision: "0".repeat(40) },
      { ...copy(record), measuredAt: "2026-10-17" },
      { ...copy(record), fixtureDigest: sha("changed fixture") },
      { ...copy(record), sourceDigests: { ...record.sourceDigests, "../designer/src/frames/site-frame/SiteFrame.tsx": sha("changed source") } },
      { ...copy(record), checks: { ...copy(record.checks), composedMain: { ...record.checks.composedMain, count: 2 } } },
      { ...copy(record), qualified: true }, { ...copy(record), status: "qualified" },
    ]) {
      expect(validate(changed, binding, changed).status).toBe("violated");
      expect(validate(record, binding, changed).status).toBe("violated");
    }
    for (const index of [1, 2]) expect(validate(record, WEB_ROLE_PAIR_BINDINGS[index], fresh(index)).status).toBe("violated");
  });
  it("keeps frozen anchors and rejects accessors, cycles, booleans and result wrappers", () => {
    const record = WEB_ROLE_PAIR_EVIDENCE[0]!;
    expect(() => { record.checks.composedMain.count = 2; }).toThrow();
    expect(() => { WEB_ROLE_PAIR_BINDINGS[0]!.viewBlockRef.adapter.export = "Unknown"; }).toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const sparse = copy(record);
    sparse.limits = Object.assign(new Array(record.limits.length), Object.fromEntries(record.limits.map((value, index) => ["extra" + index, value])));
    let reads = 0;
    for (const invalid of [true, cycle, sparse, { status: "measured", record }, { get identity() { reads++; return record.identity; } }]) {
      expect(validate(invalid, WEB_ROLE_PAIR_BINDINGS[0], fresh(0)).status).toBe("violated");
    }
    expect(reads).toBe(0);
  });
  it("keeps core pure", () => {
    expect(checkImportPurity({ root: PACKAGE_ROOT, entries: ["src/core/web-role-pair-evidence.ts"], allowedBuiltins: [], allowedPackages: [] }).findings).toEqual([]);
  });
});

// Explicit maintainer operation: derive retained data from this unit's real
// structural measurer, only after committing the measured source snapshot.
it("regenerates retained role-pair measurements on explicit request", () => {
  if (process.env.UPDATE_WEB_ROLE_PAIR_EVIDENCE !== "1") return;
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const measuredAt = new Date().toISOString().slice(0, 10);
  const records = [0, 1, 2].map(index => fresh(index, "", measuredAt));
  for (const measurement of records) {
    expect(measurement.measuredAt).toBe(measuredAt);
    expect(Object.fromEntries(Object.entries(measurement.checks).map(([key, value]) => [key, value.count]))).toEqual(expected);
    for (const [path, digest] of Object.entries(measurement.sourceDigests)) {
      expect(sha(execFileSync("git", ["show", `${revision}:${gitSourcePath(path)}`]))).toBe(digest);
    }
  }
  const path = sourcePath("src/core/web-role-pair-evidence.ts");
  const source = readFileSync(path, "utf8")
    .replace(/const revision = "[a-f0-9]{40}";/, `const revision = "${revision}";`)
    .replace(/const measuredAt = "\d{4}-\d{2}-\d{2}";/, `const measuredAt = "${measuredAt}";`)
    .replace(/const sources = \{[\s\S]*?\n\} as const;/, `const sources = ${JSON.stringify(records[0]!.sourceDigests, null, 2)} as const;`)
    .replace(/fixtureDigest: "sha256:[a-f0-9]{64}"/, `fixtureDigest: "${records[0]!.fixtureDigest}"`);
  writeFileSync(path, source);
  console.log(JSON.stringify({ sourceRevision: revision, measuredAt, pairs: records.length, sourceFiles: SOURCE_FILES.length, checks: records.map(record => record.checks) }));
});
