import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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



function consentCardUtility(): string {
  const theme = readFileSync(resolve(import.meta.dirname, "..", "..", "styles", "theme-keys.css"), "utf8");
  const start = theme.indexOf("@utility consent-card {");
  expect(start).toBeGreaterThanOrEqual(0);
  let end = theme.indexOf("{", start), depth = 0;
  do {
    if (theme[end] === "{") depth++;
    if (theme[end] === "}") depth--;
    end++;
  } while (depth > 0 && end < theme.length);
  return theme.slice(start, end);
}

describe("CONSENT-1 card presentation", () => {
  it("preserves the immutable-base banner HTML by default and by explicit opt-in", () => {
    for (const presentation of [undefined, "banner"] as const) {
      const html = renderToStaticMarkup(<ConsentBanner title="Banner title" body="Banner body" acceptLabel="Accept label" rejectLabel="Reject label" onAccept={() => {}} onReject={() => {}} privacyLink={<a href="/privacy">Privacy link</a>} presentation={presentation} />)
        .replace(/\bid="[^"]+"/g, 'id="ID"').replace(/\baria-labelledby="[^"]+"/g, 'aria-labelledby="ID"');
      expect(createHash("sha256").update(html).digest("hex")).toBe("cfb61e6eb29a35cd8d643f517852d1ce9027db3dabd53e1b0483035c195405d0");
    }
  });

  it("keeps a named region, a visually hidden title, equal choices and a placement hook", () => {
    const { root } = setup({ presentation: "card" });
    expect(screen.getByRole("region", { name: "Banner title" })).toBe(root);
    expect(screen.getByRole("heading", { name: "Banner title" })).toHaveClass("sr-only");
    expect(root).toHaveClass("consent-card");
    expect(root).toHaveAttribute("data-consent-presentation", "card");
    const accept = screen.getByRole("button", { name: "Accept label" });
    const reject = screen.getByRole("button", { name: "Reject label" });
    expect(accept.className).toBe(reject.className);
    expect(accept).toHaveClass("w-full", "min-w-0", "whitespace-normal", "border", "border-current", "bg-transparent", "font-medium", "text-center");
    expect(accept).not.toHaveClass("flex-1");
    expect(accept).toHaveAttribute("aria-pressed", "false");
    expect(reject).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each(["granted", "denied"] as const)("marks only the %s choice and keeps the live region mounted", (selectedChoice) => {
    const { root } = setup({ presentation: "card", selectedChoice });
    const selected = screen.getByRole("button", { name: selectedChoice === "granted" ? "Accept label" : "Reject label" });
    const other = screen.getByRole("button", { name: selectedChoice === "granted" ? "Reject label" : "Accept label" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(selected.querySelector('[data-consent-selected][aria-hidden="true"]')).not.toBeNull();
    expect(other.querySelector("[data-consent-selected]")).toBeNull();
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("keeps long copy in an RTL card with logical safe-area placement and accessibility fallbacks", () => {
    const long = "Long consent wording ".repeat(80);
    const { container } = render(
      <div dir="rtl">
        <ConsentBanner presentation="card" title="Banner title" body={long} acceptLabel="Accept label" rejectLabel="Reject label" onAccept={() => {}} onReject={() => {}} />
      </div>,
    );
    const root = container.querySelector("[data-consent-banner]") as HTMLElement;
    expect(root).toHaveTextContent(long.trim());
    expect(root).not.toHaveAttribute("dir");
    expect(root.closest("[dir]")).toBe(container.firstElementChild);
    expect(root.parentElement).toHaveAttribute("dir", "rtl");
    const card = consentCardUtility();
    for (const declaration of ["position: fixed", "inset-inline", "inset-block-end", "safe-area-inset-bottom", "safe-area-inset-left", "safe-area-inset-right", "max-inline-size", "--container-sm", "--color-surface-base", "--blur-md", "--color-line-base", "prefers-reduced-transparency: reduce", "@supports not", "forced-colors: active", "overflow-y: auto"]) expect(card, declaration).toContain(declaration);
    expect(card).toContain("--ui-ring-focus: 0 0 0 2px var(--color-ink-primary");
    expect(card).toContain('\u0026[data-consent-presentation="card"] :focus-visible');
    expect(card).toContain("outline-color: var(--color-ink-primary");
    expect(card).not.toContain("animation");
    expect(card).not.toContain("scroll(");
    expect(readFileSync(resolve(import.meta.dirname, "..", "..", "styles", "compiled.css"), "utf8")).toContain(".consent-card");
  });
});


function cardDeclaration(card: string, property: string): string {
  // Top-level declaration of the utility only, never one nested in an at-rule.
  let depth = 0;
  for (const line of card.split("\n")) {
    const trimmed = line.trim();
    if (depth === 1 && trimmed.startsWith(`${property}:`)) return trimmed.slice(property.length + 1).replace(/;$/, "").trim();
    depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
  }
  throw new Error(`no top-level ${property}`);
}

function tokenValue(name: string): number {
  const tokens = readFileSync(resolve(import.meta.dirname, "..", "..", "styles", "tokens.css"), "utf8");
  const match = tokens.match(new RegExp(`${name}:\\s*([0-9.]+)(px|rem)?;`));
  expect(match, name).not.toBeNull();
  return Number(match![1]);
}

describe("CONSENT-1 card geometry matches the signed-off reference", () => {
  it("fills the viewport less safe-area gutters and centres below tablet width, with no width cap there", () => {
    const card = consentCardUtility();
    // Both inline insets are the gutter and margins are auto with no cap, so the
    // used inline size is the viewport less both gutters, centred (CSS 2.1 §10.3.7).
    expect(() => cardDeclaration(card, "max-inline-size")).toThrow("no top-level max-inline-size");
    expect(() => cardDeclaration(card, "inline-size")).toThrow("no top-level inline-size");
    expect(cardDeclaration(card, "inset-inline")).toBe("max(var(--spacing-md, 12px), env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px))");
    expect(cardDeclaration(card, "margin-inline")).toBe("auto");
    expect(cardDeclaration(card, "inset-block-end")).toBe("max(var(--spacing-md, 12px), env(safe-area-inset-bottom, 0px))");
    expect(card).not.toContain("--ui-width-form-max");
  });

  it("caps at the small container and pins bottom-start from tablet width, logically so RTL flips it", () => {
    const card = consentCardUtility();
    expect(card).toMatch(/@media \(width >= 48rem\) \{\s*margin-inline-start: 0;\s*max-inline-size: var\(--container-sm, 24rem\);\s*\}/);
    for (const physical of [/\bleft:/, /\bright:/, /\bbottom:/, /\btop:/, /margin-left/, /margin-right/, /(?<![-\w])width:/]) expect(card).not.toMatch(physical);
    // 48rem is the tablet breakpoint (768px at the 16px root).
    expect(tokenValue("--breakpoint-tablet")).toBe(48 * 16);
  });

  it("floats on the notice layer, above the shell footer and header and the sticky layer", () => {
    const card = consentCardUtility();
    expect(cardDeclaration(card, "position")).toBe("fixed");
    expect(cardDeclaration(card, "z-index")).toBe("var(--ui-z-notice, 40)");
    const shell = readFileSync(resolve(import.meta.dirname, "..", "shell", "internal", "shell-vars.ts"), "utf8");
    expect(shell).toContain('export const UI_Z_SHELL = "var(--ui-z-shell, 20)"');
    for (const shellFile of ["SiteFooter.tsx", "SiteHeader.tsx"]) {
      const source = readFileSync(resolve(import.meta.dirname, "..", "shell", shellFile), "utf8");
      expect(source, shellFile).toMatch(/zIndex: UI_Z_SHELL/);
    }
    expect(tokenValue("--ui-z-notice")).toBeGreaterThan(tokenValue("--ui-z-shell"));
    expect(tokenValue("--ui-z-notice")).toBeGreaterThan(tokenValue("--ui-z-sticky"));
  });

  it("uses the reference plate: 90% base fill, 95% without blur, hairline base line, raised elevation and medium blur", () => {
    const card = consentCardUtility();
    expect(cardDeclaration(card, "background-color")).toBe("color-mix(in oklab, var(--color-surface-base, oklch(0.9702 0 0)) 90%, transparent)");
    expect(cardDeclaration(card, "border-color")).toBe("var(--color-line-base, oklch(0.8761 0 0))");
    expect(cardDeclaration(card, "box-shadow")).toBe("var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))");
    expect(cardDeclaration(card, "backdrop-filter")).toBe("blur(var(--blur-md, 12px))");
    expect(card).toMatch(/@supports not \([^\n]*\) \{\s*background-color: color-mix\(in oklab, var\(--color-surface-base, oklch\(0\.9702 0 0\)\) 95%, transparent\);/);
    expect(card).not.toContain("--color-surface-glass");
    expect(card).not.toContain("--blur-glass");
    expect(card).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*transition-property: background-color, backdrop-filter;\s*transition-duration: var\(--ui-duration-default, 240ms\);/);
  });

  it("sizes choices as a two-column grid of full-width tap targets with reference padding", () => {
    const { root } = setup({ presentation: "card" });
    expect(root).toHaveClass("p-md", "tablet:p-lg");
    expect(root).not.toHaveClass("p-lg");
    const accept = screen.getByRole("button", { name: "Accept label" });
    expect(accept.parentElement).toHaveClass("grid", "grid-cols-2", "gap-sm");
    expect(accept).not.toHaveClass("whitespace-nowrap");
    const card = consentCardUtility();
    expect(card).toMatch(/& button \{\s*min-block-size: var\(--ui-layout-tap-target, 44px\);\s*transition-duration: var\(--ui-duration-fast, 160ms\);\s*transition-timing-function: var\(--ease-default, cubic-bezier\(\.2, 0, 0, 1\)\);/);
  });
});


describe("CONSENT-1 forced colors", () => {
  it("provides native choice edges and a focus outline where shadows are suppressed", () => {
    const card = consentCardUtility();
    expect(card).toContain("border-color: ButtonText");
    expect(card).toContain("outline: 2px solid Highlight");
    expect(card).toContain("outline-offset: 2px");
  });
});


describe("CONSENT-1 card server rendering and hydration", () => {
  it("hydrates the same named card and selected controls without errors, then handles a press", async () => {
    const onAccept = vi.fn(), onReject = vi.fn();
    const tree = <ConsentBanner presentation="card" selectedChoice="granted" title="Card title" body="Card body" acceptLabel="Accept label" rejectLabel="Reject label" onAccept={onAccept} onReject={onReject} />;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const region = container.querySelector("[data-consent-banner]");
    const status = container.querySelector('[role="status"]');
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recoverable }); });
      expect(container.querySelector("[data-consent-banner]")).toBe(region);
      expect(region).toHaveAccessibleName("Card title");
      expect(region).toHaveClass("consent-card");
      expect(container.querySelector("h2")).toHaveClass("sr-only");
      expect(container.querySelector('[role="status"]')).toBe(status);
      const accept = screen.getByRole("button", { name: "Accept label" });
      expect(accept).toHaveAttribute("aria-pressed", "true");
      expect(accept.querySelector("[data-consent-selected]")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Reject label" })).toHaveAttribute("aria-pressed", "false");
      await userEvent.setup().click(accept);
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).not.toHaveBeenCalled();
      expect(recoverable).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
    expect(consoleError).not.toHaveBeenCalled();
  });
});
