import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleBody } from "./ArticleBody.js";
import { SearchField } from "../atoms/SearchField.js";
import { Chip } from "../atoms/Chip.js";
import { Toolbar } from "./Toolbar.js";
import { ContentSection } from "./ContentSection.js";
import { Comparison } from "./Comparison.js";
import { TopicList } from "./TopicList.js";
import { FeatureGrid } from "./FeatureGrid.js";
import { Specimen } from "./specimen/Specimen.js";

const PHYSICAL = /(^|\s)([a-z-]+:)*(ml|mr|pl|pr|left|right|border-l|border-r|text-left|text-right|rounded-[tb]?[lr])(-|\s|$)/;

describe("blocks and atoms RTL logical-direction utilities (#951)", () => {
  it("places SearchField's clear control at inline-end under dir=rtl", () => {
    render(
      <div dir="rtl">
        <SearchField label="Search" value="query" onChange={() => {}} />
      </div>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("end-sm");
    expect(button.className).not.toContain("right-sm");
  });

  it("uses logical padding on Chip remove affordance", () => {
    render(
      <div dir="rtl">
        <Chip onRemove={() => {}} removeLabel="Remove">Tag</Chip>
      </div>,
    );
    const chip = screen.getByText("Tag").closest("span.inline-flex") as HTMLElement;
    expect(chip.className).toContain("ps-sm");
    expect(chip.className).toContain("pe-xs");
    expect(chip.className).not.toMatch(/\bpl-/);
    expect(chip.className).not.toMatch(/\bpr-/);
  });

  it("pushes Toolbar trailing actions to inline-end with ms-auto", () => {
    render(
      <div dir="rtl">
        <Toolbar trailing={<span data-testid="trail">Trail</span>} />
      </div>,
    );
    const trail = screen.getByTestId("trail").closest("div.ms-auto") as HTMLElement;
    expect(trail.className).toContain("ms-auto");
    expect(trail.className).not.toContain("ml-auto");
  });

  it("styles ArticleBody lists with padding-inline-start, not padding-left", () => {
    const { container } = render(
      <div dir="rtl">
        <ArticleBody>
          <ul>
            <li>Item</li>
          </ul>
        </ArticleBody>
      </div>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("[&_ul]:ps-lg");
    expect(article.className).not.toContain("[&_ul]:pl-lg");
  });

  it("moves a split's visual to the start with grid columns only, keeping DOM order", () => {
    const { container } = render(
      <div dir="rtl">
        <ContentSection layout="split" mediaSide="start" heading="Heading" media={<div>Visual</div>}>
          <p>Module</p>
        </ContentSection>
      </div>,
    );
    const root = container.querySelector("[data-content-section]") as HTMLElement;
    expect(root.firstElementChild).toHaveAttribute("data-content-section-text");
    expect(root.lastElementChild).toHaveClass("tablet-lg:col-start-1");
    for (const el of root.querySelectorAll<HTMLElement>("[class]")) expect(el.className).not.toMatch(PHYSICAL);
  });

  it("flips the Comparison arrow under dir=rtl and uses no physical utilities", () => {
    const { container } = render(
      <div dir="rtl">
        <Comparison before={{ label: "Before", points: ["One", "Two"] }} after={{ label: "After", points: ["One", "Two"] }} />
      </div>,
    );
    const arrow = container.querySelector("[data-comparison-arrow] svg") as SVGElement;
    expect(arrow.classList.contains("rtl:-scale-x-100")).toBe(true);
    for (const el of container.querySelectorAll<HTMLElement>("[data-comparison] [class]")) {
      const classes = el.getAttribute("class") ?? "";
      expect(classes).not.toMatch(PHYSICAL);
    }
  });

  it("rules TopicList and rule-treatment FeatureGrid items on the block axis only", () => {
    const { container } = render(
      <div dir="rtl">
        <TopicList items={[{ id: "a", heading: "A" }, { id: "b", heading: "B" }]} />
        <FeatureGrid treatment="rule" items={[{ id: "a", heading: "A" }, { id: "b", heading: "B" }]} />
      </div>,
    );
    for (const el of container.querySelectorAll<HTMLElement>("li, [data-feature-grid-item]")) {
      expect(el).toHaveClass("border-t");
      expect(el.className).not.toMatch(PHYSICAL);
    }
  });

  it("draws Specimen rails, connectors and table cells with logical utilities only", () => {
    const { container } = render(
      <div dir="rtl">
        <Specimen
          label="Two linked records with a schedule, a small table and a file list, shown right to left."
          arrangement="flow"
          connector="Then"
          panels={[
            {
              id: "a",
              title: "First",
              parts: [
                { id: "s", type: "schedule", items: [{ id: "1", date: "1 Jan", label: "Start", amount: "10" }] },
                { id: "f", type: "files", items: [{ id: "1", format: "PDF", name: "Note", source: "Drive" }] },
              ],
            },
            {
              id: "b",
              title: "Second",
              parts: [
                {
                  id: "t",
                  type: "table",
                  caption: "Counts by site",
                  columns: [{ id: "site", label: "Site" }, { id: "n", label: "Count" }],
                  rows: [{ id: "r", cells: [{ text: "North" }, { text: "4" }] }],
                },
              ],
            },
          ]}
        />
      </div>,
    );
    expect(container.querySelector("ol")).toHaveClass("border-s", "ps-lg");
    expect(container.querySelector("[data-specimen-connector] span")).toHaveClass("border-s");
    expect(container.querySelector("td span:last-child")).toHaveClass("text-end", "@md:text-start");
    for (const el of container.querySelectorAll<HTMLElement>("[class]")) expect(el.className).not.toMatch(PHYSICAL);
  });
});
