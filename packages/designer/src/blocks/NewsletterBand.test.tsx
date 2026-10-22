import { Component, type ErrorInfo, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsletterBand, type NewsletterBandProps, type NewsletterStatus } from "./NewsletterBand.js";

const copy = {
  emailLabel: "E1", submitLabel: "E2", pendingLabel: "E3", sentMessage: "E4",
  failedMessage: "E5", privacyNote: "E6", hint: "E7",
};
const statuses: NewsletterStatus[] = ["idle", "pending", "sent", "failed"];
const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  consoleSpies = consoleMethods.map(method => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  cleanup();
  try {
    for (const spy of consoleSpies) expect(spy.mock.calls).toEqual([]);
  } finally {
    vi.restoreAllMocks();
  }
});

function view(props: Partial<NewsletterBandProps> = {}) {
  return <NewsletterBand {...copy} action="/subscribe" {...props} />;
}
function field() { return screen.getByRole("textbox", { name: copy.emailLabel }) as HTMLInputElement; }
function form() { return field().form!; }
function dispatchSubmit(target: HTMLFormElement) {
  // Dispatching a submit event avoids jsdom's unimplemented native navigation.
  // Capture records the same event object; inspect it after React's handler.
  let captured: Event | undefined;
  target.addEventListener("submit", event => { captured = event; }, { capture: true, once: true });
  const event = new Event("submit", { bubbles: true, cancelable: true });
  fireEvent(target, event);
  expect(captured).toBe(event);
  return captured!;
}

class ContractBoundary extends Component<{ children: ReactNode; errors: unknown[] }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.errors.push(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function expectContractError(props: Partial<NewsletterBandProps>) {
  const errors: unknown[] = [];
  // Handle React's expected boundary report through the supported root hook;
  // the global console guard remains active, including during validation.
  const result = render(<ContractBoundary errors={errors}>{view(props)}</ContractBoundary>, {
    onCaughtError: () => {},
  });
  expect(errors.length).toBeGreaterThan(0);
  for (const error of errors) {
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^NewsletterBand: /);
  }
  expect(result.container).toBeEmptyDOMElement();
  result.unmount();
}

// Hand-written accepted set and complete appendix corpus; expected acceptance
// is data, never computed with the implementation's regular expression.
const acceptedActions = ["/subscribe", "/newsletter/sign-up?src=band", "/a/b#c", "/"] as const;
const rejectedActions: unknown[] = [
  "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example", "\\/evil.example", "/ok\\path",
  "https://evil.example/", "http:/evil.example", "HTTPS://EVIL.EXAMPLE", "javascript:alert(1)",
  "JavaScript:alert(1)", "data:text/html,x", "mailto:a@b.example", "ok", "./ok", "../ok", "?x=1", "#x", "",
  " /ok", "/ok ", "/ok path", "/ok\npath", "/ok\tpath", "/ok\u2028", "/\u0000", "/\u007f",
  "∕∕evil.example", "／／evil.example", "/ok\u00a0path", 123, true, null, ["/ok"], {},
];
const actionCases = [
  ...acceptedActions.map(action => ({ action, accepted: true })),
  ...rejectedActions.map(action => ({ action, accepted: false })),
];

