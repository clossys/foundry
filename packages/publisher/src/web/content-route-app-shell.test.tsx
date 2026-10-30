/** @vitest-environment node */
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Icon } from "@clossys/designer/components/server";
import { Box } from "@clossys/designer/icons";
import { AppFrame } from "@clossys/designer/frames";
import { SectionHeader } from "@clossys/designer/blocks/server";
import { JSDOM } from "jsdom";
import type { CopyResolver } from "@clossys/writer";
import { getAdminCopyRecord, resolveAdminCopyRef } from "@clossys/writer/admin-copy";
import type { RuntimeRenderInput } from "@clossys/designer/catalog";
import type { ReactNode } from "react";
import { mainPublisherContent } from "../content/cli/index.js";
import { designerFixture, emptyRegistry, writerContent, at } from "../content/cli/__fixtures__/workflow.js";
import type { PublisherCommand } from "../content/cli/types.js";
import type { ContentCandidate, ContentSlot } from "../content/model.js";
import { writeContentStore } from "../content/store/index.js";
import { loadPublisherContext } from "../content/cli/context.js";
import { computeContentDigest } from "../content/digest.js";
import { computeStageReport } from "../content/stage-engine.js";
import { ContentRoutePage, prepareContentRoute } from "./content-route.js";
import { ADMIN_PAGE_COPY_REFS, adminPageMeta } from "../content/admin-copy.js";
import { bindContentAppFrame } from "./content-route-copy.js";
import { contentRouteContent, contentRouteCandidate, contentRouteFixture, withApprovedRouteCopy } from "./__fixtures__/content-route.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const ref = (id: string) => ({ id: `admin.${id}` });
const pseudo: CopyResolver = input => ({ ref: input, text: `[[${input.id}]]`, recordId: "synthetic", revision: "1", locale: input.locale ?? "en",
  servedLocale: input.locale ?? "en", chain: [input.locale ?? "en"], entryId: input.id, source: { kind: "consumer", reference: "fixture" } });
