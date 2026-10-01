// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
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
  "failureLabel",
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
  // The legal line reads the clock for its year; freeze only Date so user-event's timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the idle form", () => {
    // React Aria stamps its hidden native select with an opaque tooling attribute; the snapshot pins this view's markup, not that one.
    expect(markup().replace(/ data-[a-z0-9]+-ignore="[^"]*"/g, "")).toMatchInlineSnapshot(`"<div class="flex min-h-dvh flex-col"><header class="py-sm" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex items-center gap-lg"><a href="/">BRAND-SENTINEL</a></div></div></header><main class="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style="max-width:var(--ui-width-prose-max, none)"><header class="flex flex-col gap-md"><div class="flex flex-wrap items-start justify-between gap-lg"><div class="flex flex-col gap-xs"><h1 class="text-h1 font-display text-ink-primary">HEADING-SENTINEL</h1><p class="text-body text-ink-secondary">DESCRIPTION-SENTINEL</p></div></div></header><div class="rounded-control bg-surface-raised p-lg" style="box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))"><form noValidate="" class="flex flex-col gap-lg"><div class="flex flex-col gap-md"><template></template><div class="flex flex-col gap-xs" data-rac="" data-required="true"><span class="text-body-s text-ink-secondary font-body" id="react-aria-_R_4blH3_">TOPICLABEL-SENTINEL</span><button id="_R_0_-topic" class="flex w-full items-center justify-between gap-sm rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary outline-none disabled:cursor-not-allowed border-line-base" data-rac="" type="button" tabindex="0" data-react-aria-pressable="true" aria-labelledby="react-aria-_R_4blH7_ react-aria-_R_4blH3_" aria-describedby="react-aria-_R_4blH5_ react-aria-_R_4blH6_" aria-haspopup="listbox" aria-expanded="false"><span id="react-aria-_R_4blH7_" class="truncate" data-rac="" data-placeholder="true">TOPICPLACEHOLDER-SENTINEL</span><span aria-hidden="true" class="text-ink-muted">▾</span></button><div style="border:0;clip:rect(0 0 0 0);clip-path:inset(50%);height:1px;margin:-1px;overflow:hidden;padding:0;position:fixed;width:1px;white-space:nowrap;top:0;left:0" aria-hidden="true" data-react-aria-prevent-focus="true" data-testid="hidden-select-container"><label><select tabindex="-1" name="topic"><option value="" label=" " selected=""> </option><option value="sales">SALES-TOPIC-SENTINEL</option><option value="support">SUPPORT-TOPIC-SENTINEL</option></select></label></div></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_jlH1_" for="_R_0_-name">NAMELABEL-SENTINEL</label><input id="_R_0_-name" type="text" aria-required="true" autoComplete="name" tabindex="0" aria-labelledby="react-aria-_R_jlH1_" aria-describedby="react-aria-_R_jlH3_ react-aria-_R_jlH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="name" value=""/></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_rlH1_" for="_R_0_-email">EMAILLABEL-SENTINEL</label><input id="_R_0_-email" type="email" aria-required="true" autoComplete="email" tabindex="0" aria-labelledby="react-aria-_R_rlH1_" aria-describedby="react-aria-_R_rlH3_ react-aria-_R_rlH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="email" value=""/></div><div class="flex flex-col gap-xs" data-rac=""><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_13lH1_" for="_R_0_-phone">PHONELABEL-SENTINEL</label><input id="_R_0_-phone" type="tel" autoComplete="tel" tabindex="0" aria-labelledby="react-aria-_R_13lH1_" aria-describedby="react-aria-_R_13lH3_ react-aria-_R_13lH4_" class="rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac="" name="phone" value=""/></div><div class="flex flex-col gap-xs" data-rac="" data-required="true"><label class="text-body-s text-ink-secondary font-body" id="react-aria-_R_1blH1_" for="_R_0_-message">MESSAGELABEL-SENTINEL</label><textarea id="_R_0_-message" type="text" aria-required="true" name="message" tabindex="0" aria-labelledby="react-aria-_R_1blH1_" aria-describedby="react-aria-_R_1blH3_ react-aria-_R_1blH4_" rows="6" class="resize-y rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary border-line-base" data-rac=""></textarea></div><div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden"><input type="text" tabindex="-1" autoComplete="off" name="website" value=""/></div></div><div class="flex items-center gap-sm"><button id="_R_0_-submit" class="inline-flex items-center justify-center gap-sm rounded-control font-body transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed px-md py-sm text-body bg-accent text-ink-on-accent hover:bg-accent-hover" data-rac="" type="submit" tabindex="0" data-react-aria-pressable="true">SUBMIT-SENTINEL</button></div></form></div></main><footer class="text-ink-primary py-lg" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between"><div class="flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start"><nav aria-label="LINKS-NAME-SENTINEL"><ul role="list" class="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end"><li><a href="/one" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-ONE-SENTINEL</a></li></ul></nav><p class="m-0 desktop:whitespace-nowrap">© 2026 ENTITY-SENTINEL</p></div></div></div></footer></div>"`);
  });

  it("has exactly one h1, equal to the heading copy", () => {
    const headings = dom().querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("HEADING-SENTINEL");
  });
});

