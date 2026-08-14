import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTokenStylesLoadedReportedForTests,
  assertTokenStylesLoaded,
  TOKEN_STYLES_SENTINEL_PROPERTY,
} from "./assert-token-styles-loaded.js";

function setSentinel(value: string | undefined): void {
  if (value === undefined) {
    document.documentElement.style.removeProperty(TOKEN_STYLES_SENTINEL_PROPERTY);
    return;
  }
  document.documentElement.style.setProperty(TOKEN_STYLES_SENTINEL_PROPERTY, value);
}

describe("assertTokenStylesLoaded", () => {
  beforeEach(() => {
    __resetTokenStylesLoadedReportedForTests();
  });

  afterEach(() => {
    setSentinel(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays silent when the sentinel is present (prerequisite present)", () => {
    setSentinel("1");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onMissing = vi.fn();

    assertTokenStylesLoaded({ onMissing });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("reports via console.error when the sentinel is missing entirely (prerequisite absent)", () => {
    setSentinel(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertTokenStylesLoaded();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain(TOKEN_STYLES_SENTINEL_PROPERTY);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("@vespeneventures/ui/tokens.css");
  });

  it("calls a caller-supplied onMissing instead of console.error when given one", () => {
    setSentinel(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onMissing = vi.fn();

    assertTokenStylesLoaded({ onMissing });

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith({ marker: TOKEN_STYLES_SENTINEL_PROPERTY });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports when the sentinel has an unexpected value, not just when it's absent", () => {
    setSentinel("0");
    const onMissing = vi.fn();

    assertTokenStylesLoaded({ onMissing });

    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("reads a custom target element when one is supplied", () => {
    setSentinel(undefined);
    const target = document.createElement("div");
    target.style.setProperty(TOKEN_STYLES_SENTINEL_PROPERTY, "1");
    document.body.append(target);
    const onMissing = vi.fn();

    assertTokenStylesLoaded({ target, onMissing });

    expect(onMissing).not.toHaveBeenCalled();
    target.remove();
  });

  it("reports at most once across repeated calls, even with different callbacks (repeated calls)", () => {
    setSentinel(undefined);
    const first = vi.fn();
    const second = vi.fn();

    assertTokenStylesLoaded({ onMissing: first });
    assertTokenStylesLoaded({ onMissing: second });
    assertTokenStylesLoaded({ onMissing: second });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("is inert in a production build, even when the sentinel is missing (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    setSentinel(undefined);
    const onMissing = vi.fn();

    assertTokenStylesLoaded({ onMissing });

    expect(onMissing).not.toHaveBeenCalled();
  });

  it("never runs a check as a side effect of importing the module", async () => {
    // Re-importing does not execute the function; only calling it does.
    // This test simply documents that the module has no top-level call —
    // if it did, the earlier tests in this file (which import once, then
    // call explicitly) would already have double-reported.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("./assert-token-styles-loaded.js");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
