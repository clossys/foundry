import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { renderWebDocument } from "./renderWebDocument.js";

const baseErrorDoc: ComposeDocument = {
  id: "doc-1",
  channel: "web",
  template: "ErrorView",
  meta: { channel: "web", title: "Not found", description: "Not found." },
  bindings: [
    { slot: "status", value: "404" },
    { slot: "title", value: "Page not found" },
  ],
};

describe("renderWebDocument — refuses a document that resolves nothing", () => {
  it("throws RenderError('resolution-failed') for a document with no bindings at all", () => {
    const doc: ComposeDocument = { ...baseErrorDoc, bindings: [] };
    expect(() => renderWebDocument(doc)).toThrow(RenderError);
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
    }
  });

  it("throws RenderError('resolution-failed') when every binding targets an unknown slot", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [{ slot: "does-not-exist", value: "x" }],
    };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("does-not-exist");
    }
  });

  it("throws RenderError('resolution-failed') when a required slot has no binding", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [{ slot: "status", value: "404" }], // "title" is required and unbound
    };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as Error).message).toContain("title");
    }
  });

  it("throws RenderError('empty-output') when a required slot's copyId cannot be resolved — resolveDocument said ok, but the text is still empty", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", copyId: "missing.copy.id" }, // required, and no resolver is given
      ],
    };
    try {
      renderWebDocument(doc); // no options.resolveCopyId at all
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("empty-output");
      expect((error as Error).message).toContain("title");
    }
  });

  it("throws RenderError('empty-output') when the resolver itself returns undefined for a required slot's copyId", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", copyId: "unresolvable" },
      ],
    };
    expect(() => renderWebDocument(doc, { resolveCopyId: () => undefined })).toThrow(RenderError);
  });
});

describe("renderWebDocument — other refusals", () => {
  it("throws RenderError('unknown-template') for a template this package does not know", () => {
    const doc: ComposeDocument = { ...baseErrorDoc, template: "DashboardView" };
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("unknown-template");
      expect((error as Error).message).toContain("DashboardView");
      expect((error as Error).message).toContain("AuthView");
      expect((error as Error).message).toContain("ErrorView");
    }
  });

  it("throws RenderError('wrong-channel') for a non-web document", () => {
    const doc = {
      id: "doc-email",
      channel: "email",
      template: "ErrorView",
      meta: { channel: "email", subject: "hi", preheader: "hi" },
      bindings: [],
    } as unknown as ComposeDocument;
    try {
      renderWebDocument(doc);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).reason).toBe("wrong-channel");
    }
  });
});

describe("renderWebDocument — success paths", () => {
  it("resolves a literal value binding with no resolver needed", () => {
    const { element, head } = renderWebDocument(baseErrorDoc);
    expect(element).toBeDefined();
    expect(head.title).toBe("Not found");
  });

  it("resolves a copyId binding through the caller's resolveCopyId", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", copyId: "status.404" },
        { slot: "title", value: "Page not found" },
      ],
    };
    const { element } = renderWebDocument(doc, {
      resolveCopyId: (id) => (id === "status.404" ? "404" : undefined),
    });
    expect(element).toBeDefined();
  });

  it("last binding wins when two bindings target the same slot key, matching resolveDocument's own documented behavior", () => {
    const doc: ComposeDocument = {
      ...baseErrorDoc,
      bindings: [
        { slot: "status", value: "404" },
        { slot: "title", value: "First" },
        { slot: "title", value: "Second" },
      ],
    };
    // Both resolve (resolveDocument does not pick a winner at its own
    // layer — see its doc comment); this package's content-building loop
    // applies bindings in array order, so the LAST one determines the
    // slot's final text. Documented here as this renderer's own policy
    // choice on top of resolveDocument's neutral "you decide" stance.
    const { element } = renderWebDocument(doc);
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Second");
    expect(html).not.toContain("First");
  });
});
