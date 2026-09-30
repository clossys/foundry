// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { ContactView } from "./ContactView.js";
import type { ContactViewCopy, ContactViewProps } from "./ContactView.js";
import { ContactView as ContactViewServer } from "./ContactView.server.js";
import type { ContactResult } from "../contact/types.js";
import * as webEntry from "../index.js";
import * as webServerEntry from "../server.js";
import { RenderError } from "../../internal/errors.js";

afterEach(cleanup);

// Placeholder markers only: every string is an obviously-fake sentinel, so an
// assertion can tell exactly which copy entry a text node came from.

const ref = (id: string): CopyRef => ({ id });

const COPY_KEYS = [
  "heading",
  "description",
  "topicLabel",
  "topicPlaceholder",
  "nameLabel",
  "emailLabel",
  "phoneLabel",
  "messageLabel",
  "submit",
  "submitting",
  "errorSummary",
  "topicRequired",
  "nameRequired",
  "emailRequired",
  "emailInvalid",
  "messageRequired",
  "sentHeading",
  "sentBody",
  "invalid",
  "rateLimited",
  "unavailable",
] as const satisfies readonly (keyof ContactViewCopy)[];

const COPY = Object.fromEntries(COPY_KEYS.map((key) => [key, ref(`contact.${key}`)])) as unknown as ContactViewCopy;

const TEXTS: Record<string, string> = {
  ...Object.fromEntries(COPY_KEYS.map((key) => [`contact.${key}`, `${key.toUpperCase()}-SENTINEL`])),
  "topic.sales": "SALES-TOPIC-SENTINEL",
  "topic.support": "SUPPORT-TOPIC-SENTINEL",
};

const resolveCopyId: CopyResolver = (copyRef) => {
  const text = TEXTS[copyRef.id];
  return text === undefined
    ? undefined
    : {
        ref: copyRef,
        text,
        recordId: "record",
        revision: "1",
        locale: "en",
        source: { kind: "consumer", reference: "fixture" },
        entryId: copyRef.id,
      };
};

const LEGAL = {
  entity: "ENTITY-SENTINEL",
  links: [{ label: "LINK-ONE-SENTINEL", href: "/one" }],
  linksLabel: "LINKS-NAME-SENTINEL",
};

const TOPICS = [
  { id: "sales", label: ref("topic.sales") },
  { id: "support", label: ref("topic.support") },
];

function props(overrides: Partial<ContactViewProps> = {}): ContactViewProps {
  return {
    brand: <a href="/">BRAND-SENTINEL</a>,
    legal: LEGAL,
    resolveCopyId,
    copy: COPY,
    topics: TOPICS,
    onSubmit: async () => ({ status: "accepted" }),
    ...overrides,
  };
}

function markup(overrides: Partial<ContactViewProps> = {}): string {
  return renderToStaticMarkup(<ContactView {...props(overrides)} />);
}

function dom(overrides: Partial<ContactViewProps> = {}): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup(overrides);
  return host;
}

const user = () => userEvent.setup();

/** Fills every required field except the ones named in `skip`. */
async function fill(u: ReturnType<typeof user>, skip: readonly string[] = []): Promise<void> {
  if (!skip.includes("topic")) {
    await u.click(screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ }));
    await u.click(await screen.findByRole("option", { name: "SUPPORT-TOPIC-SENTINEL" }));
  }
  if (!skip.includes("name")) await u.type(screen.getByRole("textbox", { name: /NAMELABEL-SENTINEL/ }), "Ada Person");
  if (!skip.includes("email")) await u.type(screen.getByRole("textbox", { name: /EMAILLABEL-SENTINEL/ }), "ada@example.com");
  if (!skip.includes("message")) await u.type(screen.getByRole("textbox", { name: /MESSAGELABEL-SENTINEL/ }), "A message.");
}

const submitButton = () => screen.getByRole("button", { name: /SUBMIT-SENTINEL|SUBMITTING-SENTINEL/ });

/** Every `var(` call in `source`, found by balanced parentheses so a nested `var()` in a fallback stays inside its outer call. */
function varCalls(source: string): string[] {
  const calls: string[] = [];
  for (let at = source.indexOf("var("); at !== -1; at = source.indexOf("var(", at + 1)) {
    let depth = 0;
    for (let i = at + 3; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        calls.push(source.slice(at, i + 1));
        break;
      }
    }
  }
  return calls;
}

