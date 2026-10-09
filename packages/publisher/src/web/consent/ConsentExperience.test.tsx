// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { useAnalyticsAllowed, useConsentStatus } from "./hooks.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecycleInput, ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";
import { createConsentPreview } from "./preview/adapter.js";
import type { ConsentPreviewState } from "./preview/adapter.js";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
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

type Fields = Partial<ConsentSnapshotView>;
interface FakeLifecycle extends ConsentLifecyclePort {
  calls: string[];
  disposed: boolean;
  /** An outside change, as from another tab: publishes without a press. */
  set(fields: Fields): void;
}

/** A controllable lifecycle. `grant`/`refuse` return `null` for a no-op. */
function fakeLifecycle(
  initial: Fields,
  rules: { grant?: (s: ConsentSnapshotView) => Fields | null; refuse?: (s: ConsentSnapshotView) => Fields | null } = {},
): FakeLifecycle {
  let snapshot: ConsentSnapshotView = { ...NO_DECISION_VIEW, ...initial };
  const listeners = new Set<() => void>();
  const publish = (fields: Fields) => {
    snapshot = { ...snapshot, ...fields, sequence: snapshot.sequence + 1 };
    for (const listener of [...listeners]) listener();
    return snapshot;
  };
  const grant = rules.grant ?? (() => ({ effective: "granted", allowed: true, persistence: "stored", promptAutomatically: false }));
  const refuse = rules.refuse ?? (() => ({ effective: "denied", allowed: false, persistence: "stored", promptAutomatically: false }));
  const fake: FakeLifecycle = {
    calls: [],
    disposed: false,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    grant() {
      fake.calls.push("grant");
      const next = grant(snapshot);
      return next === null ? snapshot : publish(next);
    },
    refuse() {
      fake.calls.push("refuse");
      const next = refuse(snapshot);
      return next === null ? snapshot : publish(next);
    },
    refresh() {
      fake.calls.push("refresh");
      return snapshot;
    },
    dispose() {
      fake.calls.push("dispose");
      fake.disposed = true;
      listeners.clear();
    },
    set(fields) {
      act(() => {
        publish(fields);
      });
    },
  };
  return fake;
}

function recordingFactory(make: () => FakeLifecycle) {
  const created: FakeLifecycle[] = [];
  const inputs: ConsentLifecycleInput[] = [];
  const factory = vi.fn((input: ConsentLifecycleInput) => {
    inputs.push(input);
    const lifecycle = make();
    created.push(lifecycle);
    return lifecycle;
  });
  return { factory, created, inputs };
}

function Probe() {
  const allowed = useAnalyticsAllowed();
  const status = useConsentStatus();
  return <pre data-testid="probe">{JSON.stringify({ allowed, status })}</pre>;
}
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as { allowed: boolean; status: Record<string, unknown> };
const banner = () => document.querySelector("[data-consent-banner]");
const NOTICE_REVIEW_OFF = { reviewSeam: false } as const;

