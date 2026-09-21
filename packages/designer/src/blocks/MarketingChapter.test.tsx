import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketingChapter } from "./MarketingChapter.js";

describe("MarketingChapter", () => {
  it("renders the title at marketing scale (text-h2)", () => {
    render(<MarketingChapter title="Chapter title" />);
    const heading = screen.getByRole("heading", { name: "Chapter title" });
    expect(heading.tagName).toBe("H2");
    expect(heading).toHaveClass("text-h2");
    expect(heading).not.toHaveClass("text-h3");
  });
});