const RAW_LENGTH = /(^|[\s,(])-?(\d+(\.\d*)?|\.\d+)(px|rem|em|vw|vh|dvh|ch|%)/;

/** True when the fallback of any `var(` call in `source`, however deeply nested, carries a raw length literal. */
function hasRawLengthFallback(source: string): boolean {
  return varCalls(source).some((call) => {
    const commaAt = call.indexOf(",");
    return commaAt !== -1 && RAW_LENGTH.test(call.slice(commaAt + 1, -1));
  });
}

describe("ContactView golden markup", () => {
  it("renders the idle form", () => {
    expect(markup()).toMatchInlineSnapshot(`"<div class="flex min-h-dvh flex-col"><header class="py-sm" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex items-center gap-lg"><a href="/">BRAND-SENTINEL</a></div></div></header><main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-prose-max, none)"><header class="flex flex-col gap-md"><div class="flex flex-wrap items-start justify-between gap-lg"><div class="flex flex-col gap-xs"><h1 class="text-h1 font-display text-ink-primary">HEADING-SENTINEL</h1><p class="text-body text-ink-secondary">DESCRIPTION-SENTINEL</p></div></div></header><div class="rounded-control bg-surface-raised p-lg" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))"><form noValidate="" class="flex flex-col gap-lg"><div class="flex flex-col gap-md"><template></template><div class="flex flex-col gap-xs" data-rac="" data-required="true"><span class="text-body-s text-ink-secondary font-body" id="react-aria-_R_4blH3_">TOPICLABEL-SENTINEL</span><button id="_R_0_-topic" class="flex w-full items-center justify-between gap-sm rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary outline-none disabled:cursor-not-allowed border-line-base" data-rac="" type="button" tabindex="0" data-react-aria-pressable="true" aria-labelledby="react-aria-_R_4blH7_ react-aria-_R_4blH3_" aria-describedby="react-aria-_R_4blH5_ react-aria-_R_4blH6_" aria-haspopup="listbox" aria-expanded="false"><span id="react-aria-_R_4blH7_" class="truncate" data-rac="" data-placeholder="true">TOPICPLACEHOLDER-SENTINEL</span><span aria-hidden="true" class="text-ink-muted">▾</span></button><div style="border:0;clip:rect(0 0 0 0);clip-path:inset(50%);height:1px;margin:-1px;overflow:hidden;padding:0;position:fixed;width:1px;white-space:nowrap;top:0;left:0" aria-hidden="true" data-react-aria-prevent-focus="true" data-a11y-ignore="aria-hidden-focus" data-testid="hidden-select-container"><label><select tabindex="-1" name="topic"><option value="" label=" " selected=""> </option><option value="sales">SALES-TOPIC-SENTINEL</option><option value="support">SUPPORT-TOPIC-SENTINEL</option></select></label></div></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_jlH1_" for="_R_0_-name">NAMELABEL-SENTINEL</label><input id="_R_0_-name" type="text" aria-required="true" autoComplete="name" tabindex="0" aria-labelledby="react-aria-_R_jlH1_" aria-describedby="react-aria-_R_jlH3_ react-aria-_R_jlH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="name" value=""/></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_rlH1_" for="_R_0_-email">EMAILLABEL-SENTINEL</label><input id="_R_0_-email" type="email" aria-required="true" autoComplete="email" tabindex="0" aria-labelledby="react-aria-_R_rlH1_" aria-describedby="react-aria-_R_rlH3_ react-aria-_R_rlH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="email" value=""/></div><div class="flex flex-col gap-xs" data-rac=""><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_13lH1_" for="_R_0_-phone">PHONELABEL-SENTINEL</label><input id="_R_0_-phone" type="tel" autoComplete="tel" tabindex="0" aria-labelledby="react-aria-_R_13lH1_" aria-describedby="react-aria-_R_13lH3_ react-aria-_R_13lH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="phone" value=""/></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_1blH1_" for="_R_0_-message">MESSAGELABEL-SENTINEL</label><textarea id="_R_0_-message" type="text" aria-required="true" name="message" tabindex="0" aria-labelledby="react-aria-_R_1blH1_" aria-describedby="react-aria-_R_1blH3_ react-aria-_R_1blH4_" rows="6" class="resize-y rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac=""></textarea></div><div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden"><input type="text" tabindex="-1" autoComplete="off" name="website" value=""/></div></div><div class="flex items-center gap-sm"><button id="_R_0_-submit" class="inline-flex items-center justify-center gap-sm rounded-control font-body transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed px-md py-sm text-body bg-accent text-ink-on-accent hover:bg-accent-hover" data-rac="" type="submit" tabindex="0" data-react-aria-pressable="true">SUBMIT-SENTINEL</button></div></form></div></main><footer class="text-ink-primary py-lg" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between"><div class="flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start"><nav aria-label="LINKS-NAME-SENTINEL"><ul role="list" class="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end"><li><a href="/one" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-ONE-SENTINEL</a></li></ul></nav><p class="m-0 desktop:whitespace-nowrap">© 2026 ENTITY-SENTINEL</p></div></div></div></footer></div>"`);
  });

  it("has exactly one h1, equal to the heading copy", () => {
    const headings = dom().querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("HEADING-SENTINEL");
  });
});

describe("ContactView topic", () => {
  it("never puts the selected topic's label in the heading or description", async () => {
    render(<ContactView {...props({ initialTopic: "sales" })} />);
    const before = screen.getByRole("heading", { level: 1 }).parentElement!.textContent;
    expect(before).not.toContain("SALES-TOPIC-SENTINEL");
    const u = user();
    await u.click(screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ }));
    await u.click(await screen.findByRole("option", { name: "SUPPORT-TOPIC-SENTINEL" }));
    const header = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(header.textContent).toBe(before);
    expect(header.textContent).not.toContain("SUPPORT-TOPIC-SENTINEL");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("HEADING-SENTINEL");
  });

  it("preselects a known initialTopic and ignores an unknown one", () => {
    render(<ContactView {...props({ initialTopic: "support" })} />);
    expect(screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ })).toHaveTextContent("SUPPORT-TOPIC-SENTINEL");
    cleanup();
    render(<ContactView {...props({ initialTopic: "nonexistent-topic" })} />);
    const trigger = screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ });
    expect(trigger).toHaveTextContent("TOPICPLACEHOLDER-SENTINEL");
    expect(trigger).not.toHaveTextContent("SENTINEL-TOPIC");
    expect(trigger.textContent).not.toContain("TOPIC-SENTINEL");
  });

  it("treats an unknown initialTopic as no topic at all: submitting without choosing one is refused", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    render(<ContactView {...props({ initialTopic: "nonexistent-topic", onSubmit })} />);
    const u = user();
    await fill(u, ["topic"]);
    await u.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("TOPICREQUIRED-SENTINEL", { selector: "a" })).toBeInTheDocument();
  });

  it("requires unique kebab-case topic ids and never echoes an id in the error", () => {
    const attempt = (topics: ContactViewProps["topics"]) => () => markup({ topics });
    const secret = "Not_Kebab-ID-LEAK";
    expect(attempt([{ id: secret, label: ref("topic.sales") }])).toThrow(RenderError);
    expect(attempt([{ id: secret, label: ref("topic.sales") }])).toThrow(/topics\[0\]\.id to be kebab-case/);
    expect(attempt([{ id: secret, label: ref("topic.sales") }])).not.toThrow(/LEAK/);
    expect(attempt([{ id: "", label: ref("topic.sales") }])).toThrow(/kebab-case/);
    expect(attempt([{ id: "sales", label: ref("topic.sales") }, { id: "sales", label: ref("topic.support") }])).toThrow(/topics\[1\]\.id to be unique/);
    expect(attempt([{ id: "sales", label: ref("topic.sales") }, { id: "sales", label: ref("topic.support") }])).not.toThrow(/LEAK/);
    expect(attempt([])).toThrow(/at least one topic/);
    expect(attempt(TOPICS)).not.toThrow();
  });

  it("refuses a honeypot name that collides with a declared field", () => {
    expect(() => markup({ honeypotField: "email" })).toThrow(RenderError);
    expect(() => markup({ honeypotField: "1bad" })).toThrow(RenderError);
    expect(() => markup({ honeypotField: "url" })).not.toThrow();
  });
});

