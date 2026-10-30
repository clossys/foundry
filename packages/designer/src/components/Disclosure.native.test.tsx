import { useState, type ComponentProps } from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeadingContext } from "react-aria-components";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./preview-runtime/components/disclosure/accordion.js";
import { GlyphProvider } from "./glyph-context.js";
import { glyphs } from "./preview-runtime/adapters/glyphs.js";

const content = <><AccordionItem id="one"><AccordionTrigger>First topic</AccordionTrigger><AccordionContent>First answer</AccordionContent></AccordionItem>
  <AccordionItem id="two"><AccordionTrigger>Second topic</AccordionTrigger><AccordionContent>Second answer</AccordionContent></AccordionItem></>;

it("keeps controlled group expansion, keyboard activation and panel naming on the native peer", async () => {
  const user = userEvent.setup();
  function Controlled() {
    const [expanded, setExpanded] = useState<NonNullable<ComponentProps<typeof Accordion>["expandedKeys"]>>(new Set(["one"]));
    return <Accordion expandedKeys={expanded} onExpandedChange={setExpanded}>{content}</Accordion>;
  }
  render(<GlyphProvider glyphs={glyphs}><Controlled /></GlyphProvider>);
  const first = screen.getByRole("button", { name: "First topic" }), second = screen.getByRole("button", { name: "Second topic" });
  expect(first).toHaveAttribute("aria-expanded", "true");
  await user.click(second);
  expect(first).toHaveAttribute("aria-expanded", "false");
  expect(second).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById(second.getAttribute("aria-controls")!)).toHaveAttribute("aria-labelledby", second.id);
  await user.keyboard(" ");
  expect(second).toHaveAttribute("aria-expanded", "false");
});

it("retains multiple expansion and a disabled item's inert trigger", async () => {
  const user = userEvent.setup();
  render(<GlyphProvider glyphs={glyphs}><Accordion allowsMultipleExpanded defaultExpandedKeys={["one"]}>{content}
    <AccordionItem id="locked" isDisabled><AccordionTrigger>Locked topic</AccordionTrigger><AccordionContent>Locked answer</AccordionContent></AccordionItem>
  </Accordion></GlyphProvider>);
  await user.click(screen.getByRole("button", { name: "Second topic" }));
  expect(screen.getByRole("button", { name: "First topic" })).toHaveAttribute("aria-expanded", "true");
  const locked = screen.getByRole("button", { name: "Locked topic" });
  await user.click(locked);
  expect(locked).toBeDisabled();
  expect(locked).toHaveAttribute("aria-expanded", "false");
});

it("accepts the caller's real RAC heading context and binds decorative registered chevrons", () => {
  const { container } = render(<GlyphProvider glyphs={glyphs}><HeadingContext.Provider value={{ level: 4 }}>
    <AccordionItem><AccordionTrigger>Nested topic</AccordionTrigger><AccordionContent>Nested answer</AccordionContent></AccordionItem>
  </HeadingContext.Provider></GlyphProvider>);
  expect(screen.getByRole("heading", { level: 4, name: "Nested topic" })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-slot="accordion-trigger-icon"]')).toHaveLength(2);
  expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
});
