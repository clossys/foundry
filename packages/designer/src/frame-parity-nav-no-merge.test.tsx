import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("tailwind-merge", () => { throw new Error("Optional peer absent"); });
import { NavDisclosure } from "./shell/NavDisclosure.js";

describe("inverse trigger without the optional class merger", () => {
  it.each(["server", "client"] as const)("has no conflicting base ink, hover or focus class in %s output", mode => {
    const element = <NavDisclosure tone="inverse"><a href="/about">About</a></NavDisclosure>;
    const container = mode === "client" ? render(element).container : document.createElement("div");
    if (mode === "server") container.innerHTML = renderToStaticMarkup(element);
    const trigger = container.querySelector("button")!;
    expect(trigger).toHaveClass("text-ink-on-inverse", "hover:bg-control-tonal-inverse-hover", "focus-visible:outline-ink-on-inverse");
    expect(trigger).not.toHaveClass("text-ink-primary");
    expect(trigger).not.toHaveClass("hover:bg-surface-sunken");
    expect(trigger).not.toHaveClass("focus-visible:outline-accent");
  });
});