describe("ConsentExperience: required and onChange (P-15)", () => {
  it("with required={false} creates no lifecycle, binds no transport and ignores reopen", async () => {
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    const transport = { setPermission: vi.fn() };
    history.replaceState(null, "", "/#privacy-choices");
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} required={false} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(factory).not.toHaveBeenCalled();
    expect(transport.setPermission).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
    expect(location.hash).toBe("#privacy-choices");
    expect(probe().allowed).toBe(false);
  });

  it("never fires onChange on mount, on a stored read or on another tab's change", () => {
    const onChange = vi.fn();
    const { factory, created } = recordingFactory(() =>
      fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored" }),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    expect(factory).toHaveBeenCalledTimes(1);
    created[0]!.set({ effective: "denied", allowed: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onChange once per acted-on press", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(onChange.mock.calls).toEqual([["granted"]]);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onChange.mock.calls).toEqual([["granted"], ["denied"]]);
  });

  it("does not fire onChange for a no-op accept, which leaves the notice open showing the signal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { factory, created } = recordingFactory(() =>
      fakeLifecycle({ effective: "denied", gpcInForce: true, promptAutomatically: true }, { grant: () => null }),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(created[0]!.calls).toContain("grant");
    expect(onChange).not.toHaveBeenCalled();
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status signal in force.");
  });

  it("does not fire onChange for a no-op reject", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { factory, created } = recordingFactory(() =>
      fakeLifecycle({ effective: "denied", persistence: "stored" }, { refuse: () => null }),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(created[0]!.calls).toContain("refuse");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ConsentExperience: Escape, failed withdrawal and statuses (P-16)", () => {
  it("Escape records nothing, changes no permission and returns focus to the opener", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const transport = { setPermission: vi.fn() };
    const { factory, created } = recordingFactory(() => fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored" }));
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} onChange={onChange} {...NOTICE_REVIEW_OFF}>
        <button type="button">Opener</button>
      </ConsentExperience>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banner()).not.toBeNull();
    const callsBefore = [...created[0]!.calls];
    const permissionCalls = [...transport.setPermission.mock.calls];
    await user.tab();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(banner()).toBeNull();
    expect(created[0]!.calls).toEqual(callsBefore);
    expect(created[0]!.getSnapshot()).toMatchObject({ effective: "granted", allowed: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(transport.setPermission.mock.calls).toEqual(permissionCalls);
    expect(document.activeElement).toBe(opener);
  });

  it("an automatic open does not move focus", () => {
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("Escape after an automatic open returns focus to main, because focus was on the body", () => {
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(
      <main>
        <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />
      </main>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Reject" }), { key: "Escape" });
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main"));
  });

  it("a lifecycle whose snapshot has a failed withdrawal at mount shows the notice open with its status", () => {
    const { factory } = recordingFactory(() =>
      fakeLifecycle({ effective: "denied", persistence: "memory", withdrawal: "failed" }),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
  });

  it("keeps a failed withdrawal open through Escape, a repeated refusal and a re-read, and closes when it clears", async () => {
    const user = userEvent.setup();
    const { factory, created } = recordingFactory(() =>
      fakeLifecycle(
        { effective: "granted", allowed: true, persistence: "stored" },
        { refuse: () => ({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" }) },
      ),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).toBeNull();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reject" }), { key: "Escape" });
    expect(banner()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(banner()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(created[0]!.calls).toContain("refresh");
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
    created[0]!.set({ withdrawal: "idle", persistence: "stored" });
    expect(banner()).toBeNull();
  });

  it("shows a withdrawal that fails after Escape set the notice aside", () => {
    const { factory, created } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Reject" }), { key: "Escape" });
    expect(banner()).toBeNull();
    created[0]!.set({ effective: "denied", persistence: "memory", withdrawal: "failed" });
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
  });

  it("shows withdrawalFailed over storageUnavailable and memoryOnly after a refusal", async () => {
    const user = userEvent.setup();
    const { factory } = recordingFactory(() =>
      fakeLifecycle(
        { effective: "granted", allowed: true, persistence: "stored" },
        { refuse: () => ({ effective: "denied", allowed: false, withdrawal: "failed", storage: "unreadable", persistence: "memory" }) },
      ),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
  });

  it("shows withdrawalFailed over gpcInForce at mount", () => {
    const { factory } = recordingFactory(() => fakeLifecycle({ effective: "denied", withdrawal: "failed", gpcInForce: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
  });

  it("returns focus to the opener after a choice made from a reopened notice", async () => {
    const user = userEvent.setup();
    const { factory } = recordingFactory(() => fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored" }));
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <button type="button">Opener</button>
      </ConsentExperience>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(document.activeElement).not.toBe(opener);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to main after a choice when the opener left the document while the notice was open", async () => {
    const user = userEvent.setup();
    const { factory } = recordingFactory(() => fakeLifecycle({ effective: "denied", persistence: "stored" }));
    const tree = (withOpener: boolean) => (
      <main>
        <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
          {withOpener ? <button type="button">Opener</button> : null}
        </ConsentExperience>
      </main>
    );
    const view = render(tree(true));
    screen.getByRole("button", { name: "Opener" }).focus();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    view.rerender(tree(false));
    expect(screen.queryByRole("button", { name: "Opener" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("main"));
  });

  it("keeps the notice and omits the status text when the copy has no entry for the status", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { withdrawalFailed: _omitted, ...status } = COPY.status;
    const copy = { ...COPY, status } as unknown as ResolvedConsentCopy;
    const { factory } = recordingFactory(() => fakeLifecycle({ effective: "denied", persistence: "memory", withdrawal: "failed" }));
    render(
      <ConsentExperience copy={copy} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
      </ConsentExperience>,
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(consoleError).toHaveBeenCalled();
  });

  it("keeps withdrawal enabled while a grant's evidence is pending", async () => {
    const user = userEvent.setup();
    const { factory, created } = recordingFactory(() =>
      fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored", evidence: "pending" }),
    );
    render(<ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF} />);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject).toBeEnabled();
    await user.click(reject);
    expect(created[0]!.calls).toContain("refuse");
  });

  it("closes other statuses with the choice and shows them the next time the notice opens", async () => {
    const user = userEvent.setup();
    const { factory } = recordingFactory(() =>
      fakeLifecycle(
        { promptAutomatically: true },
        { refuse: () => ({ effective: "denied", persistence: "memory", promptAutomatically: false }) },
      ),
    );
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(banner()).toBeNull();
    expect(probe().status.persistence).toBe("memory");
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Status memory only.");
  });
});

/** C-51's "On arrival" and "On reopen" columns: `null` is closed, a string is open with that status, "" is open with none. */
const PREVIEW_TABLE: readonly (readonly [ConsentPreviewState, string | null, string | null])[] = [
  ["fresh-prompt", "", ""],
  ["fresh-notice", null, ""],
  ["remembered-granted", null, ""],
  ["remembered-refused", null, ""],
  ["withdrawn", null, ""],
  ["expired", "", ""],
  ["gpc", null, "Status signal in force."],
  ["not-required", null, null],
  ["pending-grant", null, ""],
  ["simulated-saved", null, ""],
  ["conflict", null, "Status evidence conflict."],
  ["unavailable", null, "Status evidence unavailable."],
  ["pending-withdrawal", null, ""],
  ["withdrawal-failed", "Status withdrawal failed.", "Status withdrawal failed."],
  ["reopen-unreadable", null, "Status storage unavailable."],
];

function expectNotice(expected: string | null): void {
  if (expected === null) {
    expect(banner()).toBeNull();
    return;
  }
  expect(banner()).not.toBeNull();
  if (expected === "") expect(screen.getByRole("status")).toBeEmptyDOMElement();
  else expect(screen.getByRole("status")).toHaveTextContent(expected);
}

describe("ConsentExperience: the fifteen preview states (C-51)", () => {
  it("covers every preview state", () => {
    expect(PREVIEW_TABLE).toHaveLength(15);
  });

  it.each(PREVIEW_TABLE)("%s: arrival and reopen match the table", (state, onArrival, onReopen) => {
    const preview = createConsentPreview({ state, now: "2026-01-01T00:00:00.000Z", environment: "development" });
    render(
      <ConsentExperience copy={COPY} createLifecycle={() => preview.lifecycle} required={preview.required} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    expectNotice(onArrival);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expectNotice(onReopen);
    expect(probe().allowed).toBe(false);
  });
});

describe("ConsentExperience: a throwing lifecycle mounts as failed", () => {
  it("logs a throwing factory and keeps the page, with no notice, no transport and analytics not allowed", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = { setPermission: vi.fn() };
    const factory = vi.fn((): ConsentLifecyclePort => {
      throw new Error("expiryMonths must be a whole number from 1 to 13");
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
        <Probe />
      </ConsentExperience>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(probe().allowed).toBe(false);
    expect(transport.setPermission).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banner()).toBeNull();
  });

  it("never binds the transport to a lifecycle whose first snapshot read throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = { setPermission: vi.fn() };
    const { factory, created } = recordingFactory(() => {
      const lifecycle = fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored" });
      lifecycle.getSnapshot = () => {
        throw new Error("snapshot read failed");
      };
      return lifecycle;
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
        <Probe />
      </ConsentExperience>,
    );
    await act(async () => {});
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(probe().allowed).toBe(false);
    expect(transport.setPermission).not.toHaveBeenCalled();
    expect(created[0]!.disposed).toBe(true);
  });

  it("logs a snapshot read that throws after mount, unbinds, disposes and falls back to no decision", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = { setPermission: vi.fn() };
    let broken = false;
    const { factory, created } = recordingFactory(() => {
      const lifecycle = fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored" });
      const read = lifecycle.getSnapshot;
      lifecycle.getSnapshot = () => {
        if (broken) throw new Error("snapshot read failed");
        return read();
      };
      return lifecycle;
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
        <Probe />
      </ConsentExperience>,
    );
    expect(probe().allowed).toBe(true);
    expect(transport.setPermission).toHaveBeenLastCalledWith(true);
    broken = true;
    created[0]!.set({ sequence: 5 });
    await act(async () => {});
    expect(consoleError).toHaveBeenCalled();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(probe()).toEqual({ allowed: false, status: expect.objectContaining({ persistence: "none", withdrawal: "idle" }) });
    expect(transport.setPermission).toHaveBeenLastCalledWith(false);
    expect(created[0]!.disposed).toBe(true);
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banner()).toBeNull();
  });
});

/** A fake whose named press throws, for the failure paths of a press. */
function throwingOn(press: "grant" | "refuse", initial: Fields): FakeLifecycle {
  const lifecycle = fakeLifecycle(initial);
  lifecycle[press] = () => {
    lifecycle.calls.push(press);
    throw new Error(`${press} failed`);
  };
  return lifecycle;
}

const GRANTED_STORED: Fields = { effective: "granted", allowed: true, persistence: "stored" };

describe("ConsentExperience: a lifecycle that throws on a press (C-24, C-45)", () => {
  it("reports nothing when grant() throws, and leaves no notice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const { factory } = recordingFactory(() => throwingOn("grant", { promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("reports nothing and moves no focus when refuse() throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const { factory } = recordingFactory(() => throwingOn("refuse", { ...GRANTED_STORED, promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} onChange={onChange} {...NOTICE_REVIEW_OFF} />);
    const reject = screen.getByRole("button", { name: "Reject" });
    reject.focus();
    fireEvent.click(reject);
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reject" }));
  });

  it("sets the transport's permission to false before the click returns when refuse() throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = { setPermission: vi.fn() };
    const { factory } = recordingFactory(() => throwingOn("refuse", { ...GRANTED_STORED, promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF} />);
    expect(transport.setPermission).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    // No await: the microtask has not run.
    expect(transport.setPermission).toHaveBeenLastCalledWith(false);
  });

  it("keeps the notice open with the failed withdrawal status when refuse() throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = { setPermission: vi.fn() };
    const { factory, created } = recordingFactory(() => throwingOn("refuse", { ...GRANTED_STORED, promptAutomatically: true }));
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await act(async () => {});
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
    expect(probe()).toEqual({ allowed: false, status: expect.objectContaining({ withdrawal: "failed" }) });
    expect(transport.setPermission).toHaveBeenLastCalledWith(false);
    expect(created[0]!.disposed).toBe(true);
    fireEvent.keyDown(banner()!, { key: "Escape" });
    expect(banner()).not.toBeNull();
  });

  it("keeps a failed withdrawal's status visible when the lifecycle throws after it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = false;
    const { factory, created } = recordingFactory(() => {
      const lifecycle = fakeLifecycle({ ...GRANTED_STORED, promptAutomatically: true }, { refuse: () => ({ withdrawal: "failed" }) });
      const read = lifecycle.getSnapshot;
      lifecycle.getSnapshot = () => {
        if (broken) throw new Error("snapshot read failed");
        return read();
      };
      return lifecycle;
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
    broken = true;
    created[0]!.set({ sequence: 9 });
    await act(async () => {});
    expect(created[0]!.disposed).toBe(true);
    expect(banner()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Status withdrawal failed.");
    expect(probe().allowed).toBe(false);
  });

  it("catches a lifecycle whose subscribe throws, and keeps the page", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { factory } = recordingFactory(() => {
      const lifecycle = fakeLifecycle({ ...GRANTED_STORED, promptAutomatically: true });
      lifecycle.subscribe = () => {
        throw new Error("subscribe failed");
      };
      return lifecycle;
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
        <Probe />
      </ConsentExperience>,
    );
    await act(async () => {});
    expect(consoleError).toHaveBeenCalled();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(probe().allowed).toBe(false);
    expect(banner()).toBeNull();
  });

  it("schedules no React update from inside the render whose snapshot read throws first", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = false;
    const { factory } = recordingFactory(() => {
      const lifecycle = fakeLifecycle(GRANTED_STORED);
      const read = lifecycle.getSnapshot;
      lifecycle.getSnapshot = () => {
        if (broken) throw new Error("snapshot read failed");
        return read();
      };
      return lifecycle;
    });
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    broken = true;
    // The reopen re-renders; that render's snapshot read is the first to throw.
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    await act(async () => {});
    expect(probe().allowed).toBe(false);
    const messages = consoleError.mock.calls.map((call) => String(call[0]));
    expect(messages).toEqual(["ConsentExperience: the lifecycle threw, so analytics is not allowed."]);
  });

  it("keeps the page when the host transport throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = {
      setPermission: vi.fn(() => {
        throw new Error("transport failed");
      }),
    };
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
      </ConsentExperience>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    cleanup();
    expect(transport.setPermission).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith("bindTransport: the transport's setPermission threw.");
  });
});

describe("ConsentExperience: incomplete hand-built copy", () => {
  it("omits the notice, without crashing, when a notice field is missing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { acceptLabel: _omitted, ...rest } = COPY;
    const copy = rest as ResolvedConsentCopy;
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(
      <ConsentExperience copy={copy} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <p>Page content</p>
      </ConsentExperience>,
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(banner()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith("ConsentExperience: the copy is missing a notice field, so the notice was omitted.");
  });

  it("omits the policy link, and keeps the notice, when the link label is missing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { privacyLinkLabel: _omitted, ...rest } = COPY;
    const copy = rest as ResolvedConsentCopy;
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={copy} createLifecycle={factory} policyLink={{ href: "/privacy" }} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).not.toBeNull();
    expect(banner()!.querySelector("a")).toBeNull();
    expect(consoleError).toHaveBeenCalledWith("ConsentExperience: the copy has no policy link label, so the policy link was omitted.");
  });
});

describe("ConsentExperience: strict permission", () => {
  it.each([
    ["allowed is a truthy string", { allowed: "false" as unknown as boolean }],
    ["simulated is missing", { allowed: true, simulated: undefined as unknown as boolean }],
  ])("is not allowed when %s", (_label, fields) => {
    const transport = { setPermission: vi.fn() };
    const { factory } = recordingFactory(() => fakeLifecycle({ effective: "granted", persistence: "stored", ...fields }));
    render(
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} {...NOTICE_REVIEW_OFF}>
        <Probe />
      </ConsentExperience>,
    );
    expect(probe().allowed).toBe(false);
    expect(transport.setPermission).not.toHaveBeenCalledWith(true);
  });
});

describe("ConsentExperience: hydration (P-17)", () => {
  it("renders the no-decision snapshot on the server and on the first client render", async () => {
    const { factory } = recordingFactory(() =>
      fakeLifecycle({ effective: "granted", allowed: true, persistence: "stored", promptAutomatically: true }),
    );
    const renders: boolean[] = [];
    function Recorder() {
      renders.push(useAnalyticsAllowed());
      return <span>child</span>;
    }
    const tree = (
      <ConsentExperience copy={COPY} createLifecycle={factory} {...NOTICE_REVIEW_OFF}>
        <Recorder />
      </ConsentExperience>
    );
    const html = renderToString(tree);
    expect(factory).not.toHaveBeenCalled();
    expect(html).not.toContain("data-consent-banner");
    expect(renders).toEqual([false]);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renders.length = 0;
    const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError: recoverable }));
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(renders[0]).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-consent-banner]")).not.toBeNull();
    expect(renders.at(-1)).toBe(true);
    act(() => root.unmount());
    container.remove();
  });
});

describe("ConsentExperience: regime-aware copy (P-28)", () => {
  it("uses the prompt lead under prompt and the notice lead under notice", () => {
    const prompt = recordingFactory(() => fakeLifecycle({ regime: "prompt", promptAutomatically: true }));
    const first = render(<ConsentExperience copy={COPY} createLifecycle={prompt.factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).toHaveTextContent("Prompt lead sentence.");
    expect(banner()).not.toHaveTextContent("Notice lead sentence.");
    first.unmount();

    const notice = recordingFactory(() => fakeLifecycle({ regime: "notice", effective: "none", allowed: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={notice.factory} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).toBeNull();
    act(() => {
      document.dispatchEvent(new Event("privacy-choices:open"));
    });
    expect(banner()).toHaveTextContent("Notice lead sentence.");
    expect(banner()).not.toHaveTextContent("Prompt lead sentence.");
  });

  it("labels the policy link with the resolved label", () => {
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} policyLink={{ href: "/privacy" }} {...NOTICE_REVIEW_OFF} />);
    expect(screen.getByRole("link", { name: "Policy" })).toHaveAttribute("href", "/privacy");
  });

  it.each(["#policy", "/privacy", "https://example.test/privacy", "mailto:privacy@example.test"])("renders an allowed policy href %s", (href) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} policyLink={{ href }} {...NOTICE_REVIEW_OFF} />);
    expect(screen.getByRole("link", { name: "Policy" })).toHaveAttribute("href", href);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    "//evil.example/x",
    "data:text/html,<p>x</p>",
    "https://user:pw@evil.example/",
    "vbscript:msgbox(1)",
    "javascript:alert(1)",
  ])("omits the policy link for %s and logs it", (href) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { factory } = recordingFactory(() => fakeLifecycle({ promptAutomatically: true }));
    render(<ConsentExperience copy={COPY} createLifecycle={factory} policyLink={{ href }} {...NOTICE_REVIEW_OFF} />);
    expect(banner()).not.toBeNull();
    // The decision is the assembly's: no anchor is created at all, whatever React would do with the href.
    expect(banner()!.querySelector("a")).toBeNull();
    expect(screen.queryByText("Policy")).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("ConsentExperience: client entry directive (C-49)", () => {
  /** Every runtime module of the client entry: this directory's sources except tests and the refusal module. */
  const CLIENT_ENTRY_MODULES = ["ConsentExperience.client.tsx", "bind-transport.ts", "context.ts", "guard-lifecycle.ts", "hooks.ts", "index.ts", "ports.ts", "reopen.ts", "review-seam.ts"];

  it("lists every runtime module in the client entry's directory", () => {
    const sources = readdirSync(import.meta.dirname)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith("refuse-"))
      .sort();
    expect(sources).toEqual(CLIENT_ENTRY_MODULES);
  });

  it.each(CLIENT_ENTRY_MODULES)("%s begins with the use client directive", (file) => {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    expect(source.startsWith('"use client";\n')).toBe(true);
  });
});
