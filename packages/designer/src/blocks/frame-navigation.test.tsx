import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { frameLinkNavigation, type FrameNavigate } from "./frame-navigation.js";
afterEach(cleanup);
type Activation = { before: boolean; after: boolean };
function Fixture({ onNavigate, observe }: { onNavigate?: FrameNavigate; observe?: (activation: Activation) => void }) {
  return <div onClick={event => {
    const before = event.defaultPrevented;
    frameLinkNavigation(event, onNavigate);
    observe?.({ before, after: event.defaultPrevented });
    // Test harness only: cancel native jsdom navigation after recording the real helper's decision.
    event.preventDefault();
  }}><a href="#next">Next</a><a href="#download" download>Download</a><a href="#other" target="_blank">Other</a><a href="#prevented" onClick={event => event.preventDefault()}>Prevented</a></div>;
}
it("lets the host await a flush and keeps a real href", async () => {
  const navigate = vi.fn(); const observe = vi.fn(); render(<Fixture onNavigate={navigate} observe={observe} />);
  expect(screen.getByText("Next").getAttribute("href")).toBe("#next");
  expect(fireEvent.click(screen.getByText("Next"), { button: 0 })).toBe(false);
  expect(observe).toHaveBeenCalledExactlyOnceWith({ before: false, after: true });
  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#next"));
});
it("preserves modified, non-primary, downloaded, non-self and prevented activations", async () => {
  const navigate = vi.fn(); const observe = vi.fn(); render(<Fixture onNavigate={navigate} observe={observe} />);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    observe.mockClear(); fireEvent.click(screen.getByText("Next"), options);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ before: false, after: false });
  }
  for (const text of ["Download", "Other"]) {
    observe.mockClear(); fireEvent.click(screen.getByText(text));
    expect(observe).toHaveBeenCalledExactlyOnceWith({ before: false, after: false });
  }
  observe.mockClear(); fireEvent.click(screen.getByText("Prevented"));
  expect(observe).toHaveBeenCalledExactlyOnceWith({ before: true, after: true });
  await Promise.resolve(); expect(navigate).not.toHaveBeenCalled();
});
it("contains host rejection and retains current location", async () => {
  const before = location.href; const navigate = vi.fn().mockRejectedValue(new Error("flush failed")); render(<Fixture onNavigate={navigate} />);
  fireEvent.click(screen.getByText("Next")); await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  expect(location.href).toBe(before);
});
