/** @vitest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as selectedComponents from "@clossys/designer/components";
import { NoticeList } from "@clossys/designer/blocks";
import { SHELL_COPY_REFS } from "@clossys/designer/frames";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "@clossys/writer";
import { ContentRouteHost, ContentRoutePage, requireContentRoutePublishing } from "./content-route.js";
import { PublisherHost, PublisherHostNeedError } from "./publisher-host.js";
import type { ContentRouteInput } from "./content-route-types.js";
import { marketingComponentSelection } from "../../../designer/dist/studio/marketing-component-selection.js";
import { CONTENT_ROUTE_COMPONENT_MODULE, contentRouteComponentSelectionData } from "./__fixtures__/content-route-components.js";
import { contentRouteFixture, withApprovedRouteCopy } from "./__fixtures__/content-route.js";

const DISMISS = "Dismiss this notice";

/** A served route as a consumer loader returns it: Writer-approved copy, including one shell record, and a live selection. */
function servedRoute(): ContentRouteInput {
  const base = contentRouteFixture();
  const approved = withApprovedRouteCopy({ ...base,
    registry: { ...base.registry, workspace: { ...base.registry.workspace, deployTargets: base.registry.workspace.deployTargets.map(target => ({ ...target, origin: "https://example.test" })) } },
    publishing: { brand: "Example", manifest: { defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {} }, bodyServedLocales: { en: ["en"] }, existingUrls: ["https://example.test/sign-in"] },
  });
  const registry = approved.writer!.registry;
  const shell = { id: SHELL_COPY_REFS.banner.dismiss.id, text: DISMISS, context: "Banner dismiss control", placeholders: [], status: "approved" as const,
    approval: { approvedBy: "owner", approvedAt: approved.raisedAt, textFingerprint: computeCopyFingerprint(DISMISS), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM } };
  return { ...approved, writer: { ...approved.writer!, registry: { ...registry, entries: [...registry.entries, shell] } },
    components: withStockLeaves({ ...contentRouteComponentSelectionData(), modules: { [CONTENT_ROUTE_COMPONENT_MODULE]: selectedComponents } }) };
}

/** NoticeList draws the stock Alert, Button and Icon leaves (NoticeList.tsx componentLeaf calls), so the consumer selection carries those source picks, every leaf they
 * actually read or compose (closed over the picks' own declarations, never listed by hand), and their output files too. */
function withStockLeaves<T extends ReturnType<typeof contentRouteComponentSelectionData> & { modules: Record<string, unknown> }>(selection: T): T {
  const roots = ["components.banner", "components.button", "components.icon"];
  const studio = marketingComponentSelection(), leaves: string[] = [], seen = new Set<string>();
  const visit = (leaf: string) => {
    const pick = studio.profile.components.components[leaf];
    if (!pick || seen.has(leaf)) return;
    seen.add(leaf);
    // A dependency the consumer already selected keeps the consumer's own pick.
    if (!(leaf in selection.profile.components.components) || roots.includes(leaf)) leaves.push(leaf);
    for (const dependency of pick.reads.components) visit(dependency); // composes is a subset of reads.components (K3)
  };
  for (const leaf of roots) visit(leaf);
  const chosen = Object.fromEntries(leaves.map(leaf => [leaf, studio.profile.components.components[leaf]!]));
  const entries = Object.values(chosen).flatMap(pick => pick.impl.kind === "source" ? [pick.impl.entry] : []);
  const outputs = new Set(Object.values(chosen).flatMap(pick => (pick.descriptor.outputSha256 ?? []).map(receipt => receipt.path)));
  const files = [...selection.profile.components.files, ...studio.profile.components.files.filter(file => outputs.has(file.path))];
  return { ...selection, profile: { components: { ...selection.profile.components, files, components: { ...selection.profile.components.components, ...chosen } } },
    descriptors: { ...selection.descriptors, ...Object.fromEntries(leaves.map(leaf => [leaf, studio.descriptors[leaf]!])) },
    modules: { ...selection.modules, ...Object.fromEntries(entries.map(entry => [entry, studio.modules[entry]])) } };
}

describe("Publisher host", () => {
  it("renders a Publisher page with the consumer's selection and Writer shell copy, with no test host", () => {
    const input = requireContentRoutePublishing(servedRoute());
    const html = renderToStaticMarkup(<ContentRouteHost input={input}>
      <ContentRoutePage input={input} />
      <NoticeList label="Notices" notices={[{ id: "notice", title: "Notice", message: "Body" }]} onDismiss={() => undefined} />
    </ContentRouteHost>);
    expect(html).toContain('data-ds-leaf="frames.auth-shell"'); expect(html).toContain('data-ds-leaf="sections.empty-state"');
    expect(html).toContain("Sign in to continue");
    expect(html).toContain(`aria-label="${DISMISS}"`);
  });

  it("uses the host's own selection, so an incomplete consumer selection fails with a NEED", () => {
    const input = servedRoute(), selection = input.components!;
    const { "components.semantic-content": _omitted, ...rest } = selection.profile.components.components;
    const incomplete = { ...input, components: { ...selection, profile: { components: { ...selection.profile.components, components: rest } } } };
    expect(() => renderToStaticMarkup(<ContentRouteHost input={incomplete}><ContentRoutePage input={requireContentRoutePublishing(incomplete)} /></ContentRouteHost>))
      .toThrow("NEED component selection: components.semantic-content");
  });

  it("fails loudly without a consumer selection or Writer copy, never falling back", () => {
    const input = servedRoute();
    const { components: _components, ...unselected } = input;
    expect(() => renderToStaticMarkup(<ContentRouteHost input={unselected}><p>body</p></ContentRouteHost>)).toThrow(PublisherHostNeedError);
    expect(() => renderToStaticMarkup(<ContentRouteHost input={unselected}><p>body</p></ContentRouteHost>)).toThrow(/^NEED component selection: /);
    const { writer: _writer, ...uncopied } = input;
    expect(() => renderToStaticMarkup(<ContentRouteHost input={uncopied}><p>body</p></ContentRouteHost>)).toThrow(/^NEED shell copy: /);
    expect(() => renderToStaticMarkup(<PublisherHost components={input.components!}><p>body</p></PublisherHost>)).toThrow(/^NEED shell copy: /);
  });
});
