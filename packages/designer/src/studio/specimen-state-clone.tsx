"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ComponentSpecimenComponent } from "./component-specimens.js";

export type SpecimenInteraction = "hover" | "focus-visible" | "pressed";
const attribute: Record<SpecimenInteraction, string> = { hover: "data-hovered", "focus-visible": "data-focus-visible", pressed: "data-pressed" };

/** Reuse the selected stylesheet's declarations for a captured native state; no presentation is invented. */
function capturedStateCss(document: Document, scope: string): string {
  const visit = (rules: CSSRuleList): string => Array.from(rules).map(rule => {
    if ("selectorText" in rule && "style" in rule) {
      const styled = rule as CSSStyleRule;
      const selector = styled.selectorText.replace(/(?<!\\):hover\b/g, "[data-hovered]").replace(/(?<!\\):focus-visible\b/g, "[data-focus-visible]").replace(/(?<!\\):active\b/g, "[data-pressed]");
      return selector === styled.selectorText ? "" : `${selector.split(",").map(value => `${scope} ${value}`).join(",")}{${styled.style.cssText}}`;
    }
    if ("cssRules" in rule) {
      const nested = visit((rule as CSSGroupingRule).cssRules);
      return nested ? `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}` : "";
    }
    return "";
  }).join("\n");
  return Array.from(document.styleSheets).map(sheet => { try { return visit(sheet.cssRules); } catch { throw new Error("The selected stylesheet is inaccessible for a static state capture."); } }).join("\n");
}

/**
 * Library-private native-state capture: dispatches the peer's real interaction, snapshots its resulting DOM,
 * then removes the live staging instance. The visible clone has no event listeners and is inert. A peer that
 * does not actually expose the requested state refuses; a label or manually added data attribute is no proof.
 */
export function NativeSpecimenStateClone({ Content, state, children, unavailable }: { Content: ComponentSpecimenComponent; state: SpecimenInteraction; children: ReactNode; unavailable: (reason: string) => ReactNode }): ReactNode {
  const source = useRef<HTMLElement>(null), output = useRef<HTMLElement>(null);
  const cloneId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [result, setResult] = useState<"capturing" | "ready" | string>("capturing");
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const staging = source.current, destination = output.current;
      if (!staging || !destination) return;
      const target = staging.querySelector<HTMLElement>('button,input,select,textarea,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="textbox"],[tabindex]');
      if (!target) { setResult("The selected fixture has no native interaction target."); return; }
      const document = target.ownerDocument, view = document.defaultView!, previous = document.activeElement;
      try {
        flushSync(() => {
          if (state === "focus-visible") {
            document.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
            target.focus({ preventScroll: true });
          } else if (typeof view.PointerEvent === "function") {
            target.dispatchEvent(new view.PointerEvent(state === "hover" ? "pointerover" : "pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: state === "pressed" ? 1 : 0 }));
          } else target.dispatchEvent(new view.MouseEvent(state === "hover" ? "mouseover" : "mousedown", { bubbles: true, button: 0, buttons: state === "pressed" ? 1 : 0 }));
        });
        if (!staging.querySelector(`[${attribute[state]}]`)) throw new Error(`The selected fixture did not enter its native ${state} state.`);
        const copy = staging.cloneNode(true) as HTMLElement;
        copy.removeAttribute("aria-hidden"); copy.removeAttribute("class"); copy.removeAttribute("style");
        copy.setAttribute("inert", ""); copy.setAttribute("data-ds-state-clone", cloneId);
        const stylesheet = document.createElement("style");
        stylesheet.textContent = capturedStateCss(document, `[data-ds-state-clone="${cloneId}"]`);
        copy.prepend(stylesheet); destination.replaceChildren(copy);
        if (alive) setResult("ready");
      } catch (error) { if (alive) setResult(error instanceof Error ? error.message : "Native state capture failed."); }
      finally {
        if (state === "focus-visible" && previous instanceof view.HTMLElement) previous.focus({ preventScroll: true });
      }
    }, 0);
    return () => { alive = false; clearTimeout(timer); output.current?.replaceChildren(); };
  }, [Content, state, children, cloneId]);
  return <Content as="div" data-specimen-forced-state={state} data-ds-specimen-capture={result === "ready" ? "ready" : "unavailable"}>
    <Content as="div" ref={output} />
    {result === "capturing" ? <><Content as="div" data-ds-specimen-need="true">{unavailable("Native state capture has not completed.")}</Content><Content as="div" ref={source} className="sr-only" aria-hidden="true">{children}</Content></> : result !== "ready" ? <Content as="div" data-ds-specimen-need="true">{unavailable(result)}</Content> : null}
  </Content>;
}
