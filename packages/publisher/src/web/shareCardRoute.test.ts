import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import { ShareCardError, buildBrandShareCard, type BrandShareCardInput, type ShareCardErrorReason } from "./shareCard.js";
import { createShareCardRoute, type ShareCardRouteInput } from "./shareCardRoute.js";
import * as webIndex from "./index.js";
import * as webServer from "./server.js";

const PNG_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";

type Card = Omit<BrandShareCardInput, "alt">;

function card(overrides: Partial<Card> = {}): Card {
  return {
    markSrc: PNG_MARK,
    wordmark: "Example Studio",
    kicker: "Small tools",
    headline: "Made well, made to last",
    supporting: "A fictional studio for tests.",
    ...overrides,
  };
}

interface Call {
  element: ReactElement;
  init: { width: number; height: number };
}

function recordingImageResponse(): { ImageResponse: ShareCardRouteInput["ImageResponse"]; calls: Call[] } {
  const calls: Call[] = [];
  class FakeImageResponse extends Response {
    constructor(element: ReactElement, init: { width: number; height: number }) {
      super(null);
      calls.push({ element, init });
    }
  }
  return { ImageResponse: FakeImageResponse, calls };
}

function reasonOf(fn: () => unknown): ShareCardErrorReason | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ShareCardError) return error.reason;
    throw error;
  }
  return undefined;
}

describe("route exports", () => {
  it("returns alt, size and contentType that match buildBrandShareCard, and draws the same element", () => {
    const { ImageResponse, calls } = recordingImageResponse();
    const route = createShareCardRoute({ ImageResponse, card: card(), alt: "Example Studio share card" });
    const built = buildBrandShareCard({ ...card(), alt: "Example Studio share card" });

    expect(route.alt).toBe(built.shareCard.alt);
    expect(route.size).toEqual({ width: 1200, height: 630 });
    expect(route.size).toEqual({ width: built.width, height: built.height });
    expect(route.size).toEqual({ width: OG_SHARE_CARD_SPEC.widthPx, height: OG_SHARE_CARD_SPEC.heightPx });
    expect(route.contentType).toBe("image/png");
    expect(route.contentType).toBe(built.contentType);
    expect(route.shareCard).toEqual(built.shareCard);

    expect(calls).toHaveLength(0);
    const response = route.Image();
    expect(response).toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toEqual(route.size);
    expect(renderToStaticMarkup(calls[0]!.element)).toBe(renderToStaticMarkup(built.element));
  });

  it("calls the supplied ImageResponse once per Image() call, with the same size each time", () => {
    const { ImageResponse, calls } = recordingImageResponse();
    const route = createShareCardRoute({ ImageResponse, card: card(), alt: "Example" });
    route.Image();
    route.Image();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init).toEqual({ width: 1200, height: 630 });
    expect(calls[1]!.init).toEqual({ width: 1200, height: 630 });
  });

  it("can be read as named exports of a route file, with no destructuring", () => {
    const { ImageResponse } = recordingImageResponse();
    const route = createShareCardRoute({ ImageResponse, card: card(), alt: "Example" });
    const routeFile = { alt: route.alt, size: route.size, contentType: route.contentType, default: route.Image };
    expect(routeFile.default).toBe(route.Image);
    expect(Object.keys(route).sort()).toEqual(["Image", "alt", "contentType", "shareCard", "size"]);
  });

  it("builds the card when the factory is called, so bad input fails there and not in Image()", () => {
    const { ImageResponse } = recordingImageResponse();
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card({ markSrc: "https://example.com/mark.png" }), alt: "Example" }))).toBe(
      "invalid-mark-source",
    );
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card({ path: "opengraph-image" }), alt: "Example" }))).toBe("invalid-path");
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), alt: " Example" }))).toBe("surrounding-whitespace");
  });
});

