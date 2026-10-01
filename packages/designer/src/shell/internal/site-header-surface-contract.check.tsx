/**
 * Compile-time proof that `SiteHeaderProps["surfaceLabel"]` (`../SiteHeader.tsx`)
 * is text only: a staff or demo host names its surface with a plain string, so
 * no link, button or icon can be passed and the badge is never interactive.
 *
 * This is a `*.check.tsx` file rather than part of the runtime tests, because
 * `tsc` excludes `*.test.tsx` and a `@ts-expect-error` there asserts nothing
 * (see `shell-contract.check.tsx` for the full reasoning and the gate that
 * enforces it).
 */
import { SiteHeader } from "../SiteHeader.js";

export const surfaceLabelAcceptsText = <SiteHeader brand="Acme" surfaceLabel="admin" />;

// @ts-expect-error surfaceLabel is text only
export const surfaceLabelRejectsElements = <SiteHeader brand="Acme" surfaceLabel={<a href="/x">admin</a>} />;
