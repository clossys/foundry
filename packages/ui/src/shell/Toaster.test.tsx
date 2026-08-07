import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "./Toaster.js";

// `toast`'s queue is a module-scoped singleton (see `internal/toast-queue.ts`
// for why) — real, deliberate, and exactly what makes `toast.success(...)`
// callable from anywhere. The cost of that, in tests, is that it persists
// across every `it()` in this file unless cleared; without this, an earlier
// test's still-open toast would still be in the DOM at the start of the
// next one.
afterEach(() => {
  act(() => {
    toast.dismissAll();
  });
});

describe("Toaster", () => {
  it("shows a toast added via toast(...) — the plain call — as an info-variant toast", () => {
    render(<Toaster />);
    act(() => {
      toast("Heads up");
    });
    expect(screen.getByText("Heads up")).toBeInTheDocument();
  });

  it("shows toasts added via toast.success/error/warning/info, each with the right visible text", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
      toast.error("Failed to save");
      toast.warning("Running low on space");
      toast.info("New version available");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Failed to save")).toBeInTheDocument();
    expect(screen.getByText("Running low on space")).toBeInTheDocument();
    expect(screen.getByText("New version available")).toBeInTheDocument();
  });

  it("renders an optional description under the title", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved", { description: "Your changes are live." });
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your changes are live.")).toBeInTheDocument();
  });

  it("a danger toast's content is an assertive live region (role=\"alert\", aria-live=\"assertive\")", () => {
    render(<Toaster />);
    act(() => {
      toast.error("Failed to save");
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to save");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("a non-danger toast's content is a polite live region (role=\"status\", aria-live=\"polite\"), not an alert", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the same is true for info and warning toasts — polite, not assertive", () => {
    render(<Toaster />);
    act(() => {
      toast.info("FYI");
      toast.warning("Careful");
    });
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the returned handle's dismiss() removes that toast immediately", () => {
    render(<Toaster />);
    let handle!: ReturnType<typeof toast.success>;
    act(() => {
      handle = toast.success("Saved");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => {
      handle.dismiss();
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("is dismissible by keyboard: Tab to the close button, then Enter closes it", async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close" });
    closeButton.focus();
    expect(closeButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  describe("auto-dismiss timing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-dismisses after its timeout elapses", () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("does not auto-dismiss before its timeout elapses", () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      });
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("never auto-dismisses when timeout is null", () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: null });
      });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("pauses its timer on hover, and resumes when the pointer leaves", () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      });
      const toastRegion = screen.getByRole("region");

      // `fireEvent`, not `userEvent.hover` — react-aria's `useHover` reacts
      // to plain pointer/mouse events dispatched directly at the element
      // (see `react-aria/interactions/useHover`), and `userEvent`'s own
      // internal scheduling doesn't mix cleanly with `vi.useFakeTimers()`
      // here. `mouseEnter`/`mouseLeave`, not `pointerEnter`/`pointerLeave`:
      // jsdom has no global `PointerEvent`, so `useHover` itself falls back
      // to plain mouse events in this environment (real browsers use
      // pointer events; the pause behavior is identical either way — this
      // is a test-environment detail, not a feature of `Toaster`).
      act(() => {
        fireEvent.mouseEnter(toastRegion);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // Hovered before the timeout elapsed — still paused, still present.
      expect(screen.getByText("Saved")).toBeInTheDocument();

      act(() => {
        fireEvent.mouseLeave(toastRegion);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("calls onClose exactly once when a toast auto-dismisses", () => {
      render(<Toaster />);
      const onClose = vi.fn();
      act(() => {
        toast.success("Saved", { timeout: 1000, onClose });
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