describe("title and alt", () => {
  it("draws the title in place of card.headline and hands that title to an alt function", () => {
    const { ImageResponse, calls } = recordingImageResponse();
    const seen: string[] = [];
    const route = createShareCardRoute({
      ImageResponse,
      card: card(),
      title: "A page title",
      alt: (headline) => {
        seen.push(headline);
        return `Share card: ${headline}`;
      },
    });
    expect(seen).toEqual(["A page title"]);
    expect(route.alt).toBe("Share card: A page title");
    expect(route.shareCard.alt).toBe("Share card: A page title");

    route.Image();
    const markup = renderToStaticMarkup(calls[0]!.element);
    expect(markup).toContain("A page title");
    expect(markup).not.toContain("Made well, made to last");
    expect(markup).toBe(renderToStaticMarkup(buildBrandShareCard({ ...card({ headline: "A page title" }), alt: "Share card: A page title" }).element));
  });

  it("draws card.headline and hands it to an alt function when there is no title", () => {
    const { ImageResponse, calls } = recordingImageResponse();
    const seen: string[] = [];
    const route = createShareCardRoute({
      ImageResponse,
      card: card(),
      alt: (headline) => {
        seen.push(headline);
        return `Share card: ${headline}`;
      },
    });
    expect(seen).toEqual(["Made well, made to last"]);
    expect(route.alt).toBe("Share card: Made well, made to last");
    route.Image();
    expect(renderToStaticMarkup(calls[0]!.element)).toContain("Made well, made to last");
  });

  it("returns a string alt as given, with or without a title", () => {
    const { ImageResponse } = recordingImageResponse();
    expect(createShareCardRoute({ ImageResponse, card: card(), alt: "Given as is" }).alt).toBe("Given as is");
    expect(createShareCardRoute({ ImageResponse, card: card(), title: "Another", alt: "Given as is" }).alt).toBe("Given as is");
  });

  it("does not call an alt function when the headline is refused", () => {
    const { ImageResponse } = recordingImageResponse();
    let called = 0;
    const alt = (headline: string): string => {
      called += 1;
      return headline;
    };
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), title: "  ", alt }))).toBe("blank-text");
    expect(called).toBe(0);
  });

  it("refuses an alt function result that is not valid text", () => {
    const { ImageResponse } = recordingImageResponse();
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), alt: () => "" }))).toBe("blank-text");
  });
});

describe("refusals and entries", () => {
  it("refuses a blank title with blank-text", () => {
    const { ImageResponse } = recordingImageResponse();
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), title: "", alt: "Example" }))).toBe("blank-text");
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), title: "   ", alt: "Example" }))).toBe("blank-text");
  });

  it("refuses a non-function ImageResponse with invalid-input", () => {
    for (const bad of [undefined, null, "ImageResponse", {}, 1]) {
      const input = { ImageResponse: bad, card: card(), alt: "Example" } as unknown as ShareCardRouteInput;
      expect(reasonOf(() => createShareCardRoute(input))).toBe("invalid-input");
    }
  });

  it("refuses input that is not shaped as documented with invalid-input", () => {
    const { ImageResponse } = recordingImageResponse();
    expect(reasonOf(() => createShareCardRoute(null as unknown as ShareCardRouteInput))).toBe("invalid-input");
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: null, alt: "Example" } as unknown as ShareCardRouteInput))).toBe("invalid-input");
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), alt: 7 } as unknown as ShareCardRouteInput))).toBe("invalid-input");
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: card(), title: 7, alt: "Example" } as unknown as ShareCardRouteInput))).toBe(
      "invalid-input",
    );
  });

  it("requires a headline on the card when no title is given", () => {
    const { ImageResponse } = recordingImageResponse();
    const { headline: _omitted, ...rest } = card();
    expect(reasonOf(() => createShareCardRoute({ ImageResponse, card: rest as unknown as Card, alt: "Example" }))).toBe("invalid-input");
    expect(createShareCardRoute({ ImageResponse, card: rest as unknown as Card, title: "Only a title", alt: "Example" }).alt).toBe("Example");
  });

  it("is exported from web/index and web/server as the same function", () => {
    expect(webIndex.createShareCardRoute).toBe(createShareCardRoute);
    expect(webServer.createShareCardRoute).toBe(createShareCardRoute);
  });

  it("imports nothing from next", () => {
    const source = readFileSync(new URL("./shareCardRoute.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from|import|require)\s*\(?\s*["']next(?:\/|["'])/);
  });
});
