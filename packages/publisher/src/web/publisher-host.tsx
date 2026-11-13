import { createElement, type ReactElement, type ReactNode } from "react";
import * as frames from "@clossys/designer/frames";
import type { ConsumerComponentSelection, ShellCopyResolver } from "@clossys/designer/frames";
import type { CopyResolver } from "@clossys/writer";

/** A missing consumer input for the Publisher host. Publisher never supplies a default selection or copy. */
export class PublisherHostNeedError extends Error {
  constructor(readonly need: "component-selection" | "shell-copy", detail: string) {
    super(`NEED ${need === "component-selection" ? "component selection" : "shell copy"}: ${detail}`);
    this.name = "PublisherHostNeedError";
  }
}

export interface PublisherHostProps {
  /** The consumer's compiled component selection (live module index); never a Publisher default. */
  readonly components?: ConsumerComponentSelection;
  /** The consumer's Writer-backed resolver for Designer shell copy. */
  readonly shellCopy?: ShellCopyResolver;
  readonly children?: ReactNode;
}

/**
 * The one Publisher host around Designer frames and sections: the consumer's component
 * selection and its Writer shell copy. Either missing fails loudly with a NEED.
 */
export function PublisherHost({ components, shellCopy, children }: PublisherHostProps): ReactElement {
  if (!components) throw new PublisherHostNeedError("component-selection", "Publisher pages require the consumer's component selection");
  if (!shellCopy) throw new PublisherHostNeedError("shell-copy", "Publisher pages require the consumer's Writer shell copy resolver");
  // Namespace access keeps this module importable under the react-server condition, where
  // Designer exposes no client provider; rendering there still fails loudly.
  const { ConsumerComponentProvider, ShellCopyProvider } = frames as Partial<typeof frames>;
  if (!ConsumerComponentProvider || !ShellCopyProvider) throw new PublisherHostNeedError("component-selection", "Designer client providers are unavailable in this environment");
  return createElement(ConsumerComponentProvider, { value: components, children: createElement(ShellCopyProvider, { resolver: shellCopy, children }) });
}

/** Adapt the consumer's Writer resolver to Designer's shell seam for one served locale. */
export function writerShellCopyResolver(resolver: CopyResolver, locale: string): ShellCopyResolver {
  return reference => {
    const resolved = resolver({ ...reference, locale });
    return resolved && (resolved.servedLocale ?? resolved.locale) === locale ? { ref: reference, text: resolved.text } : undefined;
  };
}
