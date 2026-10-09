// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { useAnalyticsAllowed, useConsentStatus } from "./hooks.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecycleInput, ConsentLifecyclePort, ConsentSnapshotView, ConsentStoragePortView } from "./ports.js";
import { isLoopbackHost, readReviewSeamValue } from "./review-seam.js";

/** Vitest's jsdom environment exposes its instance; `reconfigure` moves the URL without a navigation. */
const dom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom;
const goTo = (url: string) => dom.reconfigure({ url });

beforeEach(() => {
  sessionStorage.clear();
  goTo("http://localhost/");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  goTo("http://localhost/");
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

/** The host's real storage, recorded so a test can prove the seam never writes it. */
function hostStorage() {
  const writes: unknown[] = [];
  let reads = 0;
  const port: ConsentStoragePortView = {
    read: () => {
      reads += 1;
      return { kind: "empty" };
    },
    write: (choice) => {
      writes.push(choice);
      return { kind: "ok" };
    },
    remove: () => {
      writes.push("remove");
      return { kind: "ok" };
    },
  };
  return { port, writes, reads: () => reads };
}

interface Options {
  /** Reports `simulated` from the input (true) or always `false`. */
  honourSimulated?: boolean;
  /** Uses the supplied storage (true) or the host's own. */
  honourStorage?: boolean;
  /** Whether a choice writes to storage. */
  writeOnChoice?: boolean;
}

/**
 * A host factory shaped like the real one: it reads storage at mount and
 * writes on a choice. Under simulation it still reports `allowed: true` after
 * a grant, so the assembly's own mask is what the test proves.
 */
function hostFactory(host: ReturnType<typeof hostStorage>, options: Options = {}) {
  const { honourSimulated = true, honourStorage = true, writeOnChoice = true } = options;
  const created: { lifecycle: ConsentLifecyclePort; calls: string[]; input: ConsentLifecycleInput }[] = [];
  const factory = vi.fn((input: ConsentLifecycleInput): ConsentLifecyclePort => {
    const storage = honourStorage && input.storage ? input.storage : host.port;
    const calls: string[] = [];
    storage.read();
    let snapshot: ConsentSnapshotView = {
      ...NO_DECISION_VIEW,
      effective: input.signals.gpc ? "denied" : "none",
      gpcInForce: input.signals.gpc,
      promptAutomatically: !input.signals.gpc,
      simulated: honourSimulated ? input.simulated === true : false,
    };
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
        calls.push("grant");
        if (snapshot.gpcInForce) return snapshot;
        if (writeOnChoice) storage.write({ choice: "granted" });
        return publish({ effective: "granted", allowed: true, persistence: "stored", promptAutomatically: false });
      },
      refuse: () => {
        calls.push("refuse");
        if (writeOnChoice) storage.write({ choice: "denied" });
        return publish({ effective: "denied", allowed: false, persistence: "stored", promptAutomatically: false });
      },
      refresh: () => {
        calls.push("refresh");
        return snapshot;
      },
      dispose: () => {
        calls.push("dispose");
        listeners.clear();
      },
    };
    created.push({ lifecycle, calls, input });
    return lifecycle;
  });
  return { factory, created };
}

function Probe() {
  const allowed = useAnalyticsAllowed();
  const status = useConsentStatus();
  return <pre data-testid="probe">{JSON.stringify({ allowed, simulated: status.simulated })}</pre>;
}
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as { allowed: boolean; simulated: unknown };
const banner = () => document.querySelector("[data-consent-banner]");

