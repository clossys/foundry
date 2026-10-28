// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, useLocale } from "react-aria-components";
import { afterEach, describe, expect, it } from "vitest";
import { createCopyResolver } from "../../../writer/src/index.js";
import type { CopyRef, CopyRegistry } from "../../../writer/src/index.js";
import records from "../../../writer/src/catalog/records/sign-in.json";
import type { RuntimeJson, RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { AuthFrame } from "../frames/AuthFrame.js";
import { bindSignInCopy } from "../runtime/sections/sign-in-copy.js";
import { signInFormInputs, signInFormRenderer } from "../runtime/sections/sign-in-form.js";

afterEach(cleanup);

type Locale = "en" | "ar";
type Config = "sign-in.password" | "sign-in.provider" | "sign-in.verify";
interface LocaleRecords {
  records: { id: string; text?: string; context: string; status: string }[];
  bindings: Record<string, { passageId: string; fields: Record<string, CopyRef> }>;
  skipLink: CopyRef;
}
const catalog = records as unknown as { locales: Record<Locale, LocaleRecords> };
const configs: Config[] = ["sign-in.password", "sign-in.provider", "sign-in.verify"];
const providerIds = ["work-sso"];

/** Only this fixture projects approved statuses. Authored catalog records stay draft. */
function registry(locale: Locale, approved = true): CopyRegistry {
  return {
    id: "sign-in-copy-fixture", locale, revision: "r1",
    source: { kind: "generated", reference: "sign-in-copy-test" },
    entries: catalog.locales[locale].records.filter(row => typeof row.text === "string").map(row => ({
      id: row.id, text: row.text!, context: row.context, status: approved ? "approved" : "draft",
    })),
  };
}

function fixture(config: Config, locale: Locale) {
  const resolver = createCopyResolver(registry(locale), { target: "preview", timeZone: "UTC" });
  const fields = catalog.locales[locale].bindings[`ps.${config}`]!.fields;
  return { fields, resolver, values: bindSignInCopy(config, locale, resolver, fields, providerIds) };
}

function renderInput(config: Config, values: Readonly<Record<string, RuntimeJson>>): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: "sections.sign-in-form", slots: signInFormInputs.slots, members: signInFormInputs.members },
    selection: { leaf: "sections.sign-in-form", members: [config] },
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

function fieldValue(values: Readonly<Record<string, RuntimeJson>>, path: string): unknown {
  let value: unknown = values;
  for (const part of path.split(".")) {
    const collection = part.endsWith("[]");
    value = (value as Record<string, unknown>)[collection ? part.slice(0, -2) : part];
    if (collection) value = (value as unknown[])[0];
  }
  return value;
}

function LocaleWitness() {
  const { locale, direction } = useLocale();
  return <span data-testid="locale-witness" data-locale={locale} data-direction={direction} />;
}

