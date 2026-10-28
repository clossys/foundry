import { renderToStaticMarkup } from "react-dom/server";
import { AppFrame, type AppFrameProps } from "@clossys/designer/frames";
import { describe, expect, it } from "vitest";
import type { CopyField } from "../../content/composition.js";
import { FramedContentPreview, type FramedContentPreviewProps } from "./framed.js";
import { ContentPreviewRefusal } from "./selection.js";

function chromeFixture(): Omit<AppFrameProps, "children"> {
  return {
    brand: { markSrc: "/fixture-mark.svg" },
    navigation: { tree: [{ id: "fixture", label: "Fixture destination", href: "/fixture" }],
      label: "Fixture navigation", openLabel: "Fixture open", closeLabel: "Fixture close", emptyMessage: "Fixture empty" },
    account: { signedOutLabel: "Fixture account", sections: [] },
    commands: { heading: "Fixture commands", triggerLabel: "Fixture command trigger", searchLabel: "Fixture search",
      closeLabel: "Fixture command close", emptyMessage: "Fixture command empty", groups: [] },
    skipLabel: "Fixture skip", themeControl: null, stage: "full", fill: "viewport",
  };
}

const frameCopy: readonly CopyField[] = [
  { key: "title", locale: "en", value: "Fixture document", source: "writer" },
  { key: "title", locale: "fr", value: "Document fixture", source: "writer" },
];

function propsFixture(): FramedContentPreviewProps {
  return { chrome: chromeFixture(), rawUrl: "/fixture/raw?revision=7&locale=fr", locale: "fr", frameCopy };
}

function render(props: FramedContentPreviewProps): string {
  return renderToStaticMarkup(<FramedContentPreview {...props} />);
}

function expectRefusal(props: FramedContentPreviewProps, code: string): void {
  expect(() => render(props)).toThrow(ContentPreviewRefusal);
  try { render(props); } catch (error) { expect(error).toMatchObject({ name: "ContentPreviewRefusal", code }); }
}

describe("FramedContentPreview", () => {
  it("delegates chrome to the actual Designer frame and embeds only the exact raw URL with localized Writer title", () => {
    const props = propsFixture();
    const markup = render(props);
    expect(markup).toBe(renderToStaticMarkup(<AppFrame {...props.chrome}>
      <iframe src={props.rawUrl} title="Document fixture" />
    </AppFrame>));
    expect(markup).toContain("data-application-frame");
    expect(markup).toContain("Fixture command trigger");
    expect(markup).toContain('src="/fixture/raw?revision=7&amp;locale=fr" title="Document fixture"');
    expect(markup.match(/<iframe\b/gu)).toHaveLength(1);
    expect(markup.match(/<main\b/gu)).toHaveLength(1);
    expect(markup).not.toContain("Fixture document");
    expect(markup).not.toContain("srcdoc");
    expect(markup).not.toContain("<article");
  });

  it.each(["relative/raw", "../raw?revision=2", "http://example.test/raw", "https://example.test/raw#fixture"])("preserves allowed URL %s", rawUrl => {
    expect(render({ ...propsFixture(), rawUrl })).toContain(`src="${rawUrl}"`);
  });

  it.each(["", " ", "javascript:alert(1)", "data:text/html,fixture", "file:///fixture", " https://example.test/raw", "https://["])("refuses invalid raw URL %s", rawUrl => {
    expectRefusal({ ...propsFixture(), rawUrl }, "invalid-raw-url");
  });

  it("refuses missing Designer chrome", () => {
    expectRefusal({ ...propsFixture(), chrome: undefined as unknown as FramedContentPreviewProps["chrome"] }, "designer-chrome-required");
  });

  it("refuses omitted host chrome labels instead of invoking Designer defaults", () => {
    const chrome = chromeFixture();
    delete chrome.navigation.openLabel;
    expectRefusal({ ...propsFixture(), chrome }, "writer-copy-required");
  });
  it("requires an explicit host theme control instead of unprojectable built-in labels", () => {
    const chrome = chromeFixture(); delete chrome.themeControl;
    expectRefusal({ ...propsFixture(), chrome }, "writer-copy-required");
  });

  it.each([
    [], [{ key: "title", locale: "en", value: "Fixture", source: "writer" }],
    [{ key: "title", locale: "fr", value: " ", source: "writer" }],
    [{ key: "title", locale: "fr", value: "Fixture", source: "handwritten" }],
    [{ key: "description", locale: "fr", value: "Fixture", source: "writer" }],
    [frameCopy[1], frameCopy[1]],
  ])("refuses missing, malformed, or unprojectable Writer title %#", fields => {
    expectRefusal({ ...propsFixture(), frameCopy: fields as readonly CopyField[] }, "writer-copy-required");
  });

  it("refuses invalid locale without a fallback", () => {
    expectRefusal({ ...propsFixture(), locale: "" }, "writer-copy-required");
  });
});
