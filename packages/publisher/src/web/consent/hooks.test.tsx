// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConsentCopy, ResolvedCopyField } from "../../consent-copy/types.js";
import { ConsentExperience } from "./ConsentExperience.client.js";
import { useAnalyticsAllowed, useConsentStatus } from "./hooks.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";
import { createConsentPreview } from "./preview/adapter.js";

afterEach(cleanup);

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

function Probe() {
  const allowed = useAnalyticsAllowed();
  const status = useConsentStatus();
  return <pre data-testid="probe">{JSON.stringify({ allowed, status })}</pre>;
}
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as { allowed: boolean; status: Record<string, unknown> };

/** A live, granted lifecycle that records whether it was disposed. */
function grantedLifecycle(fields: Partial<ConsentSnapshotView> = {}) {
  const snapshot: ConsentSnapshotView = { ...NO_DECISION_VIEW, effective: "granted", allowed: true, persistence: "stored", ...fields };
  const state = { disposed: false };
  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    grant: () => snapshot,
    refuse: () => snapshot,
    refresh: () => snapshot,
    dispose: () => {
      state.disposed = true;
    },
  };
  return { lifecycle, state };
}

describe("hooks (P-30)", () => {
  it("report not allowed and the no-decision status outside a ConsentExperience", () => {
    render(<Probe />);
    expect(probe()).toEqual({
      allowed: false,
      status: { persistence: "none", storage: "readable", evidence: "none", withdrawal: "idle", gpcInForce: false, simulated: false },
    });
  });

  it("report allowed for a live granted lifecycle", () => {
    const { lifecycle } = grantedLifecycle();
    render(
      <ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false}>
        <Probe />
      </ConsentExperience>,
    );
    expect(probe().allowed).toBe(true);
    expect(probe().status.simulated).toBe(false);
  });

  it.each(["remembered-granted", "fresh-notice"] as const)("mask the preview's %s state as not allowed and name it preview", (state) => {
    const preview = createConsentPreview({ state, now: "2026-01-01T00:00:00.000Z", environment: "development" });
    expect(preview.lifecycle.getSnapshot().allowed).toBe(true);
    const transport = { setPermission: vi.fn() };
    render(
      <ConsentExperience copy={COPY} createLifecycle={() => preview.lifecycle} required={preview.required} transport={transport} reviewSeam={false}>
        <Probe />
      </ConsentExperience>,
    );
    expect(probe().allowed).toBe(false);
    expect(probe().status.simulated).toBe("preview");
    expect(transport.setPermission).not.toHaveBeenCalled();
  });

  it("dispose the lifecycle on unmount", () => {
    const { lifecycle, state } = grantedLifecycle();
    const view = render(<ConsentExperience copy={COPY} createLifecycle={() => lifecycle} reviewSeam={false} />);
    expect(state.disposed).toBe(false);
    view.unmount();
    expect(state.disposed).toBe(true);
  });

  it("dispose and unbind when required turns false, and create a new lifecycle when it turns back", () => {
    const made: ReturnType<typeof grantedLifecycle>[] = [];
    const factory = vi.fn(() => {
      const next = grantedLifecycle();
      made.push(next);
      return next.lifecycle;
    });
    const transport = { setPermission: vi.fn() };
    const tree = (required: boolean) => (
      <ConsentExperience copy={COPY} createLifecycle={factory} transport={transport} required={required} reviewSeam={false}>
        <Probe />
      </ConsentExperience>
    );
    const view = render(tree(true));
    expect(probe().allowed).toBe(true);
    expect(transport.setPermission.mock.calls.at(-1)).toEqual([true]);
    view.rerender(tree(false));
    expect(made[0]!.state.disposed).toBe(true);
    expect(transport.setPermission.mock.calls.at(-1)).toEqual([false]);
    expect(probe().allowed).toBe(false);
    view.rerender(tree(true));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(made[1]!.state.disposed).toBe(false);
    expect(probe().allowed).toBe(true);
  });

  it("leave exactly one live lifecycle after a development double mount", () => {
    const made: ReturnType<typeof grantedLifecycle>[] = [];
    render(
      <StrictMode>
        <ConsentExperience
          copy={COPY}
          createLifecycle={() => {
            const next = grantedLifecycle();
            made.push(next);
            return next.lifecycle;
          }}
          reviewSeam={false}
        >
          <Probe />
        </ConsentExperience>
      </StrictMode>,
    );
    expect(made.length).toBeGreaterThanOrEqual(2);
    expect(made.filter((entry) => !entry.state.disposed)).toHaveLength(1);
    expect(made.at(-1)!.state.disposed).toBe(false);
  });
});
