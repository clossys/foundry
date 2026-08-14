// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentGate } from "./ConsentGate.js";
import type { ConsentEvaluation } from "../types.js";

afterEach(() => {
  document.body.innerHTML = "";
});

const V1 = { policyId: "cookie-policy", version: "1" };

const EVALUATIONS: Record<string, ConsentEvaluation> = {
  absent: { status: "absent" },
  stale: { status: "stale", previousPolicyVersion: V1 },
  granted: { status: "granted", policyVersion: V1 },
  denied: { status: "denied", policyVersion: V1 },
};

describe("ConsentGate", () => {
  it("renders children only when evaluation.status is granted", () => {
    for (const [name, evaluation] of Object.entries(EVALUATIONS)) {
      const html = renderToString(
        <ConsentGate category="marketing" evaluation={evaluation} fallback={<span>fallback</span>}>
          <span>granted-content</span>
        </ConsentGate>,
      );
      if (name === "granted") expect(html).toContain("granted-content");
      else expect(html).toContain("fallback");
    }
  });

  it("never wraps its output in an extra DOM element", () => {
    const html = renderToString(
      <ConsentGate category="marketing" evaluation={{ status: "granted", policyVersion: V1 }} fallback={<span>fallback</span>}>
        <span>granted-content</span>
      </ConsentGate>,
    );
    expect(html).toBe("<span>granted-content</span>");
  });

  // The concrete SSR contract, not a prose claim: for every ConsentEvaluation
  // status, the server-rendered markup and the FIRST client render are
  // byte-identical, and hydration reports zero recoverable errors — the
  // observable signature of a flash-of-wrong-content bug.
  it("produces byte-identical server and first-client-render output for every evaluation status", async () => {
    for (const evaluation of Object.values(EVALUATIONS)) {
      const tree = (
        <ConsentGate category="marketing" evaluation={evaluation} fallback={<span data-testid="fallback">fallback</span>}>
          <span data-testid="granted">granted-content</span>
        </ConsentGate>
      );
      const serverHtml = renderToString(tree);
      const container = document.createElement("div");
      container.innerHTML = serverHtml;
      document.body.append(container);
      const clientHtmlBeforeHydration = container.innerHTML;
      expect(clientHtmlBeforeHydration).toBe(serverHtml);

      const onRecoverableError = vi.fn();
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError });
        await Promise.resolve();
      });

      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe(serverHtml);

      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
