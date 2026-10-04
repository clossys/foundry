// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { FRONT_DOOR_COPY_EN } from "@clossys/writer";
import { SignInForm, ActivateForm, ResetForm, AuthView, BoundaryView } from "./client.js";
import { SignInForm as LegacySignIn } from "./views/SignInForm.js";
import { ActivateForm as LegacyActivate } from "./views/ActivateForm.js";
import { ResetForm as LegacyReset } from "./views/ResetForm.js";
import { RenderError } from "../internal/errors.js";

afterEach(cleanup);
const nouns = { surface: "Example" };
const ok = async () => ({ status: "ok" as const });
const signProps = { identify: ok, verify: ok, onSignedIn: () => { }, nouns };
const activateProps = { activate: ok, onActivated: () => { }, nouns };
const resetProps = { request: ok, reset: ok, onReset: () => { }, nouns };

describe("browser front-door client", () => {
  it("preserves pristine SSR across all forms and direct shells", () => {
    expect(renderToString(<SignInForm {...signProps} />)).toEqual(renderToString(<LegacySignIn {...signProps} />));
    expect(renderToString(<ActivateForm {...activateProps} />)).toEqual(renderToString(<LegacyActivate {...activateProps} />));
    expect(renderToString(<ResetForm {...resetProps} />)).toEqual(renderToString(<LegacyReset {...resetProps} />));
    expect(renderToString(<AuthView brand="Brand" heading="Sign in" description="Continue" form={<SignInForm {...signProps} />} />)).toContain("Sign in");
    expect(renderToString(<BoundaryView brand="Brand" status="404" title="Missing" description="No page" />)).toContain("Missing");
  });
  it.each(["draft", "approval"])("keeps legacy refusal and immutable client isolation under root %s mutation", mode => {
    const entries = FRONT_DOOR_COPY_EN.entries;
    const originals = entries.map(e => ({ ...e }));
    const baseline = [renderToString(<SignInForm {...signProps} />), renderToString(<ActivateForm {...activateProps} />), renderToString(<ResetForm {...resetProps} />)];
    try {
      for (const e of entries) { e.text = "Changed"; if (mode === "draft") e.status = "draft"; else e.approval = {} as never; }
      expect(() => renderToString(<LegacySignIn {...signProps} />)).toThrow(RenderError);
      expect(() => renderToString(<LegacyActivate {...activateProps} />)).toThrow(RenderError);
      expect(() => renderToString(<LegacyReset {...resetProps} />)).toThrow(RenderError);
      expect([renderToString(<SignInForm {...signProps} />), renderToString(<ActivateForm {...activateProps} />), renderToString(<ResetForm {...resetProps} />)]).toEqual(baseline);
    } finally { for (let i = 0; i < entries.length; i++) { delete entries[i]!.approval; Object.assign(entries[i]!, originals[i]); } }
  });
  it("refuses missing nouns with sanitized messages in all client forms", () => {
    for (const element of [<SignInForm {...signProps} nouns={{}} />, <ActivateForm {...activateProps} nouns={{}} />, <ResetForm {...resetProps} nouns={{}} />]) {
      expect(() => renderToString(element)).toThrow(RenderError);
      expect(() => renderToString(element)).not.toThrow(/undefined|object Object/);
    }
  });
  it("keeps module-bound handlers and focus behavior in the browser client", async () => {
    const identify = vi.fn(ok); render(<SignInForm {...signProps} identify={identify} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " visitor@example.test " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const field = await screen.findByLabelText("Password"); expect(identify).toHaveBeenCalledWith("visitor@example.test"); expect(field).toHaveFocus();
  });
});
