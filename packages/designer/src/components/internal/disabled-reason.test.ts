import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

interface Inputs {
  isDisabled?: boolean;
  disabledReason?: string;
  "aria-describedby"?: string;
}
interface Result {
  reasonId?: string;
  "aria-describedby"?: string;
}
type Hook = (props: Inputs) => Result;

async function loadHook(): Promise<Hook> {
  const path = resolve(import.meta.dirname, "disabled-reason.ts");
  // An absent implementation must fail a real test assertion rather than
  // turning tests-first evidence into a missing-import collection failure.
  expect(existsSync(path), "internal disabled-reason implementation exists").toBe(true);
  const module = await import(path);
  expect(typeof module.useDisabledReason).toBe("function");
  return module.useDisabledReason as Hook;
}

describe("internal disabled reason", () => {
  it("keeps a stable reason id while host copy changes and gives separate controls distinct ids", async () => {
    const useDisabledReason = await loadHook();
    const first = renderHook(props => useDisabledReason(props), {
      initialProps: { isDisabled: true, disabledReason: "Choose a workspace first" },
    });
    const second = renderHook(() => useDisabledReason({ isDisabled: true, disabledReason: "Choose a workspace first" }));
    const id = first.result.current.reasonId;
    expect(id).toBeTruthy();
    expect(id).not.toMatch(/\s/);
    expect(second.result.current.reasonId).toBeTruthy();
    expect(second.result.current.reasonId).not.toBe(id);
    first.rerender({ isDisabled: true, disabledReason: "Choose a project first" });
    expect(first.result.current.reasonId).toBe(id);
    expect(first.result.current["aria-describedby"]).toBe(id);
  });

  it("preserves and deduplicates existing descriptions before the reason", async () => {
    const useDisabledReason = await loadHook();
    const view = renderHook(props => useDisabledReason(props), {
      initialProps: { isDisabled: true, disabledReason: "Select an item first", "aria-describedby": "help details help" },
    });
    const id = view.result.current.reasonId!;
    expect(view.result.current["aria-describedby"]?.split(/\s+/)).toEqual(["help", "details", id]);
    view.rerender({ isDisabled: true, disabledReason: "Select an item first", "aria-describedby": `help ${id} details ${id}` });
    expect(view.result.current["aria-describedby"]?.split(/\s+/)).toEqual(["help", id, "details"]);
  });

  it.each([undefined, "", "  \n  "])("does not attach a reason for blank host copy %j", async disabledReason => {
    const useDisabledReason = await loadHook();
    const view = renderHook(() => useDisabledReason({ isDisabled: true, disabledReason, "aria-describedby": "help" }));
    expect(view.result.current.reasonId).toBeUndefined();
    expect(view.result.current["aria-describedby"]).toBe("help");
  });

  it("does not describe an enabled control with a disabled reason and restores the same id when disabled again", async () => {
    const useDisabledReason = await loadHook();
    const view = renderHook(props => useDisabledReason(props), {
      initialProps: { isDisabled: true, disabledReason: "Permission required", "aria-describedby": "help" },
    });
    const id = view.result.current.reasonId;
    view.rerender({ isDisabled: false, disabledReason: "Permission required", "aria-describedby": "help" });
    expect(view.result.current.reasonId).toBeUndefined();
    expect(view.result.current["aria-describedby"]).toBe("help");
    view.rerender({ isDisabled: true, disabledReason: "Permission required", "aria-describedby": "help" });
    expect(view.result.current.reasonId).toBe(id);
  });

  it("returns no blank aria-describedby when neither host description nor reason applies", async () => {
    const useDisabledReason = await loadHook();
    const view = renderHook(() => useDisabledReason({}));
    expect(view.result.current.reasonId).toBeUndefined();
    expect(view.result.current["aria-describedby"]).toBeUndefined();
  });
});
