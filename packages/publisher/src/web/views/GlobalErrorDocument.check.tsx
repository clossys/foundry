/**
 * Compile-time-only assertions about `GlobalErrorDocument`'s two prop shapes.
 * Named `.check.tsx` rather than `.test.tsx` on purpose: this package's
 * tsconfig excludes test files from the real `tsc` run, so a
 * `@ts-expect-error` inside one asserts nothing. Nothing imports this file at
 * runtime.
 */
import type { CopyResolver } from "@clossys/writer";
import type { SiteShellInput } from "../frame/types.js";
import type { AssetResolver } from "../types.js";
import { GlobalErrorDocument } from "./GlobalErrorDocument.js";

declare const resolveCopy: CopyResolver;
declare const resolveAsset: AssetResolver;
declare const shell: SiteShellInput;

const head = {
  lang: "en",
  documentTitle: { page: "Something went wrong", brand: "Example Studio" },
  icon: { href: "/icon.svg" },
} as const;

// The framed shape: SiteFrame plus StatusView props.
export const framed = (
  <GlobalErrorDocument
    {...head}
    shell={shell}
    resolveCopy={resolveCopy}
    resolveAsset={resolveAsset}
    status="500"
    subtitle="Something went wrong. Error: 8f2a91c0."
    action={<button type="button">Try again</button>}
    notes={<a href="/contact">Contact us</a>}
  />
);

// The deprecated ErrorView shape still compiles for one release.
export const errorViewShape = <GlobalErrorDocument {...head} status={500} title="Something went wrong" />;

// The two shapes do not mix: `title` belongs to the ErrorView shape.
// @ts-expect-error title is not a framed prop
export const framedWithTitle = <GlobalErrorDocument {...head} shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset} status="500" title="x" />;

// `subtitle` belongs to the framed shape.
// @ts-expect-error subtitle needs shell
export const errorViewWithSubtitle = <GlobalErrorDocument {...head} status={500} title="Something went wrong" subtitle="x" />;

// The framed shape needs both resolvers.
// @ts-expect-error resolveAsset is required with shell
export const framedWithoutAsset = <GlobalErrorDocument {...head} shell={shell} resolveCopy={resolveCopy} status="500" />;
