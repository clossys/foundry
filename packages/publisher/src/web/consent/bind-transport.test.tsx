// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { bindTransport } from "./bind-transport.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { AnalyticsPermissionPort, ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

/** A lifecycle that notifies synchronously and logs when each call returns. */
function loggingLifecycle(log: string[], initial: Partial<ConsentSnapshotView>) {
  let snapshot: ConsentSnapshotView = { ...NO_DECISION_VIEW, ...initial };
  const listeners = new Set<() => void>();
  const publish = (fields: Partial<ConsentSnapshotView>) => {
    snapshot = { ...snapshot, ...fields, sequence: snapshot.sequence + 1 };
    for (const listener of [...listeners]) listener();
    return snapshot;
  };
  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    grant: () => {
      const next = publish({ effective: "granted", allowed: true, persistence: "stored", promptAutomatically: false });
      log.push("grant returned");
      return next;
    },
    refuse: () => {
      const next = publish({ effective: "denied", allowed: false, persistence: "stored", promptAutomatically: false });
      log.push("refuse returned");
      return next;
    },
    refresh: () => snapshot,
    dispose: () => listeners.clear(),
  };
  return { lifecycle, listeners };
}

const loggingTransport = (log: string[]): AnalyticsPermissionPort => ({
  setPermission: (allowed) => {
    log.push(`permission ${String(allowed)}`);
  },
});

describe("bindTransport (P-29)", () => {
  it("sets permission on bind and inside each notification, so a withdrawal lands before refuse() returns", () => {
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, { effective: "granted", allowed: true, persistence: "stored" });
    const unbind = bindTransport(lifecycle, loggingTransport(log));
    expect(log).toEqual(["permission true"]);
    lifecycle.refuse();
    expect(log).toEqual(["permission true", "permission false", "refuse returned"]);
    unbind();
  });

  it("unbinding sets false and stops listening", () => {
    const log: string[] = [];
    const { lifecycle, listeners } = loggingLifecycle(log, { effective: "granted", allowed: true });
    const unbind = bindTransport(lifecycle, loggingTransport(log));
    unbind();
    expect(log).toEqual(["permission true", "permission false"]);
    expect(listeners.size).toBe(0);
    lifecycle.grant();
    unbind();
    expect(log).toEqual(["permission true", "permission false", "grant returned"]);
  });

  it("a simulated snapshot never sets true", () => {
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, { effective: "granted", allowed: true, simulated: true });
    const unbind = bindTransport(lifecycle, loggingTransport(log));
    lifecycle.grant();
    lifecycle.refuse();
    lifecycle.grant();
    unbind();
    expect(log.filter((entry) => entry.startsWith("permission"))).not.toContain("permission true");
  });
});

describe("bindTransport: a throwing transport or lifecycle", () => {
  it("catches a throwing setPermission on bind, on notification and on unbind, and logs no value", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, {});
    const transport: AnalyticsPermissionPort = {
      setPermission: (allowed) => {
        log.push(`permission ${String(allowed)}`);
        throw new Error("transport failed");
      },
    };
    let unbind: () => void = () => {};
    expect(() => {
      unbind = bindTransport(lifecycle, transport);
    }).not.toThrow();
    expect(() => lifecycle.grant()).not.toThrow();
    expect(() => unbind()).not.toThrow();
    expect(log).toEqual(["permission false", "permission true", "grant returned", "permission false"]);
    expect(consoleError).toHaveBeenCalledTimes(3);
    for (const call of consoleError.mock.calls) expect(call).toEqual(["bindTransport: the transport's setPermission threw."]);
  });

  it("sets false when the snapshot cannot be read", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, { effective: "granted", allowed: true, persistence: "stored" });
    lifecycle.getSnapshot = () => {
      throw new Error("snapshot read failed");
    };
    expect(() => bindTransport(lifecycle, loggingTransport(log))).not.toThrow();
    expect(log).toEqual(["permission false"]);
    expect(consoleError).toHaveBeenCalledWith("bindTransport: the lifecycle's getSnapshot threw, so permission is false.");
  });

  it("still sets false on unbind when unsubscribe throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, { effective: "granted", allowed: true, persistence: "stored" });
    lifecycle.subscribe = () => () => {
      throw new Error("unsubscribe failed");
    };
    const unbind = bindTransport(lifecycle, loggingTransport(log));
    expect(() => unbind()).not.toThrow();
    expect(log).toEqual(["permission true", "permission false"]);
  });
});

describe("ConsentExperience transport binding (P-29)", () => {
  const field = (text: string): ResolvedCopyField => ({ text, recordId: "consent", entryId: text, revision: "1", locale: "en" });
  const COPY: ResolvedConsentCopy = {
    title: field("Notice title"),
    promptLead: field("Prompt lead sentence."),
    noticeLead: field("Notice lead sentence."),
    acceptLabel: field("Accept"),
    rejectLabel: field("Reject"),
    privacyLinkLabel: field("Policy"),
    status: {
      memoryOnly: field("m"),
      withdrawalFailed: field("w"),
      evidenceUnavailable: field("u"),
      evidenceConflict: field("c"),
      storageUnavailable: field("s"),
      gpcInForce: field("g"),
    },
  };

  it("a press on reject reaches the bound transport before refuse() returns", async () => {
    const user = userEvent.setup();
    const log: string[] = [];
    const { lifecycle } = loggingLifecycle(log, { promptAutomatically: true });
    render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} transport={loggingTransport(log)} reviewSeam={false} />);
    expect(log).toEqual(["permission false"]);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(log).toEqual(["permission false", "permission true", "grant returned"]);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(log).toEqual(["permission false", "permission true", "grant returned", "permission false", "refuse returned"]);
  });
});
