/** @vitest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as selectedComponents from "@clossys/designer/components";
import { Banner } from "@clossys/designer/components";
import { SHELL_COPY_REFS } from "@clossys/designer/frames";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "@clossys/writer";
import { ContentRouteHost, ContentRoutePage, requireContentRoutePublishing } from "./content-route.js";
import { PublisherHost, PublisherHostNeedError } from "./publisher-host.js";
import type { ContentRouteInput } from "./content-route-types.js";
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
    components: { ...contentRouteComponentSelectionData(), modules: { [CONTENT_ROUTE_COMPONENT_MODULE]: selectedComponents } } };
}

describe("Publisher host", () => {
  it("renders a Publisher page with the consumer's selection and Writer shell copy, with no test host", () => {
    const input = requireContentRoutePublishing(servedRoute());
    const html = renderToStaticMarkup(<ContentRouteHost input={input}>
      <ContentRoutePage input={input} />
      <Banner title="Notice" onDismiss={() => undefined}>Body</Banner>
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