const shell = () => ({
  brand: { markSrc: "/mark.svg", navigationMark: { label: ref("brand") } },
  skipLabel: ref("skip"), breadcrumbLabel: ref("breadcrumb"), collapsedBreadcrumbLabel: ref("collapsed"), pageInfoLabel: ref("info"), pageActionsLabel: ref("actions"),
  navigation: { label: ref("navigation"), openLabel: ref("open"), closeLabel: ref("close"), emptyMessage: ref("empty"), tree: [
    { id: "publisher", href: "/agents/publisher", label: ref("publisher"), icon: createElement(Icon, { glyph: Box, decorative: true }) },
  ] },
  account: { signedOutLabel: ref("account"), triggerLabel: ref("account-trigger"), sections: [] },
  commands: { triggerLabel: ref("command"), heading: ref("command-heading"), searchLabel: ref("search"), closeLabel: ref("command-close"), emptyMessage: ref("command-empty"), groups: [], shortcutEnabled: false },
  themeControl: null, fill: "viewport",
});
function noUnwrappedText(html: string): number {
  const document = new JSDOM(html).window.document;
  const walk = document.createTreeWalker(document.body, 4);
  const bad: string[] = [];
  let node;
  while ((node = walk.nextNode())) {
    if (node.parentElement?.closest("style,script")) continue;
    const text = node.textContent?.trim();
    if (text && !/^(?:\[\[[^\]]+\]\]\s*)+$/.test(text)) bad.push(text);
  }
  expect(bad).toEqual([]);
  return [...document.querySelectorAll("*")].filter(element => element.textContent?.match(/^\[\[/)).length;
}

describe("active admin candidate AppFrame adapter", () => {
  it("references WR-META's permanent admin records without changing draft approval", async () => {
    const packet = JSON.parse(await readFile(new URL("../../../writer/src/catalog/records/admin-meta.r1.en.json", import.meta.url), "utf8"));
    expect(packet.activation).toBe("none");
    for (const page of ["designer", "writer", "publisher"] as const) for (const [key, reference] of Object.entries(ADMIN_PAGE_COPY_REFS[page])) {
      const bindings = packet.bindings.filter((binding: { cellId: string }) => binding.cellId === `admin.${page}.${key}`);
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toMatchObject({ recordId: reference.id, target: `/agents/${page}`, kind: key === "navLabel" ? "navigation" : "metadata" });
      // WR-META retains semantic bindings after shared copy moves to its canonical owner.
      const record = getAdminCopyRecord(reference.id);
      expect(record).toMatchObject({ id: reference.id, status: "draft" });
      expect(record).not.toHaveProperty("approval");
      expect(resolveAdminCopyRef({ ...reference, locale: "en" })).toBeUndefined();
      expect(resolveAdminCopyRef({ ...reference, locale: "en" }, undefined, { target: "production" })).toBeUndefined();
      expect(resolveAdminCopyRef({ ...reference, locale: "en" }, undefined, { target: "preview" })).toMatchObject({
        text: record!.text, servedLocale: "en", status: "draft", activation: "none",
      });
    }
  });
  it("runs all three slots through the real CLI and review, separate approval and activation, then binds all rendered copy", async () => {
    const parent = await mkdtemp(join(await realpath(tmpdir()), "publisher-admin-")); roots.push(parent);
    const root = join(parent, "publisher"), designer = join(parent, "designer");
    const { catalog, version } = await designerFixture(designer, "frames.app-shell");
    const catalogFile = join(parent, "catalog.json"), writerFile = join(parent, "writer.json");
    await writeFile(catalogFile, JSON.stringify(catalog));
    await writeContentStore(root, emptyRegistry());
    const ids = [...new Set((["designer", "writer", "publisher"] as const).flatMap(name => [ref(`${name}.heading`).id, ...adminPageMeta(name, "en").map(field => field.ref!.id)]))];
    await writeFile(writerFile, JSON.stringify({ registry: { id: "synthetic", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" },
      entries: ids.map(id => ({ id, text: `[[${id}]]`, context: "Synthetic CLI fixture", status: "approved" })) } }));
    let n = 0;
    const command = async (name: PublisherCommand, input: unknown, withWriter = true) => {
      const file = join(parent, `command-${++n}.json`); await writeFile(file, JSON.stringify(input));
      return mainPublisherContent([name, "--root", root, "--designer", designer, "--catalog", catalogFile, "--input", file, "--at", at, ...(withWriter ? ["--writer", writerFile] : [])]);
    };
    for (const name of ["designer", "writer", "publisher"] as const) {
      const created = await command("slot-create", { slot: { aliases: [], l1: "websites", l2: "admin", locales: ["en"],
        position: { order: n, name }, name, kind: "content", route: `/agents/${name}`, deployTarget: "public", devOnly: false, tags: [] } });
      expect(created.findings).toEqual([]);
      const slot = (created.data as { slot: ContentSlot }).slot;
      const content = writerContent(version);
      content.composition = { ...content.composition!, frame: { frameId: "frames.app-shell", configId: "default" }, sections: [{ ...content.composition!.sections[0]!,
        fields: [{ key: "heading", locale: "en", source: "writer", ref: ref(`${name}.heading`) }] }] };
      content.pageMeta = adminPageMeta(name, "en");
      if (name === "designer") content.brief.goal = "";
      const added = await command("candidate-add", { slotId: slot.id, content });
      expect(added.findings).toEqual([]);
      let candidate = (added.data as { candidate: ContentCandidate }).candidate;
      if (name === "designer") {
        const incomplete = await command("review", { candidateId: candidate.id });
        expect((incomplete.data as { stages: ReturnType<typeof computeStageReport> }).stages.stages.define.status).toBe("Needs input");
        expect(incomplete.findings.some(finding => finding.rule === "brief-required")).toBe(true);
        content.brief.goal = "Synthetic complete brief";
        const revised = await command("candidate-revise", { candidateId: candidate.id, content });
        candidate = (revised.data as { candidate: ContentCandidate }).candidate;
      }
      if (name === "writer") {
        const missingWriter = await command("review", { candidateId: candidate.id }, false);
        expect(missingWriter.exitCode).toBe(1);
        expect(missingWriter.findings.some(finding => finding.rule === "copy-resolver-required")).toBe(true);
      }
      const reviewed = await command("review", { candidateId: candidate.id });
      expect(reviewed.findings).toEqual([]); expect(reviewed.exitCode).toBe(0);
      const stages = (reviewed.data as { stages: ReturnType<typeof computeStageReport> }).stages;
      expect([stages.stages.define.status, stages.stages.assemble.status, stages.stages.review.status]).toEqual(["Done", "Done", "Done"]);
      expect(stages.stages.approve.status).toBe("Waiting");
      expect((reviewed.data as { candidate: ContentCandidate }).candidate.approval).toBeUndefined();
      expect((await command("approve", { candidateId: candidate.id, by: "synthetic-owner", revision: candidate.revision, digest: computeContentDigest(candidate) })).exitCode).toBe(0);
      const activated = await command("activate", { candidateId: candidate.id }); expect(activated.findings).toEqual([]);
      expect((activated.data as { stages: ReturnType<typeof computeStageReport> }).stages.overall).toBe("Waiting"); // release remains separate
      const context = await loadPublisherContext(root, designer, catalog);
      const input = { ...context, slotId: slot.id, locale: "en", raisedAt: at, appFrame: shell(), resolveCopy: pseudo };
      expect(prepareContentRoute({ ...input, appFrame: undefined }).needs.some(need => need.target === "designer")).toBe(true);
      const prepared = prepareContentRoute(input); expect(prepared.needs).toEqual([]); expect(prepared.candidate.state).toBe("active");
      const html = renderToStaticMarkup(<ContentRoutePage input={input} />);
      expect(html).toContain(`[[${ADMIN_PAGE_COPY_REFS[name].title.id}]]`);
      expect(html).toContain('data-application-frame=""'); expect(html).toContain(`[[admin.${name}.heading]]`);
      expect(noUnwrappedText(html)).toBeGreaterThan(0);
      const runtime = { fill: { kind: "section", library: "sample", fill: "sample/sections.section-header", leaf: "sections.section-header", config: "default", slots: ["heading", "description", "eyebrow", "actions"], members: [] },
        selection: { fill: "sample/sections.section-header", leaf: "sections.section-header", config: "default", members: [] }, content: {}, slots: {}, cell: { theme: "light", state: "default", width: 1200 } } as unknown as RuntimeRenderInput<ReactNode>;
      const bound = { ...input, sectionBindings: { intro: { libraryVersion: version, input: runtime } } };
      expect(prepareContentRoute(bound).needs).toEqual([]);
      expect(prepareContentRoute({ ...bound, sectionBindings: { intro: { libraryVersion: "stale", input: runtime } } }).needs
        .some(need => need.detail.includes("registered-section-binding-required"))).toBe(true);
      expect(noUnwrappedText(renderToStaticMarkup(<ContentRoutePage input={bound} />))).toBeGreaterThan(0);
    }
  });

  it("refuses literal chrome copy and local layout while preserving host callback identity", () => {
    const navigate = () => {};
    expect(bindContentAppFrame({ ...shell(), onNavigate: navigate }, "en", pseudo).onNavigate).toBe(navigate);
    expect(() => bindContentAppFrame({ ...shell(), skipLabel: "Literal" }, "en", pseudo)).toThrow("copy-ref-required");
    expect(() => bindContentAppFrame({ ...shell(), className: "local" }, "en", pseudo)).toThrow("designer-owned-layout");
    expect(() => bindContentAppFrame(shell(), "en")).toThrow("copy-resolver-required");
    const props = bindContentAppFrame({ ...shell(), onNavigate: navigate }, "en", pseudo);
    expect(noUnwrappedText(renderToStaticMarkup(createElement(AppFrame, { ...props,
      children: createElement(SectionHeader, { title: pseudo({ ...ref("body"), locale: "en" })!.text }) })))).toBeGreaterThan(0);
  });

  it("keeps stage evidence bound to page-copy snapshots and renders that same candidate through the pseudo port", () => {
    const input = contentRouteFixture();
    const content = contentRouteContent();
    content.composition = { ...content.composition!, frame: { frameId: "frames.app-shell", configId: "default" }, sections: [{ ...content.composition!.sections[0]!,
      fields: [{ key: "title", source: "writer", locale: "en", ref: ref("body") }] }] };
    content.pageMeta = ["title", "description"].map(key => ({ key, source: "writer", locale: "en", ref: ref(key) }));
    const candidate = contentRouteCandidate(content);
    expect(computeStageReport(candidate).stages.define.status).toBe("Done");
    const drift = { ...candidate, pageMeta: [{ ...candidate.pageMeta![0]!, ref: ref("different") }] };
    expect(computeStageReport(drift).stages.define.findings.some(finding => finding.rule === "snapshot-content")).toBe(true);
    const ready = { ...input, frameCopy: withApprovedRouteCopy(input).frameCopy, registry: { ...input.registry, candidates: [candidate], slots: input.registry.slots.map(slot => ({ ...slot, l2: "admin" as const })) }, appFrame: shell(), resolveCopy: pseudo,
      libraries: input.libraries.map(library => ({ ...library, frames: [{ id: "frames.app-shell", configIds: ["default"] }] })) };
    expect(noUnwrappedText(renderToStaticMarkup(<ContentRoutePage input={ready} />))).toBeGreaterThan(0);
  });
});
