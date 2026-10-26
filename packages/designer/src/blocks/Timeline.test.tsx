import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Timeline } from "./Timeline.js";
import { timelineSample } from "./timeline/sample.js";

describe("Timeline", () => {
  it("TL1: renders events as one ordered list with machine-readable dates and headings", () => {
    render(<Timeline {...timelineSample} />);
    const list = screen.getByRole("list", { name: "Company history" });
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector("time")).toHaveAttribute("datetime", "2019-04");
    expect(within(rows[0]!).getByText("April 2019")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Founded", "First public release", "Platform launch"]);
    expect(within(rows[2]!).getByText(/Design, publishing/)).toBeVisible();
  });

  it("TL2: honours the heading level and refuses an empty event list", () => {
    render(<Timeline {...timelineSample} headingLevel={4} />);
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(3);
    expect(() => renderToString(<Timeline {...timelineSample} events={[]} />)).toThrow(/Timeline: events must not be empty/);
  });

  it("TL3: draws the rail on every event except the last, so the line ends at the final marker", () => {
    render(<Timeline {...timelineSample} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map(row => row.hasAttribute("data-timeline-rail"))).toEqual([true, true, false]);
  });
});