describe("ContactView honeypot", () => {
  it("is out of the tab order, autocomplete off, and inside an aria-hidden wrapper", () => {
    const input = dom().querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(input).not.toBeNull();
    expect(input.getAttribute("tabindex")).toBe("-1");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the configured name", () => {
    const root = dom({ honeypotField: "url" });
    expect(root.querySelector('input[name="url"]')).not.toBeNull();
    expect(root.querySelector('input[name="website"]')).toBeNull();
  });

  it("carries its value to onSubmit under its own name", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    const { container } = render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.type(container.querySelector<HTMLInputElement>('input[name="website"]')!, "bot-value");
    await u.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      topic: "support",
      name: "Ada Person",
      email: "ada@example.com",
      phone: "",
      message: "A message.",
      website: "bot-value",
    });
  });
});

describe("ContactView client validation", () => {
  it("does not call onSubmit and focuses the first invalid field", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await u.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ })).toHaveFocus());
    expect(screen.getByText("TOPICREQUIRED-SENTINEL", { selector: "a" })).toBeInTheDocument();
    expect(screen.getByText("ERRORSUMMARY-SENTINEL")).toBeInTheDocument();
  });

  it("focuses a later invalid field when the earlier ones are filled", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u, ["email"]);
    await u.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("textbox", { name: /EMAILLABEL-SENTINEL/ })).toHaveFocus());
  });

  it("rejects an email with no domain part with its own message", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u, ["email"]);
    await u.type(screen.getByRole("textbox", { name: /EMAILLABEL-SENTINEL/ }), "not-an-email");
    await u.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("EMAILINVALID-SENTINEL", { selector: "a" })).toBeInTheDocument();
  });

  it("does not require the phone", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe("ContactView results", () => {
  it("shows a role=status confirmation in place of the form and focuses its heading on accepted", async () => {
    const { container } = render(<ContactView {...props()} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    const heading = await screen.findByRole("heading", { name: "SENTHEADING-SENTINEL" });
    expect(heading.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText("SENTBODY-SENTINEL")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it.each([
    ["rate-limited", "RATELIMITED-SENTINEL"],
    ["unavailable", "UNAVAILABLE-SENTINEL"],
    ["invalid", "INVALID-SENTINEL"],
  ] as const)("shows a role=alert, focuses submit and keeps every value on %s", async (status, sentinel) => {
    const result: ContactResult =
      status === "invalid" ? { status, fields: [{ field: "email", code: "malformed" }] } : { status };
    const { container } = render(<ContactView {...props({ onSubmit: async () => result })} />);
    const u = user();
    await fill(u);
    await u.type(screen.getByRole("textbox", { name: /PHONELABEL-SENTINEL/ }), "555 0100");
    await u.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(sentinel);
    await waitFor(() => expect(submitButton()).toHaveFocus());
    expect(screen.getByRole("textbox", { name: /NAMELABEL-SENTINEL/ })).toHaveValue("Ada Person");
    expect(screen.getByRole("textbox", { name: /EMAILLABEL-SENTINEL/ })).toHaveValue("ada@example.com");
    expect(screen.getByRole("textbox", { name: /PHONELABEL-SENTINEL/ })).toHaveValue("555 0100");
    expect(screen.getByRole("textbox", { name: /MESSAGELABEL-SENTINEL/ })).toHaveValue("A message.");
    expect(screen.getByRole("button", { name: /TOPICLABEL-SENTINEL/ })).toHaveTextContent("SUPPORT-TOPIC-SENTINEL");
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("returns focus to the submit button even when focus moved while sending", async () => {
    let finish: (result: ContactResult) => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<ContactResult>((resolve) => (finish = resolve)));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await u.click(screen.getByRole("textbox", { name: /NAMELABEL-SENTINEL/ }));
    expect(screen.getByRole("textbox", { name: /NAMELABEL-SENTINEL/ })).toHaveFocus();
    finish({ status: "unavailable" });
    await screen.findByRole("alert");
    await waitFor(() => expect(submitButton()).toHaveFocus());
  });

  it("reads a rejected onSubmit as unavailable", async () => {
    render(
      <ContactView
        {...props({
          onSubmit: async () => {
            throw new Error("boom");
          },
        })}
      />,
    );
    const u = user();
    await fill(u);
    await u.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("UNAVAILABLE-SENTINEL");
  });

  it("can send again after a failure", async () => {
    const results: ContactResult[] = [{ status: "unavailable" }, { status: "accepted" }];
    const onSubmit = vi.fn(async () => results.shift()!);
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    await screen.findByRole("alert");
    await u.click(submitButton());
    expect(await screen.findByRole("heading", { name: "SENTHEADING-SENTINEL" })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("ContactView sending", () => {
  it("makes the submit button pending, never disabled", async () => {
    let finish: (result: ContactResult) => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<ContactResult>((resolve) => (finish = resolve)));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /SUBMITTING-SENTINEL/ })).toBeInTheDocument());
    const button = screen.getByRole("button", { name: /SUBMITTING-SENTINEL/ });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.closest("form")).toHaveAttribute("aria-busy", "true");
    finish({ status: "accepted" });
    await screen.findByRole("heading", { name: "SENTHEADING-SENTINEL" });
  });
});

describe("ContactView copy", () => {
  it("renders only words that come from copy, topics, brand and legal", () => {
    const root = dom();
    const words = (root.textContent ?? "").replace(/[A-Z0-9-]*SENTINEL/g, "").replace(/[^A-Za-z]/g, "");
    // Anything left is a word the view supplied itself, other than the © line's year.
    expect(words).toBe("");
  });

  it("throws naming the path, never the id, when a ref does not resolve", () => {
    const attempt = () => markup({ copy: { ...COPY, submit: ref("contact.LEAKED-ID") } });
    expect(attempt).toThrow(RenderError);
    expect(attempt).toThrow(/copy\.submit/);
    expect(attempt).not.toThrow(/LEAKED-ID/);
    expect(() => markup({ topics: [{ id: "sales", label: ref("topic.LEAKED-ID") }] })).toThrow(/topics\[0\]\.label/);
    expect(() => markup({ topics: [{ id: "sales", label: ref("topic.LEAKED-ID") }] })).not.toThrow(/LEAKED-ID/);
    const missing = { ...COPY } as Partial<ContactViewCopy>;
    delete missing.heading;
    expect(() => markup({ copy: missing as ContactViewCopy })).toThrow(/copy\.heading/);
  });
});

describe("ContactView chrome", () => {
  it("gives header and footer no background, border or width cap", () => {
    const root = dom();
    for (const chrome of [root.querySelector("header")!, root.querySelector("footer")!]) {
      const nodes = [chrome, ...chrome.querySelectorAll("*")];
      for (const node of nodes) {
        expect(node.getAttribute("class") ?? "").not.toMatch(/(^|\s)(bg-|border|max-w)/);
        expect((node.getAttribute("style") ?? "").toLowerCase()).not.toContain("max-width");
      }
    }
  });

  it("has one banner, one main and one contentinfo landmark, with the brand alone in the banner", () => {
    const root = dom();
    // PageHeader's own <header> sits inside <main> and is not a banner.
    const landmarks = [...root.firstElementChild!.children].map((child) => child.tagName);
    expect(landmarks).toEqual(["HEADER", "MAIN", "FOOTER"]);
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelector("header")!.textContent).toBe("BRAND-SENTINEL");
  });

  it("carries no raw length in a var() fallback", () => {
    const source = readFileSync(join(import.meta.dirname, "ContactView.tsx"), "utf8");
    expect(hasRawLengthFallback(source)).toBe(false);
    expect(hasRawLengthFallback(dom().querySelector("main")!.getAttribute("style") ?? "")).toBe(false);
    expect(source).toContain('"var(--ui-width-prose-max, none)"');
    expect(hasRawLengthFallback("var(--ui-width-prose-max, 48rem)")).toBe(true);
    expect(hasRawLengthFallback("var(--a, var(--b, .5rem))")).toBe(true);
  });

  it("is not a client module", () => {
    const source = readFileSync(join(import.meta.dirname, "ContactView.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});

describe("ContactView entries", () => {
  it("is exported from both web entries", () => {
    expect(typeof webEntry.ContactView).toBe("function");
    expect(typeof webServerEntry.ContactView).toBe("function");
    expect(webEntry.ContactView).toBe(ContactView);
  });

  it("has a react-server stub that throws a fixed RenderError and imports no react-aria", () => {
    const render = () => ContactViewServer(props());
    expect(render).toThrow(RenderError);
    expect(render).toThrow(/client component/);
    const source = readFileSync(join(import.meta.dirname, "ContactView.server.tsx"), "utf8");
    expect(source).not.toMatch(/react-aria|@clossys\/designer/);
  });
});
