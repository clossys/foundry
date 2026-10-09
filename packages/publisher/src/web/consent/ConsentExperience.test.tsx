// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { useAnalyticsAllowed, useConsentStatus } from "./hooks.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecycleInput, ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";

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

  it("Escape returns focus to main when the opener is gone", () => {
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
});
