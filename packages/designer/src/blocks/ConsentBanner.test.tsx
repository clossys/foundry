import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentBanner } from "./ConsentBanner.js";

function setup(overrides: Partial<Parameters<typeof ConsentBanner>[0]> = {}) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const utils = render(
    <>
      <ConsentBanner
        title="Banner title"
        body="Banner body"
        acceptLabel="Accept label"
        rejectLabel="Reject label"
        onAccept={onAccept}
        onReject={onReject}
        {...overrides}
      />
      <button type="button">Following</button>
    </>,
  );
  const root = utils.container.querySelector("[data-consent-banner]") as HTMLElement;
  return { ...utils, root, onAccept, onReject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConsentBanner: handlers and keyboard", () => {
  it("click on each button calls only its own handler once", async () => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup();
    await user.click(screen.getByRole("button", { name: "Accept label" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reject label" }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls the handlers with no arguments", async () => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup();
    await user.click(screen.getByRole("button", { name: "Accept label" }));
    await user.click(screen.getByRole("button", { name: "Reject label" }));
    expect(onAccept).toHaveBeenCalledWith();
    expect(onReject).toHaveBeenCalledWith();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("%s on each button calls only its own handler once", async (_name, key) => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup();
    screen.getByRole("button", { name: "Accept label" }).focus();
    await user.keyboard(key);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Reject label" }).focus();
    await user.keyboard(key);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("Escape calls neither handler", async () => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup();
    screen.getByRole("button", { name: "Accept label" }).focus();
    await user.keyboard("{Escape}");
    screen.getByRole("button", { name: "Reject label" }).focus();
    await user.keyboard("{Escape}");
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("does not autofocus and does not trap Tab: Tab reaches a following button", async () => {
    const user = userEvent.setup();
    setup();
    expect(document.body).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Accept label" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Reject label" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Following" })).toHaveFocus();
  });
});

describe("ConsentBanner: structure", () => {
  it("renders a region landmark named by the title, with the data marker on the root", () => {
    const { root } = setup();
    expect(root.tagName).toBe("SECTION");
    const region = screen.getByRole("region", { name: "Banner title" });
    expect(region).toBe(root);
    const heading = screen.getByRole("heading", { name: "Banner title" });
    expect(root.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
  });

  it("is not a dialog and carries no modal wiring", () => {
    const { root } = setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute("aria-modal");
    expect(root).not.toHaveAttribute("role");
    expect(root.querySelector("[autofocus]")).toBeNull();
    for (const el of root.querySelectorAll("[tabindex]")) {
      expect(el.getAttribute("tabindex")).toBe("0");
    }
  });

  it("gives the two buttons identical variant and size classes", () => {
    setup();
    const accept = screen.getByRole("button", { name: "Accept label" });
    const reject = screen.getByRole("button", { name: "Reject label" });
    expect(accept.className).toBe(reject.className);
    expect(accept.tagName).toBe("BUTTON");
    expect(reject.tagName).toBe("BUTTON");
  });

  it("puts the privacy slot after the body", () => {
    const { root } = setup({ privacyLink: <a href="/privacy">Privacy link</a> });
    const body = screen.getByText("Banner body");
    const link = screen.getByRole("link", { name: "Privacy link" });
    expect(body.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.contains(link)).toBe(true);
  });

  it("omits the privacy slot when none is given", () => {
    const { root } = setup();
    expect(root.querySelector("a")).toBeNull();
  });

  it("renders a privacy slot of 0 and omits a false one", () => {
    const { root, unmount } = setup({ privacyLink: 0 });
    expect(root.textContent).toContain("0");
    unmount();
    const { root: other } = setup({ privacyLink: false });
    expect(other.querySelectorAll(".text-body-s")).toHaveLength(1);
  });

  it("renders no form control", () => {
    const { root } = setup();
    expect(root.querySelector("input, select, textarea")).toBeNull();
  });

  it("accepts ReactNode copy", () => {
    setup({ title: <>Banner <em>title</em></> });
    expect(screen.getByRole("region")).toHaveAccessibleName("Banner title");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { root } = setup({ className: "p-xl" });
    expect(root.className).toContain("p-xl");
    expect(root.className).not.toContain("p-lg");
  });

  it("forwards style onto the root", () => {
    const { root } = setup({ style: { marginTop: "4px" } });
    expect(root.style.marginTop).toBe("4px");
  });
});

describe("ConsentBanner: status slot", () => {
  function liveRegion(root: HTMLElement) {
    return root.querySelector('[role="status"]') as HTMLElement | null;
  }

  it("mounts a polite live region with no status, and it is empty", () => {
    const { root } = setup();
    const region = liveRegion(root);
    expect(region).not.toBeNull();
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region!.textContent).toBe("");
    expect(region!.childElementCount).toBe(0);
    expect(screen.getByRole("status")).toBe(region);
  });

  it.each([[false], [null], [undefined], [true]])("keeps the region mounted and empty for status %s", (value) => {
    const { root } = setup({ status: value as never });
    const region = liveRegion(root);
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region!.textContent).toBe("");
  });

  it("renders the status content inside the live region, in body, status, actions order", () => {
    const { root } = setup({ status: "Status text", privacyLink: <a href="/privacy">Privacy link</a> });
    const region = liveRegion(root)!;
    expect(region).toHaveTextContent("Status text");
    expect(screen.getByRole("status")).toHaveTextContent("Status text");
    const body = screen.getByText("Banner body");
    const accept = screen.getByRole("button", { name: "Accept label" });
    const reject = screen.getByRole("button", { name: "Reject label" });
    expect(body.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(reject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.contains(region)).toBe(true);
  });

  it("renders a status of 0 and ReactNode content", () => {
    const { root, unmount } = setup({ status: 0 });
    expect(liveRegion(root)).toHaveTextContent("0");
    unmount();
    setup({ status: <strong>Saved</strong> });
    expect(screen.getByRole("status")).toContainElement(screen.getByText("Saved"));
  });

  it("re-renders status changes into the same live region node", () => {
    const props = {
      title: "Banner title",
      body: "Banner body",
      acceptLabel: "Accept label",
      rejectLabel: "Reject label",
      onAccept: vi.fn(),
      onReject: vi.fn(),
    };
    const { container, rerender } = render(<ConsentBanner {...props} />);
    const region = container.querySelector('[role="status"]') as HTMLElement;
    expect(region.textContent).toBe("");
    rerender(<ConsentBanner {...props} status="First status" />);
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region).toHaveTextContent("First status");
    rerender(<ConsentBanner {...props} status="Second status" />);
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region).toHaveTextContent("Second status");
    expect(region).not.toHaveTextContent("First status");
    rerender(<ConsentBanner {...props} />);
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toBe("");
  });

  it("leaves both actions enabled and equal, with no disabled state anywhere, while a status shows", async () => {
    const user = userEvent.setup();
    const { root, onAccept, onReject } = setup({ status: "Status text" });
    const accept = screen.getByRole("button", { name: "Accept label" });
    const reject = screen.getByRole("button", { name: "Reject label" });
    expect(accept).toBeEnabled();
    expect(reject).toBeEnabled();
    expect(accept.className).toBe(reject.className);
    expect(root.querySelector("[disabled], [aria-disabled]")).toBeNull();
    await user.click(accept);
    await user.click(reject);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(root.querySelector("[disabled], [aria-disabled]")).toBeNull();
  });

  it("keeps the region landmark and the not-a-dialog contract with a status showing", () => {
    const { root } = setup({ status: "Status text" });
    expect(screen.getByRole("region", { name: "Banner title" })).toBe(root);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute("aria-modal");
    expect(root).not.toHaveAttribute("role");
  });
});

describe("ConsentBanner: no side effects", () => {
  it("touches no storage, cookie, network or beacon on render or either click", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSet = vi.fn();
    const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: cookieSet,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    try {
      setup();
      await user.click(screen.getByRole("button", { name: "Accept label" }));
      await user.click(screen.getByRole("button", { name: "Reject label" }));
      expect(setItem).not.toHaveBeenCalled();
      expect(cookieSet).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendBeacon).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
      if (originalCookie) Object.defineProperty(Document.prototype, "cookie", originalCookie);
      delete (navigator as unknown as Record<string, unknown>).sendBeacon;
      vi.unstubAllGlobals();
    }
  });

  it("the source text names no storage, network or analytics API", () => {
    const source = readFileSync(resolve(import.meta.dirname, "ConsentBanner.tsx"), "utf8");
    for (const name of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "fetch",
      "XMLHttpRequest",
      "sendBeacon",
      "indexedDB",
      "analytics",
      "setTimeout",
      "createPortal",
      "aria-modal",
      "autoFocus",
    ]) {
      expect(source, name).not.toContain(name);
    }
  });
});

