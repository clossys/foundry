import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { SHELL_COPY_REFS, type ShellCopyResolver } from "../components/Banner.copy.js";

/** Every non-theme label is host-owned, so these renders exercise the real theme fallback. */
function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg" },
    navigation: {
      tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Navigation",
      openLabel: "Open navigation", closeLabel: "Close navigation", emptyMessage: "No destinations",
    },
    account: { actor: { name: "Reader" }, signedOutLabel: "Guest", sections: [] },
    commands: {
      heading: "Commands", searchLabel: "Search", closeLabel: "Close commands", emptyMessage: "No commands",
      triggerLabel: "Find", groups: [], resultCountMessage: count => `${count} commands`,
    },
    skipLabel: "Skip", breadcrumbLabel: "Location", collapsedBreadcrumbLabel: "Earlier locations",
    pageInfoLabel: "Modules", pageActionsLabel: "Actions", mainId: "host-main", children: <p>Content</p>,
  };
}

describe("AppFrame host theme labels", () => {
  it("renders a supplied control without a copy resolver or default theme labels", () => {
    const markup = renderToString(<AppFrame {...fixture()} themeControl={<button>Host preference</button>} />);
    expect(markup).toContain("Host preference");
    expect(markup).not.toContain('aria-pressed=');
  });

  it("keeps an explicit null control omitted without requiring default labels", () => {
    const markup = renderToString(<AppFrame {...fixture()} themeControl={null} />);
    expect(markup).not.toContain('data-application-frame-slot="theme-control"');
  });

  it("requires host copy when the default control is rendered", () => {
    expect(() => renderToString(<AppFrame {...fixture()} />)).toThrow("Designer shell copy requires a host resolver or explicit host labels");
  });

  it("resolves default labels only while rendering the fallback", () => {
    const labels = new Map([
      [SHELL_COPY_REFS.theme.system.id, "Automatic preference"],
      [SHELL_COPY_REFS.theme.light.id, "Bright preference"],
      [SHELL_COPY_REFS.theme.dark.id, "Dim preference"],
    ]);
    const resolver = vi.fn<ShellCopyResolver>(ref => {
      const text = labels.get(ref.id);
      return text === undefined ? undefined : { ref, text };
    });
    renderToString(<AppFrame {...fixture()} copyResolver={resolver} themeControl={<button>Host preference</button>} />);
    expect(resolver).not.toHaveBeenCalled();
    const markup = renderToString(<AppFrame {...fixture()} copyResolver={resolver} />);
    expect(markup).toContain('aria-label="Dim preference"');
    expect(resolver.mock.calls.map(([ref]) => ref.id)).toEqual([
      SHELL_COPY_REFS.theme.system.id, SHELL_COPY_REFS.theme.light.id, SHELL_COPY_REFS.theme.dark.id,
    ]);
  });
});