describe("NewsletterBand 1: host-supplied copy", () => {
  it.each(statuses)("renders only supplied text in %s", status => {
    const { container } = render(view({ status }));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const text: string[] = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.textContent?.trim();
      if (value) text.push(value);
    }
    expect(text.every(value => Object.values(copy).includes(value))).toBe(true);
    const expected = status === "sent" ? ["E4"] : status === "pending" ? ["E1", "E3", "E3", "E7", "E6"]
      : status === "failed" ? ["E1", "E2", "E7", "E5", "E6"] : ["E1", "E2", "E7", "E6"];
    expect(text).toEqual(expected);
  });
});
describe("NewsletterBand 2: sent", () => {
  it("removes controls, hint and privacy; focuses the sent message in the retained status region", () => {
    const { rerender } = render(view());
    expect(document.body).toHaveFocus();
    const region = screen.getByRole("status");
    rerender(view({ status: "sent", sentMessage: <strong>E4</strong> }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("E7")).toBeNull();
    expect(screen.queryByText("E6")).toBeNull();
    expect(screen.getByRole("status")).toBe(region);
    const message = screen.getByText("E4").closest('[tabindex="-1"]');
    expect(region).toContainElement(message as HTMLElement);
    expect(message).toHaveFocus();
  });
});
describe("NewsletterBand 3: failed", () => {
  it("marks, describes and focuses the input with a decorative error icon", () => {
    const { rerender } = render(view());
    rerender(view({ status: "failed" }));
    const input = field();
    const failed = screen.getByText("E5");
    const hint = screen.getByText("E7");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(/\s+/)).toEqual(expect.arrayContaining([failed.id, hint.id]));
    expect(input).toHaveFocus();
    expect(input).toHaveClass("border-status-danger");
    expect(failed.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(failed).toHaveClass("text-status-danger-text");
    expect(failed.compareDocumentPosition(screen.getByText("E6")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
describe("NewsletterBand 4: pending", () => {
  it.each([false, true])("blocks repeated submission for host handler=%s", host => {
    const onSubmit = vi.fn();
    render(view({ status: "pending", onSubmit: host ? onSubmit : undefined }));
    expect(field()).toHaveAttribute("readonly");
    const button = screen.getByRole("button", { name: "E3" });
    expect(button).toHaveAttribute("data-pending");
    expect(button).not.toBeDisabled();
    expect(button.tabIndex).toBe(0);
    act(() => button.focus());
    expect(button).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("E3");
    expect(screen.getByRole("status").firstElementChild).toHaveClass("sr-only");
    expect(dispatchSubmit(form()).defaultPrevented).toBe(true);
    expect(dispatchSubmit(form()).defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
describe("NewsletterBand 5: native post", () => {
  it("retains the native post and required email validation without cancellation", () => {
    render(view());
    const input = field();
    const target = form();
    expect(target.method).toBe("post");
    expect(target.getAttribute("action")).toBe("/subscribe");
    expect(target.noValidate).toBe(false);
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toBeRequired();
    act(() => { expect(input.checkValidity()).toBe(false); });
    fireEvent.change(input, { target: { value: "a@b.example" } });
    act(() => { expect(input.checkValidity()).toBe(true); });
    expect(dispatchSubmit(target).defaultPrevented).toBe(false);
    expect(target.elements).toHaveLength(2);
    expect(target.querySelector('[type="hidden"]')).toBeNull();
  });
});
describe("NewsletterBand 6: host submit", () => {
  it("trims the FormData value and cancels native submission once", () => {
    const onSubmit = vi.fn();
    render(view({ onSubmit, action: undefined }));
    const input = field();
    // A real FormData constructor with surrounding whitespace proves trimming
    // independently of native email inputs' own value sanitization.
    const NativeFormData = globalThis.FormData;
    vi.spyOn(globalThis, "FormData").mockImplementation(function(target?: HTMLFormElement) {
      const data = new NativeFormData(target);
      data.set(input.name, "  a@b.example  ");
      return data;
    });
    const event = dispatchSubmit(form());
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe("a@b.example");
    expect(onSubmit.mock.calls[0]![1].nativeEvent).toBe(event);
    expect(onSubmit.mock.calls[0]![1].defaultPrevented).toBe(true);
  });
  it("uses an empty value when FormData does not contain a string", () => {
    const onSubmit = vi.fn();
    render(view({ onSubmit }));
    vi.spyOn(FormData.prototype, "get").mockReturnValue(new File([], "sample"));
    dispatchSubmit(form());
    expect(onSubmit.mock.calls[0]![0]).toBe("");
  });
  it("supports keyboard submission with only a host handler", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(view({ onSubmit, action: undefined }));
    await user.tab();
    expect(field()).toHaveFocus();
    await user.type(field(), "a@b.example");
    await user.tab();
    expect(screen.getByRole("button", { name: "E2" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe("a@b.example");
  });
});
describe("NewsletterBand 7: technical field name", () => {
  it.each([undefined, "address"])("uses %s consistently for the input and FormData key", name => {
    const onSubmit = vi.fn();
    render(view({ name, onSubmit }));
    expect(field().name).toBe(name === undefined ? "email" : name);
    fireEvent.change(field(), { target: { value: "a@b.example" } });
    const get = vi.spyOn(FormData.prototype, "get");
    dispatchSubmit(form());
    expect(get).toHaveBeenCalledWith(name === undefined ? "email" : name);
    expect(onSubmit.mock.calls[0]![0]).toBe("a@b.example");
  });
});
describe("NewsletterBand 8: render contracts", () => {
  it("rejects missing submission destinations", () => expectContractError({ action: undefined, onSubmit: undefined }));
  it.each(["", "with space", "\t", "x\ny"])("rejects invalid name %j", name => expectContractError({ name }));
});
describe("NewsletterBand 9: address privacy", () => {
  it("does not write storage, cookies or the console after host submission", () => {
    const before = { local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), cookie: document.cookie };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(Document.prototype, "cookie", "set");
    const indexed = window.indexedDB ? vi.spyOn(window.indexedDB, "open") : undefined;
    const onSubmit = vi.fn();
    render(view({ onSubmit }));
    fireEvent.change(field(), { target: { value: "a@b.example" } });
    dispatchSubmit(form());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    if (indexed) expect(indexed).not.toHaveBeenCalled();
    expect({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), cookie: document.cookie }).toEqual(before);
  });
});
describe("NewsletterBand 10: action near-miss corpus", () => {
  it.each(actionCases)("validates $action with exact accepted=$accepted", ({ action, accepted }) => {
    const writes: unknown[] = [];
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function(this: Element, key, value) {
      if (this.tagName === "FORM" && key.toLowerCase() === "action") writes.push(value);
      return setAttribute.call(this, key, value);
    });
    if (accepted) {
      render(view({ action: action as string }));
      expect(form().getAttribute("action")).toBe(action);
    } else {
      expectContractError({ action: action as string });
      // Detect exposure while React creates the form, BEFORE a late effect or
      // boundary clears its DOM. A post-error empty container alone is vacuous.
      expect(writes).toEqual([]);
    }
  });
  it.each(rejectedActions)("validates even with a host handler: %j", action => {
    expectContractError({ action: action as string, onSubmit: vi.fn() });
  });
});
describe("NewsletterBand 11: layout and ground", () => {
  it("selects inline and stacked row contracts", () => {
    const { container, rerender } = render(view());
    expect(container.querySelector('.grid')).toHaveClass("tablet:grid-cols-[1fr_auto]", "tablet:items-end", "max-w-[32rem]");
    expect(screen.getByRole("button")).toHaveClass("w-full", "tablet:w-auto");
    rerender(view({ layout: "stacked" }));
    expect(container.querySelector('.tablet\\:grid-cols-\\[1fr_auto\\]')).toBeNull();
    expect(field().closest('.max-w-\\[28rem\\]')).toHaveClass("flex", "flex-col", "gap-sm");
  });
  it.each(["base", "sunken", "inverse"] as const)("uses the ground %s and its plate contract", ground => {
    const { container } = render(view({ ground }));
    const plate = container.querySelector('.rounded-panel.bg-surface-raised');
    if (ground === "inverse") {
      expect(plate).toHaveClass("rounded-panel", "p-lg", "text-ink-primary");
      expect(plate).toContainElement(form());
      expect(plate).toContainElement(screen.getByRole("status"));
    } else expect(plate).toBeNull();
    if (ground === "sunken") expect(container.firstElementChild).toHaveClass("bg-surface-sunken");
  });
});
describe("NewsletterBand 12: accessible structure", () => {
  it.each(statuses)("retains one polite atomic status region in %s", status => {
    render(view({ status, "aria-label": "Band" }));
    expect(screen.getByRole("form", { name: "Band" })).toHaveAttribute("method", "post");
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    expect(regions[0]).toHaveAttribute("aria-atomic", "true");
    if (status !== "sent") expect(field()).toHaveAccessibleName("E1");
    if (status === "idle" || status === "failed") expect(regions[0]).toBeEmptyDOMElement();
  });
  it("accepts an external form label and forwards root style and className", () => {
    const { container } = render(<><h2 id="band-heading">Host heading</h2>{view({ "aria-labelledby": "band-heading", className: "caller", style: { margin: 0 } })}</>);
    expect(screen.getByRole("form", { name: "Host heading" })).toHaveClass("caller");
    expect(screen.getByRole("form")).toHaveStyle({ margin: "0px" });
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });
});
