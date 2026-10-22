// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";
import { normaliseReopenFragment } from "./reopen.js";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

const field = (text: string): ResolvedCopyField => ({ text, recordId: "consent", entryId: text, revision: "1", locale: "en" });
const COPY: ResolvedConsentCopy = {
  title: field("Notice title"),
  promptLead: field("Prompt lead sentence."),
  noticeLead: field("Notice lead sentence."),
  acceptLabel: field("Accept"),
  rejectLabel: field("Reject"),
  privacyLinkLabel: field("Policy"),
  status: {
    memoryOnly: field("Status memory only."),
    withdrawalFailed: field("Status withdrawal failed."),
    evidenceUnavailable: field("Status evidence unavailable."),
    evidenceConflict: field("Status evidence conflict."),
    storageUnavailable: field("Status storage unavailable."),
    gpcInForce: field("Status signal in force."),
  },
};

/** A stored-choice lifecycle: the notice stays closed until reopened. */
function storedLifecycle(fields: Partial<ConsentSnapshotView> = {}) {
  const snapshot: ConsentSnapshotView = { ...NO_DECISION_VIEW, effective: "granted", allowed: true, persistence: "stored", ...fields };
  const calls: string[] = [];
  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    grant: () => snapshot,
    refuse: () => snapshot,
    refresh: () => {
      calls.push("refresh");
      return snapshot;
    },
    dispose: () => {},
  };
  return { lifecycle, calls };
}

const banners = () => document.querySelectorAll("[data-consent-banner]");

describe("reopen (P-18)", () => {
  it("honours a fragment present at load after mount, clears it without a history entry, focuses the notice and refreshes", () => {
    history.replaceState(null, "", "/page?x=1#privacy-choices");
    const historyLength = history.length;
    const { lifecycle, calls } = storedLifecycle();
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false} />);
    expect(banners()).toHaveLength(1);
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/page?x=1");
    expect(history.length).toBe(historyLength);
    expect(document.activeElement).toBe(banners()[0]);
    expect(calls).toEqual(["refresh"]);
  });

  it("ignores a leading # in the fragment prop and opens on a later hash change", () => {
    const { lifecycle } = storedLifecycle();
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reopen={{ fragment: "#choices" }} reviewSeam={false} />);
    expect(banners()).toHaveLength(0);
    act(() => {
      history.replaceState(null, "", "/#choices");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(banners()).toHaveLength(1);
    expect(location.hash).toBe("");
    expect(normaliseReopenFragment("#choices")).toBe("choices");
    expect(normaliseReopenFragment(undefined)).toBe("privacy-choices");
    expect(normaliseReopenFragment(false)).toBeNull();
  });

  it("opens once on the event, and a repeated trigger while open does nothing", () => {
    const { lifecycle, calls } = storedLifecycle();
    render(
      <ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false}>
        <button type="button">Elsewhere</button>
      </ConsentExperience>,
    );
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banners()).toHaveLength(1);
    expect(document.activeElement).toBe(banners()[0]);
    expect(calls).toEqual(["refresh"]);
    (document.querySelector("button") as HTMLButtonElement).focus();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
      history.replaceState(null, "", "/#privacy-choices");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(banners()).toHaveLength(1);
    expect(calls).toEqual(["refresh"]);
    expect(document.activeElement).toBe(document.querySelector("button"));
  });

  it("honours a custom event name and does not queue an event dispatched before mount", () => {
    const { lifecycle } = storedLifecycle();
    document.dispatchEvent(new Event("choices:show"));
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reopen={{ eventName: "choices:show" }} reviewSeam={false} />);
    expect(banners()).toHaveLength(0);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banners()).toHaveLength(0);
    act(() => {
      document.dispatchEvent(new Event("choices:show"));
    });
    expect(banners()).toHaveLength(1);
  });

  it("opens even when storage could not be read, with the storage status", () => {
    const { lifecycle } = storedLifecycle({ effective: "unknown", allowed: false, persistence: "none", storage: "unreadable" });
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false} />);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banners()).toHaveLength(1);
    expect(document.querySelector('[role="status"]')).toHaveTextContent("Status storage unavailable.");
  });

  it("refreshes on visibilitychange to visible and on pageshow, with no timer", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { lifecycle, calls } = storedLifecycle();
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false} />);
    const timersAfterMount = setTimeoutSpy.mock.calls.length + setIntervalSpy.mock.calls.length;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.visibilityState).toBe("visible");
    expect(calls).toEqual(["refresh"]);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(calls).toEqual(["refresh", "refresh"]);
    expect(setTimeoutSpy.mock.calls.length + setIntervalSpy.mock.calls.length).toBe(timersAfterMount);
    setTimeoutSpy.mockRestore();
    setIntervalSpy.mockRestore();
  });
});