describe.each(configs)("Writer sign-in copy binding: %s", config => {
  it.each<Locale>(["en", "ar"])("resolves every declared string through Writer in %s without changing draft records", locale => {
    const before = structuredClone(records);
    const { values, fields, resolver } = fixture(config, locale);
    expect(Object.keys(fields)).toHaveLength(20);
    for (const [path, ref] of Object.entries(fields)) {
      const result = resolver({ ...ref, locale });
      expect(result, path).toBeDefined();
      expect(result?.servedLocale, path).toBe(locale);
      expect(fieldValue(values, path), path).toBe(result?.text);
    }
    expect(records).toEqual(before);
    expect(catalog.locales[locale].records.every(row => row.status === "draft")).toBe(true);
  });

  it("renders resolved English labels and errors as a disabled, hostless composition", () => {
    const { values } = fixture(config, "en");
    const heading = fieldValue(values, "header.heading") as string;
    const { container } = render(<>{signInFormRenderer.render(renderInput(config, values))}</>);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: fieldValue(values, "credentials.identifierLabel") as string })).toBeDisabled();
    expect(screen.getByLabelText(fieldValue(values, "credentials.passwordLabel") as string)).toBeDisabled();
    expect(screen.getByRole("button", { name: fieldValue(values, "providers[].label") as string })).toBeDisabled();
    expect(screen.getByRole("button", { name: fieldValue(values, "actions.submit") as string })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(fieldValue(values, "error.message") as string);
    expect(container.querySelectorAll('[data-ds-leaf="sections.sign-in-form"]').length).toBeGreaterThan(0);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders Arabic copy through the auth shell under explicit Arabic document direction and React Aria context", () => {
    const { values, resolver } = fixture(config, "ar");
    const skip = resolver({ ...catalog.locales.ar.skipLink, locale: "ar" });
    expect(skip).toBeDefined();
    const { container } = render(
      <div lang="ar" dir="rtl" data-testid="document-locale">
        <I18nProvider locale="ar">
          <AuthFrame skipLabel={skip!.text}>
            <LocaleWitness />
            {signInFormRenderer.render(renderInput(config, values))}
          </AuthFrame>
        </I18nProvider>
      </div>,
    );
    expect(screen.getByTestId("document-locale")).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("locale-witness")).toHaveAttribute("data-direction", "rtl");
    expect(screen.getByTestId("locale-witness")).toHaveAttribute("data-locale", "ar");
    const shell = container.querySelector('[data-ds-leaf="frames.auth-shell"]');
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute("lang", "ar");
    expect(shell).toHaveAttribute("dir", "rtl");
    expect(shell?.closest('[dir="rtl"]')).toBe(shell);
    expect(screen.getByRole("link", { name: skip!.text })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("heading", { name: fieldValue(values, "header.heading") as string })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: fieldValue(values, "providers[].label") as string })).toBeDisabled();
    expect(container.textContent).not.toMatch(/Sign in|Password|Continue|Verification|Please wait|Resend|Unable to/i);
  });
});

describe("sign-in copy binding refusals", () => {
  const setup = () => fixture("sign-in.password", "en");

  it("refuses an unregistered config and undeclared copy paths", () => {
    const { resolver, fields } = setup();
    expect(() => bindSignInCopy("sign-in.reset", "en", resolver, fields, providerIds)).toThrow();
    expect(() => bindSignInCopy("sign-in.password", "en", resolver, { ...fields, "actions.signup": { id: "st.0000000000" } }, providerIds)).toThrow();
  });

  it("refuses missing required copy and inline strings in place of CopyRefs", () => {
    const { resolver, fields } = setup();
    const missing = { ...fields }; delete missing["header.heading"];
    expect(() => bindSignInCopy("sign-in.password", "en", resolver, missing, providerIds)).toThrow();
    const inline = { ...fields, "header.heading": "Inline label" } as unknown as Record<string, CopyRef>;
    expect(() => bindSignInCopy("sign-in.password", "en", resolver, inline, providerIds)).toThrow();
  });

  it("preserves Writer refusals for unknown, draft and unresolved optional copy", () => {
    const { resolver, fields } = setup();
    expect(() => bindSignInCopy("sign-in.password", "en", resolver, { ...fields, "header.heading": { id: "st.0000000000" } }, providerIds)).toThrow();
    const draftResolver = createCopyResolver(registry("en", false), { target: "preview" });
    expect(() => bindSignInCopy("sign-in.password", "en", draftResolver, fields, providerIds)).toThrow();
    expect(() => bindSignInCopy("sign-in.password", "en", resolver, { ...fields, "error.message": { id: "st.0000000000" } }, providerIds)).toThrow();
  });

  it("refuses copy served from a different locale", () => {
    const { resolver, fields } = setup();
    const wrongNative = (ref: CopyRef) => {
      const result = resolver(ref);
      return result && { ...result, servedLocale: "ar", chain: ["en", "ar"] };
    };
    expect(() => bindSignInCopy("sign-in.password", "en", wrongNative, fields, providerIds)).toThrow();
  });
});
