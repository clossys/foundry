/**
 * `StyleBinding` -> literal CSS, for the two fields this channel currently
 * resolves: `color` and `background`. `@vespeneventures/compose`'s own
 * `types.ts` documents `StyleBinding` as carrying token ROLE names, never
 * raw values (see its own doc comment) — this file is `./print`'s decision
 * on how a role name resolves to a real value: directly against the
 * shared `internal/tokens.ts`'s `flattenTokens()` output, i.e. a role name
 * IS the exact `@vespeneventures/tokens` custom-property name
 * (`"--color-ink-primary"`, not `"ink-primary"`) — the same map
 * `flattenTokens` itself is keyed by.
 *
 * `StyleBinding.border`, `.typography`, and `.weight` are DELIBERATELY NOT
 * resolved here — `border` would need a width/style this frozen contract
 * has no field for, and `typography`/`weight` name a composite type-scale
 * role this package has no registry mapping for. Resolving `color`/
 * `background` is what this channel's own brief explicitly asks for
 * ("Colours: flatten to literal hex via `flattenTokens()`"); inventing an
 * unfounded mapping for the other three risks the exact failure
 * `internal/tokens.ts`'s own doc comment warns against — "a
 * plausible-looking wrong colour" (or, here, a plausible-looking wrong
 * border/typeface) is worse than leaving a field unhandled and saying so.
 * See this package's README, "Found but not fixed", and this file stays
 * the one place that gap is documented in code.
 */

import type { StyleBinding } from "@vespeneventures/compose";
import { RenderError } from "../../internal/errors.js";

/** The two CSS declarations this channel currently derives from a `StyleBinding` — `color`/`background`, resolved to literal hex, ready to drop straight into an inline `style="..."` attribute. */
export interface ResolvedStyleColors {
  color?: string;
  backgroundColor?: string;
}

/**
 * Looks `role` up in `flat` (an already-`flattenTokens()`-ed map). Throws
 * `RenderError("unknown-style-role", ...)` — never a silent fallback
 * colour — when `role` names no entry, naming `ownerDescription` (e.g. a
 * slot key, or `"<page>"` for `LayoutSpec.background`) and `field`
 * (`"color"`/`"background"`) so the error is actionable.
 */
function resolveRole(
  role: string | undefined,
  field: "color" | "background",
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): string | undefined {
  if (role === undefined) return undefined;
  const value = flat.get(role);
  if (value === undefined) {
    throw new RenderError(
      "unknown-style-role",
      `renderPrintDocument: ${ownerDescription}'s style.${field} names token role "${role}", which is not a ` +
        `property in @vespeneventures/tokens' TOKENS registry (checked after flattening — see the shared ` +
        `internal/tokens.ts's flattenTokens()). A role name here must be the exact token custom-property name, ` +
        `e.g. "--color-ink-primary".`,
    );
  }
  return value;
}

/** Resolves `style.color`/`style.background` (when present) against `flat`. `ownerDescription` names what `style` belongs to, for the thrown error's message. */
export function resolveStyleColors(
  style: StyleBinding | undefined,
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): ResolvedStyleColors {
  if (style === undefined) return {};
  const color = resolveRole(style.color, "color", ownerDescription, flat);
  const backgroundColor = resolveRole(style.background, "background", ownerDescription, flat);
  return {
    ...(color !== undefined ? { color } : {}),
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  };
}
