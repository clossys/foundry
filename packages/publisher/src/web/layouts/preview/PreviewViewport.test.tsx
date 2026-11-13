// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PreviewViewport } from "./PreviewViewport.js";

afterEach(cleanup);

it("tears down a loaded portal before replacing its iframe for a new theme", () => {
  const style = document.createElement("style");
  style.textContent = ":root { --preview-test-binding: currentColor; }";
  document.head.append(style);
  try {
    const { rerender, unmount } = render(<PreviewViewport width={320} theme="light" mode="instance" title="Preview"><p>Light placeholder · LK12 pending</p></PreviewViewport>);
    const light = screen.getByTitle("Preview") as HTMLIFrameElement;
    fireEvent.load(light);
    const lightDocument = light.contentDocument!;
    expect(lightDocument.body).toHaveTextContent("Light placeholder · LK12 pending");
    expect(lightDocument.head.querySelector("[data-preview-viewport-style]")?.textContent).toBe(style.textContent);

    rerender(<PreviewViewport width={768} theme="light" mode="instance" title="Preview"><p>Wider placeholder · LK12 pending</p></PreviewViewport>);
    expect(screen.getByTitle("Preview")).toBe(light);
    expect(light).toHaveStyle({ width: "768px" });
    expect(lightDocument.body).toHaveTextContent("Wider placeholder · LK12 pending");

    rerender(<PreviewViewport width={768} theme="dark" mode="instance" title="Preview"><p>Dark placeholder · LK12 pending</p></PreviewViewport>);
    const dark = screen.getByTitle("Preview") as HTMLIFrameElement;
    expect(dark).not.toBe(light);
    expect(light.isConnected).toBe(false);
    fireEvent.load(dark);
    const darkDocument = dark.contentDocument!;
    expect(darkDocument.documentElement.dataset.theme).toBe("dark");
    expect(darkDocument.body).toHaveTextContent("Dark placeholder · LK12 pending");
    expect(darkDocument.body).not.toHaveTextContent("Wider placeholder");
    expect(darkDocument.head.querySelector("[data-preview-viewport-style]")?.textContent).toBe(style.textContent);
    expect(darkDocument.body.querySelector("[data-section]")).toBeNull();
    unmount();
    expect(dark.isConnected).toBe(false);
  } finally {
    style.remove();
  }
});