describe("review seam (P-19)", () => {
  it("accepts exactly the three loopback host names", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    for (const host of ["example.test", "localhost.example.test", "127.0.0.2", "::1", "LOCALHOST.", "0.0.0.0", ""]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it.each(["fresh", "granted", "refused", "gpc"] as const)("simulates %s on loopback without writing, binding or reporting a choice", async (value) => {
    goTo(`http://localhost/?consent-review=${value}`);
    const host = hostStorage();
    const { factory, created } = hostFactory(host);
    const transport = { setPermission: vi.fn() };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} onChange={onChange}>
        <Probe />
      </ConsentExperience>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
    const input = created[0]!.input;
    expect(input).toEqual({ signals: { gpc: value === "gpc" }, storage: expect.any(Object), evidence: false, simulated: true });
    expect(input.storage).not.toBe(host.port);
    if (value === "granted") expect(created[0]!.calls).toEqual(["grant"]);
    else if (value === "refused") expect(created[0]!.calls).toEqual(["refuse"]);
    else expect(created[0]!.calls).toEqual([]);
    expect(probe()).toEqual({ allowed: false, simulated: value });
    if (value === "granted") expect(created[0]!.lifecycle.getSnapshot().allowed).toBe(true);

    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banner()).not.toBeNull();
    if (value === "gpc") expect(screen.getByRole("status")).toHaveTextContent("Status signal in force.");
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(probe().allowed).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(transport.setPermission).not.toHaveBeenCalled();
    expect(host.writes).toEqual([]);
    expect(host.reads()).toBe(0);
    expect(sessionStorage.getItem("consent-review")).toBe(value);
  });

  it("works on 127.0.0.1 and [::1], with a custom parameter name", () => {
    for (const origin of ["http://127.0.0.1:8080", "http://[::1]:3000"]) {
      goTo(`${origin}/?review=fresh`);
      const host = hostStorage();
      const { factory, created } = hostFactory(host);
      const view = render(
        <ConsentExperience copy={COPY} createLifecycle={factory} reviewSeam={{ param: "review" }}>
          <Probe />
        </ConsentExperience>,
      );
      expect(created[0]!.input.simulated).toBe(true);
      expect(probe().simulated).toBe("fresh");
      view.unmount();
      sessionStorage.clear();
    }
  });

  it("is ignored on any other host and when disabled", () => {
    for (const [url, seam] of [
      ["https://example.test/?consent-review=granted", undefined],
      ["http://localhost/?consent-review=granted", false],
    ] as const) {
      goTo(url);
      const host = hostStorage();
      const { factory, created } = hostFactory(host);
      const view = render(
        <ConsentExperience copy={COPY} createLifecycle={factory} {...(seam === false ? { reviewSeam: false as const } : {})}>
          <Probe />
        </ConsentExperience>,
      );
      expect(created[0]!.input).toEqual({ signals: { gpc: false } });
      expect(created[0]!.calls).toEqual([]);
      expect(probe().simulated).toBe(false);
      expect(sessionStorage.getItem("consent-review")).toBeNull();
      view.unmount();
    }
  });

  it("keeps the notice reviewable with required={false}, creating one lifecycle for the seam only", () => {
    goTo("http://localhost/?consent-review=fresh");
    const host = hostStorage();
    const transport = { setPermission: vi.fn() };
    const { factory } = hostFactory(host);
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} required={false}>
        <Probe />
      </ConsentExperience>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(banner()).not.toBeNull();
    expect(probe()).toEqual({ allowed: false, simulated: "fresh" });
    expect(transport.setPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["does not report simulated: true", { honourSimulated: false }, "granted"],
    ["reports simulated: true but wires the host's storage", { honourStorage: false }, "granted"],
    ["reports simulated: true but wires the host's storage (refused)", { honourStorage: false }, "refused"],
    ["does not write the seed to the in-memory port", { writeOnChoice: false }, "granted"],
  ] as const)("disposes a factory that %s and renders the fixed no-decision notice", async (_label, options, value) => {
    goTo(`http://localhost/?consent-review=${value}`);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = hostStorage();
    const { factory, created } = hostFactory(host, options);
    const transport = { setPermission: vi.fn() };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} onChange={onChange}>
        <Probe />
      </ConsentExperience>,
    );
    const calls = created[0]!.calls;
    if ("writeOnChoice" in options) {
      // The checks passed, the one seeding call was made, and its write never arrived.
      expect(calls).toEqual([value === "granted" ? "grant" : "refuse", "dispose"]);
    } else {
      // Disposed before any seeding call.
      expect(calls).toEqual(["dispose"]);
    }
    expect(host.writes).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    expect(banner()).not.toBeNull();
    expect(banner()).toHaveTextContent("Prompt lead sentence.");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    const before = [...calls];
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    // The actions are inert: no call reaches the disposed lifecycle.
    expect(created[0]!.calls).toEqual(before);
    expect(host.writes).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(transport.setPermission).not.toHaveBeenCalled();
    expect(probe()).toEqual({ allowed: false, simulated: value });
  });

  it("still holds a seam lifecycle that passes its checks and then reports simulated: false, allowed: true", () => {
    goTo("http://localhost/?consent-review=fresh");
    const host = hostStorage();
    const { factory: inner } = hostFactory(host);
    let checked = false;
    const factory = vi.fn((input: ConsentLifecycleInput): ConsentLifecyclePort => {
      const lifecycle = inner(input);
      const read = lifecycle.getSnapshot;
      let source: ConsentSnapshotView | null = null;
      let flipped: ConsentSnapshotView | null = null;
      return {
        ...lifecycle,
        // The first read is the seam's check; every later read flips, cached so React sees a stable snapshot.
        getSnapshot: () => {
          if (!checked) {
            checked = true;
            return read();
          }
          const current = read();
          if (current !== source || flipped === null) {
            source = current;
            flipped = { ...current, simulated: false, allowed: true };
          }
          return flipped;
        },
      };
    });
    const transport = { setPermission: vi.fn() };
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport}>
        <Probe />
      </ConsentExperience>,
    );
    expect(checked).toBe(true);
    expect(factory.mock.results[0]!.value.getSnapshot()).toMatchObject({ simulated: false, allowed: true });
    expect(probe()).toEqual({ allowed: false, simulated: "fresh" });
    expect(transport.setPermission).not.toHaveBeenCalled();
  });

  it("keeps a value for the tab, and live clears it", () => {
    goTo("http://localhost/?consent-review=granted");
    expect(readReviewSeamValue("consent-review")).toBe("granted");
    goTo("http://localhost/other");
    expect(readReviewSeamValue("consent-review")).toBe("granted");
    goTo("http://localhost/other?consent-review=unknown");
    expect(readReviewSeamValue("consent-review")).toBe("granted");
    goTo("http://localhost/other?consent-review=live");
    expect(readReviewSeamValue("consent-review")).toBeNull();
    expect(sessionStorage.getItem("consent-review")).toBeNull();
    goTo("http://localhost/other");
    expect(readReviewSeamValue("consent-review")).toBeNull();
  });

  it("lasts for the page load when the marker cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    goTo("http://localhost/?consent-review=refused");
    expect(readReviewSeamValue("consent-review")).toBe("refused");
    goTo("http://localhost/");
    expect(readReviewSeamValue("consent-review")).toBeNull();
  });
});