describe("ContactView header slots", () => {
  const banner = (html: string) => /^<div[^>]*>(<header\b[\s\S]*?<\/header>)<main/.exec(html)?.[1] ?? "";
  const footer = (html: string) => /(<footer\b[\s\S]*<\/footer>)<\/div>$/.exec(html)?.[1] ?? "";

  it("renders headerAction, secondaryAction and nav inside the banner landmark and nowhere else", () => {
    const host = dom({
      headerAction: <a href="/contact">HEADER-ACTION-SENTINEL</a>,
      secondaryAction: <a href="/sign-in">SECONDARY-ACTION-SENTINEL</a>,
      nav: <nav aria-label="Primary">NAV-SENTINEL</nav>,
    });
    const header = host.querySelector(":scope > div > header") as HTMLElement;
    expect(header.querySelector('a[href="/contact"]')).toHaveTextContent("HEADER-ACTION-SENTINEL");
    expect(header.querySelector('a[href="/sign-in"]')).toHaveTextContent("SECONDARY-ACTION-SENTINEL");
    expect(header.querySelector('nav[aria-label="Primary"]')).toHaveTextContent("NAV-SENTINEL");
    expect(header.textContent!.indexOf("SECONDARY-ACTION-SENTINEL")).toBeLessThan(header.textContent!.indexOf("HEADER-ACTION-SENTINEL"));
    expect(host.querySelector("main")).not.toHaveTextContent(/HEADER-ACTION|SECONDARY-ACTION|NAV-SENTINEL/);
    expect(host.querySelector("footer")).not.toHaveTextContent(/HEADER-ACTION|SECONDARY-ACTION|NAV-SENTINEL/);
  });

  it("renders the same transparent header and footer as before when every slot is omitted", () => {
    const html = markup();
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader ground="transparent" brand={<a href="/">BRAND-SENTINEL</a>} />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter ground="transparent" secondary={<SiteFooter.Legal {...LEGAL} />} />));
  });

  it("passes ground to both the header and the footer", () => {
    const html = markup({ ground: "inverse" });
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader ground="inverse" brand={<a href="/">BRAND-SENTINEL</a>} />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter ground="inverse" secondary={<SiteFooter.Legal {...LEGAL} />} />));
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
    const twice = attempt([{ id: "dup-id-leak", label: ref("topic.sales") }, { id: "dup-id-leak", label: ref("topic.support") }]);
    expect(twice).toThrow(/topics\[1\]\.id to be unique/);
    expect(twice).not.toThrow(/leak/i);
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
    // A failure leads with its own text label, so it is not told apart by colour alone.
    expect(alert.firstElementChild?.firstElementChild).toHaveTextContent("FAILURELABEL-SENTINEL");
    expect(alert.firstElementChild?.firstElementChild).toHaveClass("font-semibold");
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

  it("clears a server failure when the next attempt is refused by a client check: one alert only", async () => {
    render(<ContactView {...props({ onSubmit: async () => ({ status: "rate-limited" }) })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("RATELIMITED-SENTINEL");
    await u.clear(screen.getByRole("textbox", { name: /EMAILLABEL-SENTINEL/ }));
    await u.click(submitButton());
    await screen.findByText("EMAILREQUIRED-SENTINEL", { selector: "a" });
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("ERRORSUMMARY-SENTINEL");
    expect(screen.queryByText("RATELIMITED-SENTINEL")).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["an unknown status", { status: "teapot" }],
    ["a non-object", "oops"],
  ])("renders the unavailable failure when onSubmit resolves to %s", async (_label, answer) => {
    render(<ContactView {...props({ onSubmit: (async () => answer) as unknown as ContactViewProps["onSubmit"] })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("UNAVAILABLE-SENTINEL");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("re-announces and refocuses when the same failure comes twice in a row", async () => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "unavailable" }));
    render(<ContactView {...props({ onSubmit })} />);
    const u = user();
    await fill(u);
    await u.click(submitButton());
    const first = await screen.findByRole("alert");
    await waitFor(() => expect(submitButton()).toHaveFocus());
    await u.click(screen.getByRole("textbox", { name: /NAMELABEL-SENTINEL/ }));
    expect(submitButton()).not.toHaveFocus();
    await u.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    await waitFor(() => expect(submitButton()).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("UNAVAILABLE-SENTINEL");
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
  });

  it.each(COPY_KEYS)("fails loudly, naming the path, when the copy key %s is absent", (key) => {
    const missing = { ...COPY } as Partial<ContactViewCopy>;
    delete missing[key];
    expect(() => markup({ copy: missing as ContactViewCopy })).toThrow(new RegExp(`copy\\.${key}\\b`));
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

describe("ContactView devPreview", () => {
  const STATES = [
    ["idle", "SUBMIT-SENTINEL"],
    ["submitting", "SUBMITTING-SENTINEL"],
    ["accepted", "SENTHEADING-SENTINEL"],
    ["invalid", "INVALID-SENTINEL"],
    ["rate-limited", "RATELIMITED-SENTINEL"],
    ["unavailable", "UNAVAILABLE-SENTINEL"],
  ] as const;

  it.each(STATES)("renders the %s state without sending", async (devPreview, sentinel) => {
    const onSubmit = vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" }));
    const html = dom({ devPreview, onSubmit });
    if (devPreview === "accepted") {
      expect(html.querySelector('[role="status"]')).toHaveTextContent(sentinel);
      expect(html.querySelector("form")).toBeNull();
    } else if (devPreview === "invalid" || devPreview === "rate-limited" || devPreview === "unavailable") {
      expect(html.querySelector('[role="alert"]')).toHaveTextContent(sentinel);
      expect(html.querySelector("form")).not.toBeNull();
    } else {
      expect(html.querySelector('[role="alert"]')).toBeNull();
      expect(html.querySelector('[role="status"]')).toBeNull();
      expect(html.querySelector("button[id$=\"-submit\"]")).toHaveTextContent(sentinel);
    }
    // Only the pinned state's text is on the page.
    for (const [other, otherSentinel] of STATES) {
      if (other !== devPreview && other !== "idle" && other !== "submitting") expect(html.textContent).not.toContain(otherSentinel);
    }

    render(<ContactView {...props({ devPreview, onSubmit })} />);
    const form = document.querySelector("form");
    if (form !== null) {
      const u = user();
      await fill(u);
      await u.click(submitButton());
      expect(onSubmit).not.toHaveBeenCalled();
      // The submit changed nothing: still the same pinned state, no error summary, no focus pulled.
      expect(screen.queryByText("ERRORSUMMARY-SENTINEL")).toBeNull();
      expect(screen.getByText(sentinel)).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /MESSAGELABEL-SENTINEL/ })).toHaveValue("A message.");
    } else {
      expect(screen.getByText(sentinel)).toBeInTheDocument();
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the pending button, never disabled, for submitting", () => {
    render(<ContactView {...props({ devPreview: "submitting" })} />);
    const button = submitButton();
    expect(button).toHaveTextContent("SUBMITTING-SENTINEL");
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("does not move focus on its own for a failure or the confirmation", async () => {
    for (const devPreview of ["accepted", "unavailable"] as const) {
      render(<ContactView {...props({ devPreview })} />);
      await Promise.resolve();
      expect(document.body).toHaveFocus();
      cleanup();
    }
  });

  it("is closed: an unknown value throws a RenderError naming devPreview and never the value", () => {
    for (const bogus of ["bogus", "", "ACCEPTED", "__proto__", null, 3, ["accepted"]]) {
      const attempt = () => markup({ devPreview: bogus as never });
      expect(attempt).toThrow(RenderError);
      expect(attempt).toThrow(/devPreview/);
      expect(attempt).not.toThrow(/bogus|ACCEPTED|__proto__/);
    }
  });

  it("leaves the idle markup unchanged when absent", () => {
    expect(markup({ devPreview: undefined })).toBe(markup());
    expect(markup({ devPreview: "idle" })).toBe(markup());
  });

  it("is exported as a type from both entries without adding a runtime export", () => {
    expect(Object.keys(webEntry)).not.toContain("ContactViewDevPreview");
    expect(Object.keys(webServerEntry)).not.toContain("ContactViewDevPreview");
  });
});
