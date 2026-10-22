import { existsSync } from "node:fs";
import * as DesignerServer from "@clossys/designer/blocks/server";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";
import { sectionedViewBlocks as serverBlocks } from "./SectionedViewBlocks.server.js";

it("uses Designer's server Testimonial and removes the Publisher markup twin", () => {
  const props = { quote: "Quote", attributorName: "Alex Example", attributorRole: "Designer" };
  expect(serverBlocks.Testimonial).toBe(DesignerServer.Testimonial);
  expect(renderToStaticMarkup(serverBlocks.Testimonial(props))).toBe(renderToStaticMarkup(sectionedViewBlocks.Testimonial(props)));
  expect(existsSync(new URL("./ServerTestimonial.tsx", import.meta.url))).toBe(false);
});