describe("ConsentBanner: opaque and responsive", () => {
  it("uses the opaque overlay surface and border tokens only", () => {
    const { root } = setup();
    const classes = root.className.split(/\s+/);
    expect(classes).toContain("bg-overlay-surface");
    expect(classes).toContain("border-overlay-border");
    expect(root.className).not.toContain("scrim");
  });

  it("is stacked at base and a row from tablet, with the content capped for tablet-lg and wide", () => {
    const { root } = setup();
    const classes = root.className.split(/\s+/);
    expect(classes).toContain("flex-col");
    expect(classes).toContain("tablet:flex-row");
    const content = screen.getByText("Banner body").parentElement as HTMLElement;
    expect(content.className).toMatch(/(^|\s)tablet-lg:max-w-display(\s|$)/);
    expect(content.className).toMatch(/(^|\s)wide:max-w-display(\s|$)/);
    const actions = screen.getByRole("button", { name: "Accept label" }).parentElement as HTMLElement;
    expect(actions.className).toContain("flex-col");
    expect(actions.className).toContain("tablet:flex-row");
    expect(screen.getByRole("button", { name: "Accept label" }).className).toContain("w-full");
  });

  it("carries no transition or animation classes and no fixed positioning on its own elements", () => {
    const { root } = setup();
    // The Button atom's own classes are out of scope; check every other element.
    const own = [root, ...root.querySelectorAll("*")].filter((el) => el.tagName !== "BUTTON");
    for (const el of own) {
      expect(el.getAttribute("class") ?? "").not.toMatch(
        /(?:^|\s)(?:[a-z-]+:)*(?:transition|animate|duration|delay|ease)(?:-|\s|$)/,
      );
    }
    expect(root.className).not.toMatch(/\b(fixed|sticky|absolute)\b/);
  });

  it("resolves --color-overlay-surface to an opaque colour in every theme", () => {
    const css = readFileSync(resolve(import.meta.dirname, "..", "..", "styles", "tokens.css"), "utf8");
    const alias = /--color-overlay-surface:\s*var\((--[a-z-]+),\s*([^)]*\))\)/.exec(css);
    expect(alias).not.toBeNull();
    const declarations = [...css.matchAll(new RegExp(`${alias![1]}:\\s*([^;]+);`, "g"))].map((m) => m[1]!.trim());
    expect(declarations.length).toBeGreaterThan(0);
    // An oklch() colour is opaque unless it carries an alpha component after a slash.
    for (const value of [alias![2]!, ...declarations]) {
      expect(value).toMatch(/^oklch\(/);
      expect(value).not.toContain("/");
    }
  });
});
