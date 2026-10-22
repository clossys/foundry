/**
 * Compile-time-only assertions about `NotFoundDocument`'s props. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error` inside
 * one asserts nothing. Nothing imports this file at runtime.
 */
import type { CopyResolver } from "@clossys/writer";
import type { SiteShellInput } from "../frame/types.js";
import type { AssetResolver } from "../types.js";
import { NotFoundDocument } from "./NotFoundDocument.js";

declare const resolveCopy: CopyResolver;
declare const resolveAsset: AssetResolver;
declare const shell: SiteShellInput;

const head = {
  lang: "en",
  documentTitle: { page: "Page not found", brand: "Example Studio" },
  icon: { href: "/icon.svg" },
} as const;

const frame = { shell, resolveCopy, resolveAsset };

// The whole shape: head, frame, StatusView props and linked stylesheets.
export const complete = (
  <NotFoundDocument
    {...head}
    {...frame}
    stylesheets={["/site.css"]}
    status="404"
    subtitle="This page does not exist."
    action={<a href="/">Back to home</a>}
    notes={<a href="/contact">Contact us</a>}
    routes={{ label: "Popular pages", items: [{ id: "about", heading: "About", description: "Who we are", href: "/about" }] }}
  />
);

// The frame is required: the document is never unframed.
// @ts-expect-error shell is required
export const withoutShell = <NotFoundDocument {...head} resolveCopy={resolveCopy} resolveAsset={resolveAsset} status="404" />;

// An unmatched address has no diagnostic reference.
// @ts-expect-error reference is not a NotFoundDocument prop
export const withReference = <NotFoundDocument {...head} {...frame} status="404" reference={{ label: "Error", value: "x" }} />;

// The deprecated ErrorView props are refused.
// @ts-expect-error title belongs to the ErrorView shape
export const withTitle = <NotFoundDocument {...head} {...frame} status="404" title="Page not found" />;
