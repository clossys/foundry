// @vitest-environment jsdom
import "../../../vitest.setup.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./Chat.js";
import type { ChatMessage } from "./types.js";

const messages: ChatMessage[] = [
  { id: "u1", role: "user", content: "A question", timestamp: "09:30" },
  { id: "u2", role: "user", content: "More context" },
  { id: "a1", role: "assistant", content: "An answer" },
];
const defaults = { messages, status: "idle" as const, onSend: vi.fn() };
afterEach(() => vi.restoreAllMocks());

describe("Chat", () => {
  it("a: polite author groups retain role labels and optional timestamps (mutant: ungrouped silent log)", () => {
    render(<Chat {...defaults} />);
    const log = screen.getByRole("log", { name: "Conversation messages" });
    expect(log).toHaveAttribute("aria-live", "polite");
    const groups = within(log).getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName("You");
    expect(groups[1]).toHaveAccessibleName("Assistant");
    expect(groups[0]).toHaveTextContent("A question");
    expect(groups[0]).toHaveTextContent("More context");
    expect(within(groups[0]).getByRole("img", { name: "You" })).toBeInTheDocument();
    expect(within(groups[1]).getByRole("img", { name: "Assistant" })).toBeInTheDocument();
    expect(log.querySelectorAll("time")).toHaveLength(1);
    expect(log.querySelector("time")).toHaveTextContent("09:30");
  });

  it("b: composer grows, sends trimmed text, preserves newline and composition, and stops (mutant: unconditional Enter)", async () => {
    const onSend = vi.fn(), onStop = vi.fn();
    const view = render(<Chat {...defaults} onSend={onSend} onStop={onStop} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input.tagName).toBe("TEXTAREA");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 160 });
    await userEvent.type(input, "  Hello");
    expect(input.style.height).toBe("160px");
    expect(input).toHaveClass("max-h-6xl", "overflow-y-auto");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}world");
    expect(input).toHaveValue("  Hello\nworld");
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Hello\nworld");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    view.rerender(<Chat {...defaults} status="streaming" onSend={onSend} onStop={onStop} />);
    await userEvent.type(input, "Next");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.keyboard("{Enter}{Escape}");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("c: status keeps one reserved progress row and provides retry (mutant: removed status region)", async () => {
    const onRetry = vi.fn();
    const view = render(<Chat {...defaults} onRetry={onRetry} />);
    const progress = screen.getByRole("status");
    expect(progress.style.minHeight).toBe("var(--ui-density-row, var(--spacing-3xl, 48px))");
    expect(progress).toBeEmptyDOMElement();
    view.rerender(<Chat {...defaults} status="streaming" onRetry={onRetry} />);
    expect(screen.getByRole("status")).toBe(progress);
    expect(progress).toHaveTextContent("Assistant is responding…");
    view.rerender(<Chat {...defaults} status="error" onRetry={onRetry} />);
    expect(screen.getByRole("status")).toBe(progress);
    expect(progress).toHaveTextContent("Response interrupted.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("d: optional message actions use named icon controls and focus tooltips (mutant: actions omitted)", async () => {
    const onCopy = vi.fn(), onRegenerate = vi.fn(), onFeedback = vi.fn();
    const view = render(<Chat {...defaults} />);
    expect(screen.queryByRole("button", { name: "Copy message" })).not.toBeInTheDocument();
    view.rerender(<Chat {...defaults} actions={{ onCopy, onRegenerate, onFeedback }} />);
    const copy = screen.getAllByRole("button", { name: "Copy message" });
    expect(copy).toHaveLength(3);
    await userEvent.click(copy[2]);
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(messages[2]);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate response" }));
    expect(onRegenerate).toHaveBeenCalledExactlyOnceWith(messages[2]);
    await userEvent.click(screen.getByRole("button", { name: "Helpful response" }));
    await userEvent.click(screen.getByRole("button", { name: "Unhelpful response" }));
    expect(onFeedback.mock.calls).toEqual([[messages[2], "up"], [messages[2], "down"]]);
    const helpful = screen.getByRole("button", { name: "Helpful response" });
    expect(helpful.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.tab({ shift: true });
    expect(helpful).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Helpful response");
  });

  it("e: safe content supports paragraphs, lists, code copy, rel links and the render slot (mutant: raw/plain-only content)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const content = "First `inline`.\n\n- One\n- Two\n\n1. Ordered\n2. Next\n\n```txt\nconst answer = 1;\n```\n\n[Guide](https://example.com/guide)\n\n[Unsafe](javascript:alert)\n\n[Backslash](/\\evil.example)\n\n<img src=x onerror=alert(1)>";
    const message: ChatMessage = { id: "safe", role: "assistant", content };
    const view = render(<Chat {...defaults} messages={[message]} />);
    const log = screen.getByRole("log");
    expect(log.querySelector("p code")).toHaveTextContent("inline");
    expect(log.querySelectorAll("ul li")).toHaveLength(2);
    expect(log.querySelectorAll("ol li")).toHaveLength(2);
    expect(log.querySelector("pre code")).toHaveTextContent("const answer = 1;");
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("const answer = 1;");
    expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Backslash" })).not.toBeInTheDocument();
    expect(log.querySelector("img")).toBeNull();
    expect(log).toHaveTextContent("<img src=x onerror=alert(1)>");
    const renderContent = vi.fn((item: ChatMessage, fallback: ReactNode) => <div aria-label="Custom content">{item.id}{fallback}</div>);
    view.rerender(<Chat {...defaults} messages={[message]} renderContent={renderContent} />);
    expect(renderContent).toHaveBeenCalled();
    expect(screen.getByLabelText("Custom content")).toHaveTextContent("safe");
    expect(screen.getByLabelText("Custom content").querySelector("pre")).not.toBeNull();
  });

  it("f: empty suggestions call the host without sending (mutant: suggestion sends)", async () => {
    const onSuggest = vi.fn(), onSend = vi.fn();
    render(<Chat {...defaults} messages={[]} suggestions={["Summarize this", "Help me start"]} onSuggest={onSuggest} onSend={onSend} />);
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Help me start" }));
    expect(onSuggest).toHaveBeenCalledExactlyOnceWith("Help me start");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("g: streaming follows bottom, respects reading position and offers jump (mutant: force-scroll)", async () => {
    const view = render(<Chat {...defaults} />);
    const log = screen.getByRole("log");
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    log.scrollTop = 800;
    fireEvent.scroll(log);
    const updated = [...messages, { id: "a2", role: "assistant" as const, content: "New text" }];
    view.rerender(<Chat {...defaults} messages={updated} status="streaming" />);
    expect(log.scrollTop).toBe(1000);
    log.scrollTop = 100;
    fireEvent.scroll(log);
    view.rerender(<Chat {...defaults} messages={updated.map(x => x.id === "a2" ? { ...x, content: "New text continues" } : x)} status="streaming" />);
    expect(log.scrollTop).toBe(100);
    const input = screen.getByRole("textbox");
    input.focus();
    const jump = screen.getByRole("button", { name: "Jump to latest" });
    await userEvent.click(jump);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it.each(["light", "dark"])("h: %s uses narrow-safe token layout and keyboard order (mutant: fixed-width/focus loss)", async theme => {
    const onSend = vi.fn();
    const view = render(<div data-theme={theme} style={{ width: 320 }}><Chat {...defaults} messages={[]} onSend={onSend} label="Notes" placeholder="Write a message" /></div>);
    const region = screen.getByRole("region", { name: "Notes" });
    expect(region).toHaveClass("min-w-0", "w-full", "bg-surface-base", "text-ink-primary");
    expect(screen.getByRole("log")).toHaveClass("min-w-0", "overflow-y-auto", "break-words");
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input).toHaveAttribute("placeholder", "Write a message");
    expect(input).toHaveClass("max-h-6xl");
    expect(screen.getByRole("status").style.minHeight).toBe("var(--ui-density-row, var(--spacing-3xl, 48px))");
    const css = readFileSync(resolve(import.meta.dirname, "../../../styles/compiled.css"), "utf8");
    const renderedClasses = new Set(Array.from(view.container.querySelectorAll("[class]")).flatMap(element => Array.from(element.classList)));
    const missing = [...renderedClasses].filter(className => !css.includes(`.${className.replace(/([^a-zA-Z0-9_-])/g, "\\$1")}`));
    expect(missing).toEqual([]);
    await userEvent.tab();
    expect(input).toHaveFocus();
    await userEvent.type(input, "Next");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Send" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Next");
    expect(input).toHaveFocus();
    expect(view.container.querySelector('[tabindex="-1"]')).toBeNull();
  });

  it("passes host copy overrides directly to every owned control and status", async () => {
    const labels = { logLabel: "History", userLabel: "Writer", assistantLabel: "Reader", actionGroupLabel: "Tools", copyMessageLabel: "Keep text", regenerateLabel: "Again", helpfulLabel: "Good", unhelpfulLabel: "Bad", emptyLabel: "Begin here", jumpLabel: "Latest", streamingLabel: "Working", errorLabel: "Interrupted", retryLabel: "Resume", composerLabel: "Draft", stopLabel: "Cancel", sendLabel: "Submit", copyCodeLabel: "Keep code", copiedLabel: "Kept", copyUnavailableLabel: "Cannot copy" };
    const writeText = vi.fn().mockRejectedValue(new Error("Unavailable"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<Chat {...defaults} messages={[]} labels={labels} />);
    expect(screen.getByRole("log", { name: "History" })).toBeInTheDocument();
    expect(screen.getByText("Begin here")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    view.rerender(<Chat {...defaults} messages={[{ id: "code", role: "assistant", content: "```\ntext\n```" }]} labels={labels} status="streaming" onStop={vi.fn()} actions={{ onCopy: vi.fn(), onRegenerate: vi.fn(), onFeedback: vi.fn() }} />);
    expect(screen.getByRole("group", { name: "Reader" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tools" })).toBeInTheDocument();
    for (const name of ["Keep text", "Again", "Good", "Bad", "Cancel"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep code" }));
    expect(await screen.findByText("Cannot copy")).toBeInTheDocument();
    writeText.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Keep code" }));
    expect(await screen.findByText("Kept")).toBeInTheDocument();
    view.rerender(<Chat {...defaults} labels={labels} status="error" onRetry={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Writer" })).toBeInTheDocument();
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});
