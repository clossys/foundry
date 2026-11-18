import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export interface PreviewViewportProps {
  readonly width: 320 | 768 | 1280;
  readonly theme: "light" | "dark";
  readonly mode: "composition" | "instance";
  readonly title: string;
  readonly children: ReactNode;
}
/** Existing isolated contract-preview root. Width is viewport measurement data; all paint comes from inherited Foundry bindings. */
export function PreviewViewport({ width, theme, mode, title, children, ...unknown }: PreviewViewportProps) {
  if (![320, 768, 1280].includes(width) || !["light", "dark"].includes(theme) || !["composition", "instance"].includes(mode) || !title.trim() || Object.keys(unknown).length) throw new TypeError("Invalid closed preview viewport binding");
  return <PreviewFrame key={theme} width={width} theme={theme} mode={mode} title={title}>{children}</PreviewFrame>;
}

function PreviewFrame({ width, theme, mode, title, children }: PreviewViewportProps) {
  const [frameDocument, setFrameDocument] = useState<Document>();
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!frameDocument) return;
    const measure = () => { const next = frameDocument.documentElement.scrollHeight; if (Number.isFinite(next) && next >= 0) setHeight(next); };
    measure();
    const Observer = frameDocument.defaultView?.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(measure); observer.observe(frameDocument.body);
    return () => observer.disconnect();
  }, [frameDocument, children]);
  // Remove portal children before removing their iframe and destroying its document.
  // The keyed owner also prevents a new theme from reusing the old document or height.
  return <>{frameDocument ? createPortal(children, frameDocument.body) : null}
    <iframe title={title} sandbox="allow-same-origin" className="block border-0"
    style={{ width, height: height ?? (mode === "instance" ? "calc(var(--ui-layout-aside-w)*1.5)" : "var(--ui-layout-aside-w)"), minHeight: mode === "instance" ? "calc(var(--ui-layout-aside-w)*.75)" : undefined }}
    srcDoc={`<!doctype html><html lang="en" data-theme="${theme}"><head></head><body class="m-0 bg-surface-base text-ink-primary"></body></html>`}
    onLoad={event => {
      const frame = event.currentTarget.contentDocument;
      if (!frame) return;
      // Copy exactly the host's current token bindings and compiled utility styles, with no second palette or remote-content input.
      frame.head.querySelectorAll("[data-preview-viewport-style]").forEach(node => node.remove());
      for (const node of event.currentTarget.ownerDocument.querySelectorAll('style, link[rel="stylesheet"]')) {
        const clone = node.cloneNode(true) as Element; clone.setAttribute("data-preview-viewport-style", ""); frame.head.append(clone);
      }
      frame.documentElement.dataset.theme = theme;
      frame.body.className = "m-0 bg-surface-base text-ink-primary";
      setFrameDocument(frame);
    }} />
  </>;
}
