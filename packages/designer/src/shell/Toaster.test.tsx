import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "./Toaster.js";

// `toast`'s store is sonner's module-scoped singleton (see `internal/toast-queue.ts`)
// — real, deliberate, and exactly what makes `toast.success(...)`
// callable from anywhere. The cost of that, in tests, is that it persists
// across every `it()` in this file unless cleared; without this, an earlier
// test's still-open toast would still be in the DOM at the start of the
// next one.
afterEach(() => {
  act(() => {
    toast.dismissAll();
  });
});

// Sonner's swipe-to-dismiss captures the pointer on pointerdown; jsdom has no pointer capture.
beforeAll(() => {
  if (!("setPointerCapture" in Element.prototype)) Object.assign(Element.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
});

/** Sonner's exit transition before it unmounts a dismissed toast. */
const EXIT_MS = 200;
/** Sonner hands each store change to React on the next task; let it land (under fake timers too). */
const settle = () => act(async () => {
  if (vi.isFakeTimers()) vi.advanceTimersByTime(1);
  else await new Promise(resolve => setTimeout(resolve, 0));
});

describe("Toaster", () => {
  it("shows a toast added via toast(...) — the plain call — as an info-variant toast", async () => {
    render(<Toaster />);
    act(() => {
      toast("Heads up");
    });
    await settle();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
  });

  it("shows toasts added via toast.success/error/warning/info, each with the right visible text", async () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
      toast.error("Failed to save");
      toast.warning("Running low on space");
      toast.info("New version available");
    });
    await settle();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Failed to save")).toBeInTheDocument();
    expect(screen.getByText("Running low on space")).toBeInTheDocument();
    expect(screen.getByText("New version available")).toBeInTheDocument();
  });

  it("renders an optional description under the title", async () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved", { description: "Your changes are live." });
    }); await settle();
    await settle();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your changes are live.")).toBeInTheDocument();
  });

  it("a danger toast's content is an assertive live region (role=\"alert\", aria-live=\"assertive\")", async () => {
    render(<Toaster />);
    act(() => {
      toast.error("Failed to save");
    });
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to save");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("a non-danger toast is announced by the polite live region (aria-live=\"polite\"), not an alert", async () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
    });
    await settle();
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the same is true for info and warning toasts — polite, not assertive", async () => {
    render(<Toaster />);
    act(() => {
      toast.info("FYI");
      toast.warning("Careful");
    });
    await settle();
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("FYI");
    expect(region).toHaveTextContent("Careful");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is a labelled landmark that F6 moves focus into", async () => {
    render(<Toaster aria-label="Updates" />);
    act(() => {
      toast.success("Saved", { timeout: null });
    }); await settle();
    await settle();
    const region = screen.getByRole("region", { name: "Updates" });
    act(() => {
      fireEvent.keyDown(document, { key: "F6", code: "F6" });
    });
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it("the returned handle's dismiss() removes that toast", async () => {
    render(<Toaster />);
    let handle!: ReturnType<typeof toast.success>;
    act(() => {
      handle = toast.success("Saved");
    });
    await settle();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => {
      handle.dismiss();
    });
    // Sonner keeps a dismissed toast for its 200ms exit transition, then removes it.
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
  });

  it("is dismissible by keyboard: Tab to the close button, then Enter closes it", async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => {
      toast.success("Saved");
    });
    await settle();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close" });
    closeButton.focus();
    expect(closeButton).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
  });

  describe("auto-dismiss timing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-dismisses after its timeout elapses", async () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      }); await settle();
      await settle();
      expect(screen.getByText("Saved")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        vi.advanceTimersByTime(EXIT_MS);
      });
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("does not auto-dismiss before its timeout elapses", async () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      }); await settle();
      await settle();
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("never auto-dismisses when timeout is null", async () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: null });
      }); await settle();
      await settle();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("pauses its timer on hover, and resumes when the pointer leaves", async () => {
      render(<Toaster />);
      act(() => {
        toast.success("Saved", { timeout: 1000 });
      }); await settle();
      await settle();
      // Sonner pauses every timer while the pointer is over its toast list (the `ol` inside the region).
      const toastRegion = screen.getByRole("region", { name: "Notifications" }).querySelector("ol")!;

      // `fireEvent`, not `userEvent.hover`: `userEvent`'s own internal scheduling doesn't mix
      // cleanly with `vi.useFakeTimers()` here. Sonner listens for `mouseenter`/`mouseleave`.
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
      act(() => {
        vi.advanceTimersByTime(EXIT_MS);
      });
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("calls onClose exactly once when a toast auto-dismisses", async () => {
      render(<Toaster />);
      const onClose = vi.fn();
      act(() => {
        toast.success("Saved", { timeout: 1000, onClose });
      }); await settle();
      await settle();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

 it("SEL2 renders the authored action as the library Button and activates it by keyboard", async () => {
  const user=userEvent.setup(); const onPress=vi.fn();
  render(<Toaster aria-label="Updates" />);
  act(() => {toast.success("Removed", {timeout:null, action:{label:"Undo", onPress}})}); await settle(); await settle();
  const action=screen.getByRole("button", {name:"Undo"});
  expect(action).toHaveAttribute("data-toast-part", "action");
  expect(action).toHaveClass("rounded-(--radius-control)");
  action.focus(); await user.keyboard("{Enter}"); expect(onPress).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByText("Removed")).not.toBeInTheDocument());
 });

it("invokes an authored toast action by pointer and retains a disabled action", async () => {
 const user=userEvent.setup(); const onPress=vi.fn();
 render(<Toaster aria-label="Updates" />);
 act(() => { toast("Retry available", {timeout:null, action:{label:"Retry",onPress,isDisabled:true}}); }); await settle();
 await user.click(screen.getByRole("button",{name:"Retry"}));
 expect(onPress).not.toHaveBeenCalled(); expect(screen.getByText("Retry available")).toBeInTheDocument();
 act(() => { toast.dismissAll(); });
 await waitFor(() => expect(screen.queryByText("Retry available")).not.toBeInTheDocument());
 act(() => { toast("Retry available", {timeout:null, action:{label:"Retry",onPress}}); }); await settle();
 await user.click(screen.getByRole("button",{name:"Retry"}));
 expect(onPress).toHaveBeenCalledTimes(1); await waitFor(() => expect(screen.queryByText("Retry available")).not.toBeInTheDocument());
});
