import adapterData from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { shadcnAriaStyleRead } from "./shadcn-aria-style-vars.js";

/** Set for the duration of one synchronous rewrite from its input. */
let styleDefaults = false;
const styleRead = (property: string, fixed: string, hint?: "length"): string =>
  styleDefaults ? shadcnAriaStyleRead(property, fixed, hint) : `(${hint ? `${hint}:` : ""}${property})`;

export interface SourceFile { path: string; content: string }
export interface RewriteIssue { code: "K2" | "K4" | "K7" | "K9"; file: string; value: string; message: string }
export interface RewriteNote { file: string; value: string; message: string }
export interface RewriteResult {
  notes?: readonly RewriteNote[];
  /** Registry input surfaces replaced by their contextual RAC primitive, not a nested field. */
  contextualInputs?: readonly string[];
  transform: "shadcn-aria-rewrite@1" | "shadcn-aria-rewrite@2";
  files: readonly SourceFile[];
  outputSha256: readonly { path: string; sha256: string }[];
  reads: { tokens: readonly string[]; assets: readonly string[]; components: readonly string[] };
  parts: readonly string[];
  issues: readonly RewriteIssue[];
}
export interface RewriteInput {
  item: string; leaf: string; files: readonly SourceFile[]; styles: string;
  /** Registry item -> consumer leaf, including aliases such as input -> text-field. */
  leafByItem: Readonly<Record<string, string>>;
  /** Give each shadcn@aria style variable the style's own value as its fallback. */
  styleDefaults?: boolean;
  /** Component-only v2 adoption; existing v1 receipts retain their exact bytes. */
  transformVersion?: 2;
  /** Private registry dependencies retain their own Button API. */
  retainRegistryButtonProps?: boolean;
}
const FOREIGN_ICON_MODULES = ["lucide-react", "@phosphor-icons/react", "react-icons"];
const FOREIGN_ICONS = new RegExp("^(?:" + FOREIGN_ICON_MODULES.join("|") + ")(?:/|$)");
const adapter = adapterData as {
  bindings: Record<string, { member: string; property: string }>;
  glyphs: Record<string, string>; spacing: Record<string, string>;
  controlSizes: Record<string, string>; controlProperties: Record<string, string>;
  spacingProperties: Record<string, string>; fontSizes: Record<string, string>;
  fieldTypography: Record<string, { member: string; property: string }>;
  sizeLengths: Record<string, { member: string; property: string }>; sizeSteps: Record<string, string>;
};
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
/**
 * The pinned shadcn Button's prop values, as the Foundry Button members they evidence. A source that
 * imports Button is rebound to the consumer's Button leaf, whose entrypoint dispatches only declared
 * members and throws on anything else, so every literal such a source passes is translated with this
 * table. The slot declares one square member and no sized one: each shadcn icon size takes
 * shape.icon-only. `defaultSize` is the pinned Button's own default size.
 */
export const SHADCN_BUTTON_MEMBERS = Object.freeze({
  variant: Object.freeze({ default: "primary", secondary: "secondary", ghost: "ghost", destructive: "danger", outline: "outline" }) as Readonly<Record<string, string>>,
  size: Object.freeze({ default: "md", sm: "sm", lg: "lg" }) as Readonly<Record<string, string>>,
  iconSizes: Object.freeze(["icon", "icon-xs", "icon-sm", "icon-lg"]) as readonly string[],
  iconSize: "icon",
  defaultSize: "default",
});
const buttonMemberNames = new Set(componentSlots.find(slot => slot.id === "components.button")?.contract.members.names ?? []);
/** The declared Button member one shadcn Button prop literal names, or undefined when the slot declares none. */
function buttonMember(axis: "size" | "variant", value: string): { axis: "size" | "shape" | "variant"; value: string } | undefined {
  const member = axis === "variant" ? { axis, value: SHADCN_BUTTON_MEMBERS.variant[value] }
    : SHADCN_BUTTON_MEMBERS.iconSizes.includes(value) ? { axis: "shape" as const, value: "icon-only" }
      : { axis, value: SHADCN_BUTTON_MEMBERS.size[value] };
  return member.value && buttonMemberNames.has(`${member.axis}.${member.value}`) ? member as { axis: "size" | "shape" | "variant"; value: string } : undefined;
}
const BUTTON_SOURCE_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["']@\/(?:components\/ui|registry\/bases\/aria\/ui)\/button["']/;
/** The local name a source binds the registry Button to, when it imports it. */
function rebindsButton(content: string): string | undefined {
  const list = BUTTON_SOURCE_IMPORT.exec(content)?.[1];
  const binding = list?.split(",").map(value => value.trim()).find(value => /^Button(?:\s+as\s+[A-Za-z][A-Za-z0-9]*)?$/.test(value));
  return binding?.split(/\s+as\s+/).at(-1);
}
/** Top-level functions whose props are the rebound Button's own props, with the Button axes each keeps. */
function buttonShapedWrappers(content: string, local: string): Map<string, { start: number; end: number; axes: ("size" | "variant")[] }> {
  const wrappers = new Map<string, { start: number; end: number; axes: ("size" | "variant")[] }>();
  const starts = [...content.matchAll(/^function ([A-Z][A-Za-z0-9]*)\(\{/gm)];
  const props = new RegExp(`^function [A-Za-z0-9]+\\(\\{[^}]*\\}:\\s*(Omit<)?(?:React\\.)?ComponentProps<typeof ${local}>(?:,\\s*((?:"[a-z-]+"\\s*\\|?\\s*)+)>)?`);
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.index ?? content.length;
    const shaped = props.exec(content.slice(start.index, end));
    if (!shaped || start[1] === local || Boolean(shaped[1]) !== Boolean(shaped[2])) return;
    const omitted = [...(shaped[2] ?? "").matchAll(/"([a-z-]+)"/g)].map(match => match[1]!);
    wrappers.set(start[1]!, { start: start.index, end, axes: (["size", "variant"] as const).filter(axis => !omitted.includes(axis)) });
  });
  return wrappers;
}
/** The end (exclusive) of the JSX opening tag starting at `from`, at brace depth zero outside quotes. */
function openingTagEnd(content: string, from: number): number {
  let depth = 0, quote = "";
  for (let index = from; index < content.length; index++) {
    const char = content[index]!;
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return index + 1;
  }
  return content.length;
}
/**
 * One bound Icon call. Icon's accessibility contract is a compile-time union (decorative, or a
 * label), so a call with neither does not typecheck. Upstream glyphs are aria-hidden by default
 * (lucide, and shadcn's IconPlaceholder over it): unnamed calls stay decorative, and an explicit
 * aria-hidden (a prop Icon owns) becomes the same `decorative`; a named call is kept as written.
 */
const iconCall = (asset: string, attributes: string): string => {
  const kept = attributes.trim().replace(/(^|\s)aria-hidden(?:=(?:"true"|\{true\}))?(?=\s|$)\s*/g, "$1").trim();
  const named = /(?:^|\s)(?:decorative|label|aria-label)(?=[\s=]|$)/.test(kept);
  return `<LibraryIcon asset="${asset}"${named ? "" : " decorative"}${kept ? " " + kept : ""} />`;
};
/** One solid focus outline; its width reads the focus variable with the style's ring-3 default. */
const focusOutline = (prefix: string, paint: string): string =>
  ["outline-solid", `outline-${styleRead("--ui-border-focus", "ring-3", "length")}`, "outline-offset-(--ui-focus-offset)", `outline-(${paint})`].map(atom => prefix + atom).join(" ");

/** Exact selected source bindings; unmatched spellings remain findings. */
const selectedBindings: Readonly<Record<string, Readonly<Record<string, { output: string; tokens: readonly string[]; note: string }>>>> = {
  "avatar": {
    "*:data-[slot=avatar]:ring-2": {
      "output": "*:data-[slot=avatar]:ring-(length:--ui-border-rule)",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "data-[size=lg]:size-10": {
      "output": "data-[size=lg]:size-[var(--spacing-3xl)]",
      "tokens": [
        "tokens.spacing.3xl"
      ],
      "note": "Restyle 40.0px to 48px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "group-has-data-[size=lg]/avatar-group:[&>svg]:size-5": {
      "output": "group-has-data-[size=lg]/avatar-group:[&>svg]:size-[var(--spacing-xl)]",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 20.0px to 24px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "group-has-data-[size=lg]/avatar-group:size-10": {
      "output": "group-has-data-[size=lg]/avatar-group:size-[var(--spacing-3xl)]",
      "tokens": [
        "tokens.spacing.3xl"
      ],
      "note": "Restyle 40.0px to 48px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "ring-2": {
      "output": "ring-(length:--ui-border-rule)",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "z-10": {
      "output": "z-(--ui-z-sticky)",
      "tokens": [
        "tokens.z-index.sticky"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    }
  },
  "badge": {
    "h-5": {
      "output": "h-[var(--spacing-xl)]",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 20.0px to 24px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "py-0.5": {
      "output": "py-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "banner": {
    "*:[svg]:translate-y-0.5": {
      "output": "*:[svg]:translate-y-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "gap-0.5": {
      "output": "gap-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "has-data-[slot=alert-action]:pr-18": {
      "output": "has-data-[slot=alert-action]:pr-[var(--spacing-4xl)]",
      "tokens": [
        "tokens.spacing.4xl"
      ],
      "note": "Restyle 72.0px to 64px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "breadcrumbs": {
    "size-5": {
      "output": "size-[var(--spacing-xl)]",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 20.0px to 24px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "button": {
    "active:not-aria-[haspopup]:translate-y-px": {
      "output": "active:not-aria-[haspopup]:translate-y-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve one-hairline press displacement; use existing exact 1px member with explicit geometric read."
    },
    "rounded-[min(var(--radius-md),10px)]": {
      "output": "rounded-(--radius-control)",
      "tokens": [
        "tokens.control-radius.default"
      ],
      "note": "Remove literal 10/12px cap and use the consumer control radius directly; preserves every size/state prefix."
    },
    "rounded-[min(var(--radius-md),12px)]": {
      "output": "rounded-(--radius-control)",
      "tokens": [
        "tokens.control-radius.default"
      ],
      "note": "Remove literal 10/12px cap and use the consumer control radius directly; preserves every size/state prefix."
    },
    "text-[0.8rem]": {
      "output": "text-(length:--text-caption)",
      "tokens": [
        "tokens.caption-size.default"
      ],
      "note": "Restyle 12.8px small control/calendar typography to existing caption 12px; no token value change."
    }
  },
  "calendar": {
    "group-data-[focused=true]/day:z-10": {
      "output": "group-data-[focused=true]/day:z-(--ui-z-sticky)",
      "tokens": [
        "tokens.z-index.sticky"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    },
    "leading-none": {
      "output": "leading-(--leading-heading)",
      "tokens": [
        "tokens.line-height.heading"
      ],
      "note": "Restyle unit line height to existing compact heading line height 1.15; do not alias a font-size-specific 5xl line-height member."
    },
    "text-[0.8rem]": {
      "output": "text-(length:--text-caption)",
      "tokens": [
        "tokens.caption-size.default"
      ],
      "note": "Restyle 12.8px small control/calendar typography to existing caption 12px; no token value change."
    },
    "z-0": {
      "output": "z-(--ui-z-base)",
      "tokens": [
        "tokens.z-index.base"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    },
    "z-10": {
      "output": "z-(--ui-z-sticky)",
      "tokens": [
        "tokens.z-index.sticky"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    },
    "[--cell-size:--spacing(7)]": {
      "output": "[--cell-size:var(--ui-control-h-sm)]",
      "tokens": [
        "tokens.control-size.h-sm"
      ],
      "note": "Restyle28px calendar cell to existing32px small control; local alias remains defined and all references bound."
    }
  },
  "card": {
    "leading-snug": {
      "output": "leading-(--leading-snug)",
      "tokens": [
        "tokens.line-height.snug"
      ],
      "note": "Preserve adopted Tailwind snug value 1.375; expose its existing member through an explicit emit mapping."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    }
  },
  "combo-box": {
    "h-[calc(--spacing(5.25))]": {
      "output": "h-(--spacing-xl)",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 21px chip height to existing xl24px; remove unbound spacing macro."
    },
    "h-px": {
      "output": "h-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    },
    "max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))]": {
      "output": "max-h-[min(calc(var(--spacing-6xl)*2-var(--spacing-2xl)),calc(var(--available-height)-var(--spacing-2xl)))]",
      "tokens": [
        "tokens.spacing.6xl",
        "tokens.spacing.2xl"
      ],
      "note": "Retain RAC available-height clamp; restyle 288/36px constants to 256/32px existing scale."
    },
    "max-h-72": {
      "output": "max-h-[calc(var(--spacing-6xl)*2)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 288.0px to 256px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "min-w-36": {
      "output": "min-w-[var(--spacing-6xl)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 144.0px to 128px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "[&>kbd]:rounded-[calc(var(--radius)-5px)]": {
      "output": "[&>kbd]:rounded-(--radius-subtle)",
      "tokens": [
        "tokens.radius.subtle"
      ],
      "note": "Use actual subtle 2px radius for nested keyboard corners, replacing private-radius-minus-5 geometry."
    },
    "has-[>button]:ml-[-0.3rem]": {
      "output": "has-[>button]:ml-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>button]:mr-[-0.3rem]": {
      "output": "has-[>button]:mr-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>kbd]:ml-[-0.15rem]": {
      "output": "has-[>kbd]:ml-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>kbd]:mr-[-0.15rem]": {
      "output": "has-[>kbd]:mr-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "rounded-[calc(var(--radius)-3px)]": {
      "output": "rounded-(--radius-default)",
      "tokens": [
        "tokens.radius.default"
      ],
      "note": "Use actual adopted default 4px radius for inset control rather than an offset from control radius."
    }
  },
  "dialog": {
    "bg-black/10": {
      "output": "bg-(--color-overlay-scrim)",
      "tokens": [
        "tokens.scrim-color.default"
      ],
      "note": "Use the consumer modal scrim role (existing default40% and mode binding), replacing literal black10%; contrast thresholds stay unchanged."
    },
    "leading-none": {
      "output": "leading-(--leading-heading)",
      "tokens": [
        "tokens.line-height.heading"
      ],
      "note": "Restyle unit line height to existing compact heading line height 1.15; do not alias a font-size-specific 5xl line-height member."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    }
  },
  "keyboard": {
    "h-5": {
      "output": "h-[var(--spacing-xl)]",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 20.0px to 24px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "min-w-5": {
      "output": "min-w-[var(--spacing-xl)]",
      "tokens": [
        "tokens.spacing.xl"
      ],
      "note": "Restyle 20.0px to 24px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "menu": {
    "data-inset:pl-7": {
      "output": "data-inset:pl-[var(--spacing-2xl)]",
      "tokens": [
        "tokens.spacing.2xl"
      ],
      "note": "Restyle 28.0px to 32px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "h-px": {
      "output": "h-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    },
    "max-h-72": {
      "output": "max-h-[calc(var(--spacing-6xl)*2)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 288.0px to 256px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "tracking-widest": {
      "output": "tracking-(--tracking-widest)",
      "tokens": [
        "tokens.letter-spacing.widest"
      ],
      "note": "Preserve adopted Tailwind widest 0.1em; expose existing member through explicit emit."
    }
  },
  "popover": {
    "gap-0.5": {
      "output": "gap-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "w-72": {
      "output": "w-[calc(var(--spacing-6xl)*2)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 288.0px to 256px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "select": {
    "data-[size=sm]:rounded-[min(var(--radius-md),10px)]": {
      "output": "data-[size=sm]:rounded-(--radius-control)",
      "tokens": [
        "tokens.control-radius.default"
      ],
      "note": "Remove literal 10/12px cap and use the consumer control radius directly; preserves every size/state prefix."
    },
    "h-px": {
      "output": "h-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    },
    "min-w-36": {
      "output": "min-w-[var(--spacing-6xl)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 144.0px to 128px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "ring-1": {
      "output": "ring-(length:--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve decorative ring rendering, exact width and variants; never relabel as focus clearance."
    },
    "[&>kbd]:rounded-[calc(var(--radius)-5px)]": {
      "output": "[&>kbd]:rounded-(--radius-subtle)",
      "tokens": [
        "tokens.radius.subtle"
      ],
      "note": "Use actual subtle 2px radius for nested keyboard corners, replacing private-radius-minus-5 geometry."
    },
    "has-[>button]:ml-[-0.3rem]": {
      "output": "has-[>button]:ml-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>button]:mr-[-0.3rem]": {
      "output": "has-[>button]:mr-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>kbd]:ml-[-0.15rem]": {
      "output": "has-[>kbd]:ml-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "has-[>kbd]:mr-[-0.15rem]": {
      "output": "has-[>kbd]:mr-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle -4.8/-2.4px nested control margins to one negative xs spacing unit -4px; preserve selectors."
    },
    "rounded-[calc(var(--radius)-3px)]": {
      "output": "rounded-(--radius-default)",
      "tokens": [
        "tokens.radius.default"
      ],
      "note": "Use actual adopted default 4px radius for inset control rather than an offset from control radius."
    }
  },
  "separator": {
    "[:is(hr)]:h-px": {
      "output": "[:is(hr)]:h-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    },
    "aria-[orientation=horizontal]:h-px": {
      "output": "aria-[orientation=horizontal]:h-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    },
    "aria-[orientation=vertical]:w-px": {
      "output": "aria-[orientation=vertical]:w-(--ui-border-hairline)",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Exact separator rule thickness 1px; permission explicitly recorded."
    }
  },
  "slider": {
    "bg-white": {
      "output": "bg-(--color-surface-raised)",
      "tokens": [
        "tokens.surface-color.raised"
      ],
      "note": "Use selected raised thumb surface in both modes, replacing unconditional white."
    },
    "data-vertical:min-h-40": {
      "output": "data-vertical:min-h-[var(--spacing-6xl)]",
      "tokens": [
        "tokens.spacing.6xl"
      ],
      "note": "Restyle 160.0px to 128px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "switch": {
    "data-[size=default]:h-[18.4px]": {
      "output": "data-[size=default]:h-(--ui-control-switch-thumb)",
      "tokens": [
        "tokens.control-size.switch-thumb"
      ],
      "note": "Use actual existing switch-thumb role 14px instead of source 18.4px."
    },
    "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]": {
      "output": "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-var(--ui-border-rule))]",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Retain percentage travel and exact 2px endpoint edge inset using the existing rule width; explicit edge-geometry read."
    },
    "group-data-[size=default]/switch:data-selected:translate-x-[calc(100%-2px)]": {
      "output": "group-data-[size=default]/switch:data-selected:translate-x-[calc(100%-var(--ui-border-rule))]",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Retain percentage travel and exact 2px endpoint edge inset using the existing rule width; explicit edge-geometry read."
    },
    "group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)]": {
      "output": "group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-var(--ui-border-rule))]",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Retain percentage travel and exact 2px endpoint edge inset using the existing rule width; explicit edge-geometry read."
    },
    "group-data-[size=sm]/switch:data-selected:translate-x-[calc(100%-2px)]": {
      "output": "group-data-[size=sm]/switch:data-selected:translate-x-[calc(100%-var(--ui-border-rule))]",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Retain percentage travel and exact 2px endpoint edge inset using the existing rule width; explicit edge-geometry read."
    }
  },
  "table": {
    "h-10": {
      "output": "h-[var(--spacing-3xl)]",
      "tokens": [
        "tokens.spacing.3xl"
      ],
      "note": "Restyle 40.0px to 48px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "tabs": {
    "group-data-horizontal/tabs:after:bottom-[-5px]": {
      "output": "group-data-horizontal/tabs:after:bottom-[calc(var(--spacing-xs)*-1)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle selected indicator offset -5 to -4px existing spacing."
    },
    "group-data-horizontal/tabs:after:h-0.5": {
      "output": "group-data-horizontal/tabs:after:h-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "group-data-vertical/tabs:after:w-0.5": {
      "output": "group-data-vertical/tabs:after:w-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "h-[calc(100%-1px)]": {
      "output": "h-[calc(100%-var(--ui-border-hairline))]",
      "tokens": [
        "tokens.border-width.hairline"
      ],
      "note": "Preserve relative height minus exact hairline."
    },
    "p-[3px]": {
      "output": "p-(--spacing-xs)",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle3px tabs padding to existing4px xs spacing."
    },
    "py-0.5": {
      "output": "py-[var(--spacing-xs)]",
      "tokens": [
        "tokens.spacing.xs"
      ],
      "note": "Restyle 2.0px to 4px using the existing spacing scale; variants and branch ownership remain exact."
    }
  },
  "toggle-button": {
    "min-w-7": {
      "output": "min-w-[var(--spacing-2xl)]",
      "tokens": [
        "tokens.spacing.2xl"
      ],
      "note": "Restyle 28.0px to 32px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "min-w-9": {
      "output": "min-w-[var(--spacing-2xl)]",
      "tokens": [
        "tokens.spacing.2xl"
      ],
      "note": "Restyle 36.0px to 32px using the existing spacing scale; variants and branch ownership remain exact."
    },
    "rounded-[min(var(--radius-md),12px)]": {
      "output": "rounded-(--radius-control)",
      "tokens": [
        "tokens.control-radius.default"
      ],
      "note": "Remove literal 10/12px cap and use the consumer control radius directly; preserves every size/state prefix."
    },
    "text-[0.8rem]": {
      "output": "text-(length:--text-caption)",
      "tokens": [
        "tokens.caption-size.default"
      ],
      "note": "Restyle 12.8px small control/calendar typography to existing caption 12px; no token value change."
    }
  },
  "toggle-group": {
    "data-[size=sm]:rounded-[min(var(--radius-md),10px)]": {
      "output": "data-[size=sm]:rounded-(--radius-control)",
      "tokens": [
        "tokens.control-radius.default"
      ],
      "note": "Remove literal 10/12px cap and use the consumer control radius directly; preserves every size/state prefix."
    },
    "focus-visible:z-10": {
      "output": "focus-visible:z-(--ui-z-sticky)",
      "tokens": [
        "tokens.z-index.sticky"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    },
    "focus:z-10": {
      "output": "focus:z-(--ui-z-sticky)",
      "tokens": [
        "tokens.z-index.sticky"
      ],
      "note": "Exact existing layer value; new component read only where absent."
    }
  },
  "tooltip": {
    "rounded-[2px]": {
      "output": "rounded-(--radius-subtle)",
      "tokens": [
        "tokens.radius.subtle"
      ],
      "note": "Exact existing subtle radius 2px."
    },
    "translate-y-[calc(-50%-2px)]": {
      "output": "translate-y-[calc(-50%-var(--ui-border-rule))]",
      "tokens": [
        "tokens.border-width.rule"
      ],
      "note": "Preserve tooltip arrow centering and exact2px edge offset using existing rule width; explicit edge-geometry read."
    }
  }
};


/** Colons inside arbitrary selectors and CSS functions are not Tailwind variants. */
function variantParts(value: string): [string, string] {
  let depth = 0, last = -1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "[" || value[i] === "(") depth++;
    if (value[i] === "]" || value[i] === ")") depth--;
    if (value[i] === ":" && depth === 0) last = i;
  }
  return [value.slice(0, last + 1), value.slice(last + 1)];
}

/** Expand only flat @apply rules. Nested rules remain visible as unresolved styles. */
function styleRules(css: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const match of css.matchAll(/\.([a-z][\w-]*)\s*\{([^{}]*)\}/g)) {
    const body = match[2]!.replace(/\/\*[\s\S]*?\*\//g, "");
    const apply = [...body.matchAll(/@apply\s+([^;]+);/g)];
    if (apply.length && !body.replace(/@apply\s+[^;]+;/g, "").trim()) rules.set(match[1]!, apply.map(item => item[1]).join(" "));
  }
  return rules;
}

/** Deterministic source transform. Issues are blockers, never a conformance pass. */
export function rewriteShadcnAria(input: RewriteInput): RewriteResult {
  const previous = styleDefaults;
  styleDefaults = input.styleDefaults === true;
  try {
    return rewriteSource(input);
  } finally {
    styleDefaults = previous;
  }
}

function rewriteSource(input: RewriteInput): RewriteResult {
  if (!/^[a-z][a-z0-9-]*$/.test(input.item) || !/^[a-z][a-z0-9-]*$/.test(input.leaf)) throw new Error("rewrite: invalid item or leaf");
  const paths = new Set<string>();
  for (const file of input.files) {
    if (!/^[a-zA-Z0-9_./-]+\.tsx?$/.test(file.path) || file.path.startsWith("/") || file.path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("rewrite: unsafe source path");
    const target = file.path.includes("/_parts/") ? file.path : `components/${input.leaf}/${file.path.split("/").at(-1)}`;
    if (paths.has(target)) throw new Error("rewrite: duplicate output path");
    paths.add(target);
  }
  const rules = styleRules(input.styles);
  const tokens = new Set<string>(), assets = new Set<string>(), components = new Set<string>(), parts = new Set<string>();
  const issues: RewriteIssue[] = [], notes: RewriteNote[] = [];
  const fieldControl = ["select", "combo-box"].includes(input.leaf);
  const contextualInputs = new Set<string>();
  const allowedTokens = componentSlots.find(slot => slot.id === `components.${input.leaf}`)?.contract.allowedReads.tokens ?? [];
  // Geometry is supplied by the named runtime, independently of consumer design tokens.
  const engineVariables = new Map(input.files.map(file => {
    const code = file.content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    const roots = [...code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']react-aria-components["']/g)].flatMap(match => match[1]!.split(",").map(binding => binding.trim().split(/\s+as\s+/)[0]!));
    return [file.path, new Set([
      ...(roots.some(root => ["Popover", "Tooltip"].includes(root)) ? ["--trigger-width", "--trigger-anchor-point", "--available-height"] : []),
      ...(roots.includes("DisclosurePanel") ? ["--disclosure-panel-height"] : []),
    ])];
  }));
  const add = (code: RewriteIssue["code"], file: string, value: string, message: string): void => { issues.push({ code, file, value, message }); };
  const bind = (name: string): string | undefined => {
    const binding = adapter.bindings[name]; if (!binding) return;
    tokens.add(binding.member); return binding.property;
  };
  // Card children inherit both the base and small-size consumer bindings.
  // A missing definition must leave every private alias unresolved.
  const cardSpacing = input.item === "card" && input.leaf === "card"
    && rules.get("cn-card")?.split(/\s+/).includes("[--card-spacing:--spacing(4)]")
    && rules.get("cn-card")?.split(/\s+/).includes("data-[size=sm]:[--card-spacing:--spacing(3)]");
  const cardFiles = new Set(input.files.filter(file => /["'][^"']*\bcn-card\b/.test(file.content)).map(file => file.path));
  const calendarGeometry = input.item === "calendar" && input.leaf === "calendar"
    && rules.get("cn-calendar")?.split(/\s+/).includes("[--cell-radius:var(--radius-md)]")
    && rules.get("cn-calendar")?.split(/\s+/).includes("[--cell-size:--spacing(7)]");
  const consumerVariables = new Map(input.files.map(file => [file.path, new Set([
    ...(cardSpacing && cardFiles.has(file.path) ? ["--card-spacing"] : []),
    ...(calendarGeometry && /\bcn-calendar\b/.test(file.content) ? ["--cell-radius", "--cell-size"] : []),
    ...(input.leaf === "toggle-group" && file.content.split('"--gap"').length === 2
      && file.content.includes('"--gap": `calc(var(--spacing) * ${spacing})`') ? ["--gap"] : []),
  ])]));
  // Collect explicit timing after style expansion, before adding any defaults.
  // Base timing also applies to state variants; state-specific timing stays scoped.
  let explicitTiming = new Set<string>();
  let expressionTerms: string[] = [];
  let expressionSourceTerms: string[] = [];
  const entryHashes: Readonly<Record<string, string>> = {
    select: "9e662cbcb7177303d243076e86ce6b9c2a4c5c5ccff23350fcaae4bf140f9619",
    combobox: "2253d74226fd60b09503f208fe25d1b59719002dbb8ca1e5c0aaa8fc06acb18b",
  };
  const fieldEntry = fieldControl && ((input.item === "select" && input.leaf === "select") || (input.item === "combobox" && input.leaf === "combo-box"))
    ? input.files.find(file => !file.path.includes("/_parts/") && sha256(file.content) === entryHashes[input.item]) : undefined;
  const inputGroupPart = input.files.find(file => file.path === "components/_parts/input-group/input-group.tsx"
    && sha256(file.content) === "f560ff23727006fc7790bef0f9dee2960e8eb00843f8644e9707f0c65582c9d6");
  const groupTerms = rules.get("cn-input-group")?.split(/\s+/) ?? [];
  const inputGroupOwner = fieldEntry && inputGroupPart && input.leafByItem.input === "text-field" && input.leafByItem.textarea === "text-field"
    && ["has-[[data-slot=input-group-control]:focus-visible]:ring-3", "has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50",
      "has-[[data-slot][aria-invalid=true]]:ring-3", "has-[[data-slot][aria-invalid=true]]:ring-destructive/20"].every(term => groupTerms.includes(term));
  const switchEntry = input.item === "switch" && input.leaf === "switch" ? input.files.find(file => sha256(file.content) === "b276029b57a613e457cdf3264c75cafe60bdf2c9093f564166ced3d66070e1b5") : undefined;
  const switchTerms = rules.get("cn-switch")?.split(/\s+/) ?? [];
  const switchFocusOwner = switchEntry && ["focus-visible:ring-3", "focus-visible:ring-ring/50"].every(term => switchTerms.includes(term));
  // These three static strings are arguments of the same authenticated
  // TabTrigger cn() call: focus outline, selected border, and line indicator.
  const tabsEntry = input.item === "tabs" && input.leaf === "tabs" ? input.files.find(file => sha256(file.content) === "9ab0c37a41594b5bf60751ee05c2c8f9a42cfa1558015607ef154c315afd3954") : undefined;
  // These selected-source restyles are authenticated independently of generic
  // utility rewriting. Changed modules or styles retain their original findings.
  const selectedRestyles: Readonly<Record<string, { leaf: string; hashes: readonly string[] }>> = {
    dialog: { leaf: "dialog", hashes: ["ff8a8e6b372e7eb06c931975d8ac1ea59d9271051ac178a62c95f6acae20bb35", "8bc4da15877b3ac969c84d545fda45d90130d5ab076123641afa950022e2325d"] },
    "dropdown-menu": { leaf: "menu", hashes: ["50a583093755eb29800812b189860b10f3aac3f7d48a3be23abe59c73dbb551d", "dab0795b541e7987375948a544ae678dfbc3608fc44afce3ce45972700a9d9ef"] },
    popover: { leaf: "popover", hashes: ["ff617496f63c49105c177be5c2d21a2e4174a5417c3d675179b21cf98854deea"] },
    accordion: { leaf: "disclosure", hashes: ["1fe5c781263e046e1c897eb6a32a6f9f188963d53b1bef2ea23b8686597949ed"] },
    skeleton: { leaf: "skeleton", hashes: ["8fcbad84e494a75484a0975221fb40f54c4a7d68f79cfc305cb158d1feb1badf"] },
    slider: { leaf: "slider", hashes: ["bc583217a68d71c4e42222d1b1af68691593d73a2ba628aaac28add20e92a6f2"] },
    select: { leaf: "select", hashes: [entryHashes.select!] },
    combobox: { leaf: "combo-box", hashes: [entryHashes.combobox!] },
    tabs: { leaf: "tabs", hashes: ["9ab0c37a41594b5bf60751ee05c2c8f9a42cfa1558015607ef154c315afd3954"] },
  };
  const selectedRestyle = selectedRestyles[input.item];
  const restyleEntry = selectedRestyle?.leaf === input.leaf
    && sha256(input.styles) === "fd9803ec398290c306b377a46a769cad0c7ff024bf6a626993c113cacc20f16e"
    ? input.files.find(file => file.path === `apps/v4/registry/bases/aria/ui/${input.item}.tsx`
      && selectedRestyle.hashes.includes(sha256(file.content))) : undefined;
  const timingTerms = (values: string[], stack: string[] = []): string[] => values.flatMap(value => {
    const [prefix, base] = variantParts(value), rule = rules.get(base);
    return rule && !stack.includes(base) ? timingTerms(rule.split(/\s+/).map(term => prefix + term), [...stack, base]) : [value];
  });
  const timingKeys = (values: string[]): string[] => timingTerms(values).flatMap(term => {
    const [prefix, base] = variantParts(term), kind = /^(duration|ease)-/.exec(base)?.[1];
    return kind ? [`${kind}:${prefix}`] : [];
  });
  // Independent class expressions may be conditional. Do not guess a shared
  // timing default when another expression can override it at equal specificity.
  const fileTiming = new Map(input.files.map(file => [file.path, new Set(
    [...file.content.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)].flatMap(match => timingKeys(match[0].slice(1, -1).split(/\s+/)))
  )]));
  let activeTiming: ReadonlySet<string> | undefined;
  const isolatedTiming = new Set(input.files.filter(file =>
    input.item === "select" && sha256(file.content) === "9e662cbcb7177303d243076e86ce6b9c2a4c5c5ccff23350fcaae4bf140f9619"
    || input.item === "combobox" && sha256(file.content) === "2253d74226fd60b09503f208fe25d1b59719002dbb8ca1e5c0aaa8fc06acb18b"
  ).map(file => file.path));
  const utility = (value: string, file: string, stack: string[] = []): string => {
    const [prefix, base] = variantParts(value);
    if (restyleEntry?.path === file) {
      const ownFocus = !prefix && ["outline-none", "outline-hidden"].includes(base) && (
        ["dialog", "menu", "popover"].includes(input.leaf)
        || input.item === "select" && expressionSourceTerms.join(" ") === "group/select-list max-h-[inherit] overflow-x-hidden overflow-y-auto p-0 outline-hidden"
        || input.item === "combobox" && expressionSourceTerms.join(" ") === "cn-combobox-chip-input min-w-16 flex-1 outline-none"
        || input.item === "tabs" && expressionSourceTerms.join(" ") === "cn-tabs-content flex-1 outline-none");
      if (ownFocus) {
        tokens.add("tokens.focus-outline.width"); tokens.add("tokens.focus-outline.offset"); tokens.add("tokens.focus-color.default");
        notes.push({ file, value, message: "Restyled selected focusable surface: replace outline suppression with its own existing token-bound keyboard outline" });
        return focusOutline("focus-visible:", "--color-focus-ring");
      }
      if (input.item === "accordion" && stack.includes("cn-accordion-content")
        && ["data-open:animate-accordion-down", "data-closed:animate-accordion-up"].includes(value)) {
        const direction = prefix === "data-open:" ? "enter" : "exit";
        tokens.add("tokens.duration.fast"); tokens.add(`tokens.transition-easing.${direction}`);
        notes.push({ file, value, message: "Restyled selected disclosure height animation to the existing reduced-motion-aware fade; the peer retains open/close and intrinsic height ownership" });
        return `${prefix}library-${direction} ${prefix}library-fade`;
      }
      if (input.item === "skeleton" && value === "animate-pulse" && expressionSourceTerms.includes("cn-skeleton")) {
        notes.push({ file, value, message: "Restyled selected loading surface to its static shape and surface; no unbound pulse duration or opacity" });
        return "";
      }
      if (input.item === "slider" && stack.includes("cn-slider-thumb") && ["hover:ring-3", "active:ring-3"].includes(value)) {
        tokens.add("tokens.border-width.rule");
        notes.push({ file, value, message: "Restyled selected decorative thumb ring from 3px to existing 2px rule width; independent keyboard focus remains token bound" });
        return `${prefix}ring-${styleRead("--ui-border-rule", "ring-3", "length")}`;
      }
    }
    if (input.transformVersion === 2) {
      const bindV2 = (member: string, output: string): string => { tokens.add(member); return prefix + output; };
      if (["border-dashed", "border-transparent", "border-inherit", "border-0", "ring-0", "opacity-0", "opacity-100"].includes(base)) return value;
      if (["outline-none", "outline-hidden"].includes(base)) {
        tokens.add("tokens.focus-outline.width"); tokens.add("tokens.focus-outline.offset"); tokens.add("tokens.focus-color.default");
        return focusOutline("focus-visible:", "--color-focus-ring");
      }
      const bindings: Record<string, [string, string]> = {
        "tracking-tight": ["tokens.letter-spacing.meta", "tracking-(--tracking-meta)"],
        "tracking-widest": ["tokens.letter-spacing.label", "tracking-(--tracking-label)"],
        "max-w-sm": ["tokens.content-size.notice", "max-w-(--ui-width-notice-max)"],
        "max-h-72": ["tokens.content-size.notice", "max-h-(--ui-width-notice-max)"],
        "leading-normal": ["tokens.line-height.heading", "leading-(--leading-heading)"],
        "leading-snug": ["tokens.line-height.heading", "leading-(--leading-heading)"],
        "h-px": ["tokens.border-width.hairline", "h-(--ui-border-hairline)"],
        "translate-x-px": ["tokens.border-width.hairline", "translate-x-(--ui-border-hairline)"],
        "-translate-x-px": ["tokens.border-width.hairline", "-translate-x-(--ui-border-hairline)"],
        "w-[2px]": ["tokens.border-width.rule", "w-(--ui-border-rule)"],
        "ring-1": ["tokens.border-width.hairline", "ring-(length:--ui-border-hairline)"],
        "ring-2": ["tokens.border-width.rule", "ring-(length:--ui-border-rule)"],
        "duration-200": ["tokens.duration.default", "duration-(--ui-duration-default)"],
        "duration-150": ["tokens.duration.fast", "duration-(--ui-duration-fast)"],
        "ease-linear": ["tokens.easing.default", "ease-(--ease-default)"],
        "ease-in-out": ["tokens.easing.default", "ease-(--ease-default)"],
        "z-10": ["tokens.z-index.sticky", "z-(--ui-z-sticky)"],
        "z-20": ["tokens.z-index.aside", "z-(--ui-z-aside)"],
        "z-50": ["tokens.z-index.modal", "z-(--ui-z-modal)"],
        "bg-black/10": ["tokens.scrim-color.default", "bg-(--color-overlay-scrim)"],
      };
      if (base === "animate-pulse") { notes.push({ file, value, message: "Restyled loading indicator to its static token-bound shape" }); return ""; }
      if (/^rounded-\[calc\(var\(--radius\)-[35]px\)\]$/.test(base)) return bindV2("tokens.radius.default", "rounded-(--radius-default)");
      const inset = /^(m[lr])-\[-0\.(?:3|15)rem\]$/.exec(base);
      if (inset) return bindV2("tokens.spacing.xs", `-${inset[1]}-(--spacing-xs)`);
      if (base === "pl-7") return bindV2("tokens.spacing.xl", "pl-(--spacing-xl)");
      if (base === "min-w-[96px]") return bindV2("tokens.spacing.6xl", "min-w-(--spacing-6xl)");
      const fixed = bindings[base];
      if (fixed) return bindV2(...fixed);
      if (base === "text-sm/relaxed") { tokens.add("tokens.line-height.heading"); return bindV2("tokens.font-size.sm", "text-(length:--text-sm) leading-(--leading-heading)"); }
      const near = /^((?:h|w|min-w|size|mx|top|py|gap|translate-y))-([057]|3\.5|10|0\.5)$/.exec(base);
      if (near) { const member = ({ "0.5": "xs", "3.5": "lg", "5": "xl", "7": "xl", "10": "2xl" } as Record<string,string>)[near[2]!]; if (member) return bindV2(`tokens.spacing.${member}`, `${near[1]}-(${adapter.spacingProperties[member]})`); }
      const slide = /^translate-([xy])-\[(-?)2\.5rem\]$/.exec(base);
      if (slide) return bindV2("tokens.spacing.2xl", `${slide[2] ? "-" : ""}translate-${slide[1]}-(--spacing-2xl)`);
      if (base.includes("--spacing(4)")) {
        tokens.add("tokens.spacing.lg"); tokens.add("tokens.region-width.sidebar-rail");
        let output = base.replaceAll("--spacing(4)", "var(--spacing-lg)");
        if (output.includes("+2px")) { tokens.add("tokens.border-width.rule"); output = output.replaceAll("+2px", "+var(--ui-border-rule)"); }
        return prefix + output;
      }
      if (/^transition(?:-(?:all|colors|opacity|shadow|transform|\[[a-z-]+(?:,[a-z-]+)*\]))?$/.test(base)) {
        tokens.add("tokens.duration.default"); tokens.add("tokens.easing.default");
        return `${value} ${prefix}duration-(--ui-duration-default) ${prefix}ease-(--ease-default)`;
      }
    }
    const selected = selectedBindings[input.leaf]?.[value];
    if (selected) {
      for (const member of selected.tokens) tokens.add(member);
      notes.push({ file, value, message: `Restyled source: ${selected.note}` });
      return selected.output;
    }
    // This arbitrary spelling requests CSS inheritance, not an authored paint.
    // Canonicalize the equivalent public Tailwind utility without a token choice.
    if (base === "text-[inherit]") return `${prefix}text-inherit`;
    // Importance changes precedence, not the consumer design binding.
    if (base.endsWith("!")) {
      const start = issues.length;
      const plain = value.slice(0, -1), rewritten = utility(plain, file, stack);
      for (const issue of issues.slice(start)) if (issue.value === plain) issue.value = value;
      return rewritten.split(/\s+/).filter(Boolean).map(term => term + "!").join(" ");
    }
    // Tailwind's arbitrary spelling denotes the same authenticated focus width.
    if (base === "ring-[3px]") {
      const start = issues.length, canonical = prefix + "ring-3";
      const rewritten = utility(canonical, file, stack);
      for (const issue of issues.slice(start)) if (issue.value === canonical) issue.value = value;
      return issues.length === start ? rewritten : value;
    }
    if (base.startsWith("cn-")) {
      const rule = rules.get(base);
      if (!rule && /^cn-[a-z][a-z0-9-]*$/.test(base) && !new RegExp(`\\.${base}(?![\\w-])`).test(input.styles)) {
        notes.push({ file, value, message: "Removed marker-only class absent from the pinned stylesheet" }); return "";
      }
      if (!rule || stack.includes(base)) { add("K4", file, value, "Style is absent, nested or cyclic; it cannot be flattened safely"); return value; }
      // Control-height variants are semantic bindings; other lengths require exact equality.
      const control = /^cn-button-size-(default|sm|lg|icon|icon-sm|icon-lg)$/.test(base)
        || (["toggle-button", "toggle-group"].includes(input.leaf) && /^cn-toggle-size-(default|sm|lg)$/.test(base))
        || (fieldControl && ["cn-select-trigger", "cn-input-group"].includes(base));
      // The radio item's own box (16px) and the slider thumb (12px) are the control mark, the same role
      // Foundry's radio and slider thumb read; the slider track keeps its own spacing reads.
      const mark = ({ "cn-radio-group-item": "size-4", "cn-slider-thumb": "size-3" } as Record<string, string>)[base];
      const expanded = rule.split(/\s+/).map(term => {
        const [variants, atom] = variantParts(term);
        if (mark && atom === mark) {
          tokens.add("tokens.control-size.mark");
          return `${prefix}${variants}size-${styleRead(adapter.controlProperties.mark!, mark)}`;
        }
        const size = /^(h|size)-(7|8|9)$/.exec(atom);
        if (control && size) {
          const member = adapter.controlSizes[size[2]!]!; tokens.add(`tokens.control-size.${member}`);
          return `${prefix}${variants}${size[1]}-${styleRead(adapter.controlProperties[member]!, `h-${size[2]}`)}`;
        }
        return utility(prefix + term, file, [...stack, base]);
      }).join(" ");
      if (fieldControl && ["cn-select-label", "cn-combobox-label", "cn-select-trigger", "cn-input-group"].includes(base)) {
        const family = adapter.fieldTypography.family!;
        tokens.add(family.member);
        const body = base === "cn-input-group" ? adapter.fieldTypography.sm : undefined;
        if (body) tokens.add(body.member);
        return `${expanded}${body ? ` text-(length:${body.property})` : ""} font-(family-name:${family.property})`;
      }
      return expanded;
    }
    // Selected toggle surfaces share action ink; hover and unselected muted paint do not.
    if (["toggle-button", "toggle-group"].includes(input.leaf) && base === "bg-muted"
      && /(?:^|:)(?:data-selected|aria-pressed|data-\[state=on\]):$/.test(prefix)) {
      return [utility(prefix + "bg-primary", file, stack), utility(prefix + "text-primary-foreground", file, stack)].join(" ");
    }
    // The two link variants use upstream primary as link ink, rather than action fill.
    if (base === "text-primary" && stack.some(rule => rule === "cn-button-variant-link" || rule === "cn-badge-variant-link")) {
      tokens.add("tokens.accent-color.text"); return `${prefix}text-(--color-accent-text)`;
    }
    // Explicit zero-width adjacency and on/off visibility do not introduce a
    // positive design value. Keep the selector and require its structural peer.
    const adjacency = input.leaf === "toggle-group" && (
      base === "border-l-0" && prefix === "group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:"
        && expressionTerms.includes(prefix + "first:border-l")
      || base === "border-t-0" && prefix === "group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:"
        && expressionTerms.includes(prefix + "first:border-t"));
    const tableEdge = input.leaf === "table" && ((base === "border-0" && prefix === "[&_tr:last-child]:") || (base === "border-b-0" && prefix === "[&>tr]:last:"));
    const separatorReset = input.leaf === "separator" && base === "border-0" && !prefix && expressionTerms.some(term => /(?:^|:)h-px$|(?:^|:)w-px$/.test(term));
    if (adjacency || tableEdge || separatorReset) {
      notes.push({ file, value, message: "Preserved structural zero border at the selected adjacent or separator edge; positive widths remain token bound" }); return value;
    }
    if (base === "animate-none" && stack.includes("cn-menu-translucent")) {
      notes.push({ file, value, message: "Preserved the selected translucent surface's explicit animation cancellation" }); return value;
    }
    const indicatorVisibility = input.leaf === "tabs" && (value === "after:opacity-0" || value === "group-data-[variant=line]/tabs-list:data-selected:after:opacity-100")
      && expressionTerms.includes("after:opacity-0") && expressionTerms.includes("group-data-[variant=line]/tabs-list:data-selected:after:opacity-100");
    const restoreOpacity = base === "opacity-100" && prefix === "hover:" && expressionTerms.includes("opacity-50");
    if (indicatorVisibility || restoreOpacity) {
      notes.push({ file, value, message: "Preserved paired state visibility; no intermediate alpha or paint is introduced" }); return value;
    }
    // Only the same expanded literal proves ownership; another expression may
    // be conditional or belong to a different element, including a child.
    const focusOwners = expressionTerms.map(variantParts).filter(([variants, atom]) =>
      ["focus-visible:", "data-focus-visible:", "has-[[data-slot=input-group-control]:focus-visible]:", "group-data-[focused=true]/day:"].includes(variants) && /^(?:ring-3|ring-\[3px\]|ring-ring\/50)$/.test(atom));
    const privateControlReset = inputGroupOwner && file === inputGroupPart?.path && stack.some(rule => ["cn-input-group-input", "cn-input-group-textarea"].includes(rule))
      && (base === "border-0" && !prefix || base === "ring-0" && ["", "focus-visible:", "aria-invalid:"].includes(prefix));
    const privateParentReset = inputGroupOwner && file === inputGroupPart?.path && stack.includes("cn-input-group")
      && prefix === "in-data-[slot=combobox-content]:focus-within:" && ["ring-0", "border-inherit"].includes(base);
    const decorativeThumbReset = switchFocusOwner && file === switchEntry?.path && !prefix && base === "ring-0"
      && expressionSourceTerms.includes("cn-switch-thumb") && expressionTerms.includes("pointer-events-none");
    if (privateControlReset || privateParentReset || decorativeThumbReset) {
      notes.push({ file, value, message: "Preserved authenticated decorative/control reset under its actual parent token-bound focus owner; not a focus conformance claim" });
      return value;
    }
    const optionPaintOwner = fieldEntry && file === fieldEntry.path && base === "outline-hidden" && !prefix
      && expressionTerms.includes("data-focused:bg-accent") && expressionTerms.includes("data-focused:text-accent-foreground");
    if (optionPaintOwner) {
      notes.push({ file, value, message: "Preserved authenticated listbox option outline under its same-element focused paint pair; runtime focus and contrast remain unmeasured" });
      return value;
    }
    if (tabsEntry && file === tabsEntry.path && value === "dark:group-data-[variant=line]/tabs-list:data-selected:border-transparent") {
      notes.push({ file, value, message: "Preserved authenticated selected line-tab border transparency beside its same-element independent token focus outline and selected indicator" });
      return value;
    }
    const suppression = /^(?:outline-(?:none|hidden)|ring-0|border-transparent)$/.test(base);
    if (base === "border-0" && !prefix && focusOwners.length) { notes.push({file,value,message:"Preserved zero border beside the same element token-bound focus outline"}); return value; }
    if (base === "outline-1" && prefix === "focus-visible:" && focusOwners.some(([owner]) => owner === prefix)) { notes.push({file,value,message:"Removed competing literal focus width beside the same element token-bound focus outline"}); return ""; }
    const ownerSuppression = !prefix || ["focus-visible:", "data-focus-visible:"].includes(prefix)
      || (prefix === "group-has-[:focus-visible]/field-label:" && ["ring-0", "border-transparent"].includes(base));
    if (suppression && ownerSuppression && focusOwners.some(([owner]) => !["focus-visible:", "data-focus-visible:"].includes(prefix) || owner === prefix)) {
      notes.push({ file, value, message: "Removed suppression beside the same expanded literal's token-bound focus owner" });
      return "";
    }
    // Invalid paint keeps its existing danger role. Decorative hover/active
    // widths require matching danger paint; a focus-colour ring is no proof.
    const invalidRing = /(?:^|:)(?:aria-invalid|data-invalid):$/.test(prefix)
      || (["has-aria-invalid:", "has-[[data-slot][aria-invalid=true]]:"].includes(prefix)
        && expressionTerms.some(term => { const [paintPrefix, paint] = variantParts(term); return paintPrefix === prefix && /^ring-destructive(?:\/(?:20|40))?$/.test(paint); }));
    const interactiveDangerRing = /(?:^|:)(?:hover|active):$/.test(prefix) && expressionTerms.some(term => {
      const [paintPrefix, paint] = variantParts(term);
      return (paintPrefix === prefix || !paintPrefix) && /^ring-destructive(?:\/(?:20|40))?$/.test(paint);
    });
    if ((invalidRing || interactiveDangerRing) && expressionTerms.includes(prefix + "ring-3") && /^(?:ring-3|ring-destructive(?:\/(?:20|40))?)$/.test(base)) {
      tokens.add("tokens.focus-outline.width"); tokens.add("tokens.focus-outline.offset"); tokens.add("tokens.status-color.danger");
      return focusOutline(prefix, "--color-status-danger");
    }
    if (base === "border-collapse") return value;
    if (cardSpacing && cardFiles.has(file)) {
      const assignment = /^\[--card-spacing:--spacing\(([34])\)\]$/.exec(base);
      if (assignment) {
        const member = assignment[1] === "4" ? "lg" : "md";
        tokens.add(`tokens.spacing.${member}`);
        return `${prefix}[--card-spacing:var(--spacing-${member})]`;
      }
      if (/^(?:gap(?:-[xy])?|p[trblxy]?)-\(--card-spacing\)$/.test(base)) return value;
    }
    if (base === "rounded-[4px]" && allowedTokens.includes("tokens.radius")) {
      tokens.add("tokens.radius.default"); return `${prefix}rounded-(--radius-default)`;
    }
    if (base === "min-w-[96px]" && allowedTokens.includes("tokens.spacing")) {
      tokens.add("tokens.spacing.5xl"); return `${prefix}min-w-(--spacing-5xl)`;
    }
    if (base === "max-w-[calc(100%-2rem)]" && allowedTokens.includes("tokens.spacing")) {
      tokens.add("tokens.spacing.2xl"); return `${prefix}max-w-[calc(100%-var(--spacing-2xl))]`;
    }
    const decorativeRing = /^ring-([12])$/.exec(base);
    if (decorativeRing && allowedTokens.includes("tokens.border-width")) {
      const member = decorativeRing[1] === "1" ? "hairline" : "rule";
      tokens.add(`tokens.border-width.${member}`);
      return `${prefix}ring-(length:--ui-border-${member})`;
    }
    // A size role may bind only size utilities, never padding or spacing.
    const exactSize = /^(h|w|size|min-h|min-w|max-h|max-w)-(?:\[([0-9.]+px)\]|([0-9.]+))$/.exec(base);
    if (exactSize) {
      const binding = adapter.sizeLengths[exactSize[2] ?? adapter.sizeSteps[exactSize[3]!]!];
      if (binding) { tokens.add(binding.member); return `${prefix}${exactSize[1]}-${styleRead(binding.property, base)}`; }
    }
    // Focus width and paint form one solid outline. Invalid-state rings and decorative
    // borders remain separate; they must not accidentally count as focus clearance.
    const focus = /(?:focus-visible|focus-within|has-focus)/.test(prefix) || prefix === "group-data-[focused=true]/day:";
    if ((focus && /^ring-(?:3|ring(?:\/50)?|destructive\/(?:20|40))$/.test(base)) || (!prefix && /^(?:ring-3|ring-ring\/50)$/.test(base))) {
      tokens.add("tokens.focus-outline.width"); tokens.add("tokens.focus-outline.offset"); tokens.add("tokens.focus-color.default");
      return focusOutline(prefix, "--color-focus-ring");
    }
    const elevation = /^shadow-(none|xs|sm|md|lg|xl|2xl)(!)?$/.exec(base);
    if (elevation) {
      const member = elevation[1] === "none" ? "none" : ["xs", "sm"].includes(elevation[1]!) ? "raised" : "floating";
      tokens.add(`tokens.elevation.${member}`);
      return `${prefix}shadow-(--ui-elevation-${member})${elevation[2] ?? ""}`;
    }
    const motion = /^(animate-(in|out)|fade-(in|out)-0|zoom-(in|out)-95|slide-in-from-(top|bottom|left|right)-2)$/.exec(base);
    if (motion) {
      if (base.startsWith("animate-")) {
        const direction = base === "animate-in" ? "enter" : "exit";
        tokens.add("tokens.duration.fast"); tokens.add(`tokens.transition-easing.${direction}`);
        return `${prefix}library-${direction}`;
      }
      if (base.startsWith("fade-")) return `${prefix}library-fade`;
      if (base.startsWith("zoom-")) return `${prefix}library-zoom`;
      tokens.add("tokens.shift-distance.default");
      return `${prefix}library-slide-${motion[5]}`;
    }
    if (base === "duration-100") {
      tokens.add("tokens.duration.fast"); return `${prefix}duration-${styleRead("--ui-duration-fast", base)}`;
    }
    if (styleDefaults && base === "duration-200") {
      tokens.add("tokens.duration.default"); return `${prefix}duration-${styleRead("--ui-duration-default", base)}`;
    }
    const opacity = /^opacity-(50|70)$/.exec(base);
    if (opacity) {
      const member = opacity[1] === "50" ? "disabled" : "stale";
      tokens.add(`tokens.state-opacity.${member}`);
      return `${prefix}opacity-${styleRead(`--ui-alpha-${member}`, base)}`;
    }
    const z = /^z-(0|10|20|30|40|50|60|70|80|90|100)$/.exec(base);
    if (z && allowedTokens.includes("tokens.z-index")) {
      const member = ({ "0": "base", "10": "sticky", "20": "shell", "30": "aside", "40": "notice", "50": "modal", "60": "toast", "70": "palette", "80": "tooltip", "90": "progress", "100": "skip-link" } as Record<string, string>)[z[1]!]!;
      tokens.add(`tokens.z-index.${member}`); return `${prefix}z-${styleRead(`--ui-z-${member}`, base)}`;
    }
    if (base === "font-sans") {
      const family = adapter.fieldTypography.family!;
      tokens.add(family.member); return `${prefix}font-(family-name:${family.property})`;
    }
    const weight = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.exec(base);
    if (weight) { tokens.add(`tokens.font-weight.${weight[1]}`); return `${prefix}font-(weight:--font-weight-${weight[1]})`; }
    const duration = /^duration-(80|160|240|500|1200)$/.exec(base);
    if (duration) {
      const member = ({ "80": "instant", "160": "fast", "240": "default", "500": "deliberate", "1200": "flash" } as Record<string, string>)[duration[1]!]!;
      tokens.add(`tokens.duration.${member}`); return `${prefix}duration-(--ui-duration-${member})`;
    }
    const easing = /^ease-(in|out)$/.exec(base);
    if (easing) {
      const member = easing[1] === "in" ? "accelerate" : "decelerate";
      tokens.add(`tokens.easing.${member}`); return `${prefix}ease-(--ease-${member})`;
    }
    // Property lists are structural; both otherwise implicit timing defaults are bound.
    if (/^transition(?:-(?:all|colors|opacity|shadow|transform|\[[a-z-]+(?:,[a-z-]+)*\]))?$/.test(base)) {
      const output = [`${prefix}${base}`];
      let ambiguous = false;
      for (const [kind, member, property] of [["duration", "tokens.duration.default", "--ui-duration-default"], ["ease", "tokens.easing.default", styleDefaults ? "--default-transition-timing-function" : "--ease-default"]]) {
        if (!explicitTiming.has(`${kind}:${prefix}`) && !explicitTiming.has(`${kind}:`)) {
          if ((activeTiming ?? fileTiming.get(file))?.has(`${kind}:${prefix}`) || (activeTiming ?? fileTiming.get(file))?.has(`${kind}:`)) { ambiguous = true; continue; }
          tokens.add(member!); output.push(`${prefix}${kind}-(${property})`);
        }
      }
      if (ambiguous) add("K4", file, value, "Transition timing split across class expressions needs an explicit binding");
      return output.join(" ");
    }
    if (base === "transition-none") return value;
    const border = /^(border(?:-[trblxyse])?)(?:-1|-\[1px\])?$/.exec(base);
    if (border) {
      tokens.add("tokens.border-width.hairline"); return `${prefix}${border[1]}-${styleRead("--ui-border-hairline", base, "length")}`;
    }
    // Rewrite every upstream theme reference, including references in color-mix().
    let next = base.replace(/--([a-z][a-z0-9-]*)/g, (all, name: string) => {
      if (input.transformVersion === 2) {
        const role = ({ "sidebar-width": ["tokens.region-width.sidebar", "--sidebar-width"], "sidebar-width-icon": ["tokens.region-width.sidebar-rail", "--sidebar-width-icon"], "skeleton-width": ["tokens.content-size.notice", "--ui-width-notice-max"], "spacing": ["tokens.spacing.xs", "--spacing-xs"], "color-border": ["tokens.border-color.base", "--color-line-base"] } as Record<string, [string, string]>)[name];
        if (role) { tokens.add(role[0]); return role[1]; }
      }
      const radius = /^radius-(?:xs|sm|md|lg|xl|2xl)$/.test(name) ? "radius" : name;
      return bind(radius) ?? all;
    });
    const themed = /^(bg|text|border|ring|outline|fill|stroke|divide|decoration|shadow)-([a-z][a-z0-9-]*)(\/[^\s]+)?$/.exec(next);
    if (themed) {
      const property = bind(themed[2]!);
      if (property) return `${prefix}${themed[1]}-(${property})${themed[3] ?? ""}`;
    }
    const font = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.exec(next);
    if (font && input.leaf === "keyboard" && font[1] === "xs") {
      tokens.add("tokens.code-size.block");
      notes.push({ file, value, message: "Restyled source: keyboard 12px to existing code-size.block 13px" });
      return `${prefix}text-(length:--text-code-block)`;
    }
    if (font && fieldControl && ["xs", "sm"].includes(font[1]!)) {
      const binding = adapter.fieldTypography[font[1]!]!;
      tokens.add(binding.member); return `${prefix}text-(length:${binding.property})`;
    }
    if (font) { tokens.add(`tokens.font-size.${font[1]}`); return `${prefix}text-(length:${adapter.fontSizes[font[1]!]})`; }
    const radius = /^rounded(?:-[trbl]{1,2})?-(?:xs|sm|md|lg|xl|2xl)$/.exec(next);
    if (radius) return `${prefix}${next.replace(/-(?:xs|sm|md|lg|xl|2xl)$/, `-(${bind("radius")})`)}`;
    const space = /^(-?(?:h|w|size|min-h|min-w|max-h|max-w|p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy]|top|bottom|left|right|inset|translate-[xy]|underline-offset))-(\d+(?:\.\d+)?|px)$/.exec(next);
    if (space && space[2] !== "0") {
      const restyle = ({ "1.5": "sm", "2.5": "md" } as Record<string,string>)[space[2]!];
      if (restyle) {
        tokens.add(`tokens.spacing.${restyle}`);
        notes.push({ file, value, message: `Restyled source: ${space[2] === "1.5" ? "6px to spacing.sm 8px" : "10px to spacing.md 12px"}` });
        return `${prefix}${space[1]}-(${adapter.spacingProperties[restyle]})`;
      }
      const member = adapter.spacing[space[2]!];
      if (member) { tokens.add(`tokens.spacing.${member}`); return `${prefix}${space[1]}-${/^(?:h|size)$/.test(space[1]!) ? styleRead(adapter.spacingProperties[member]!, `${space[1]}-${space[2]}`) : `(${adapter.spacingProperties[member]})`}`; }
      add("K4", file, value, "No spacing member has the exact source length");
    }
    if (/(?:#[\da-f]{3,8}\b|\d*\.?\d+(?:px|rem|em)\b|--spacing\()/i.test(next)) add("K4", file, value, "Literal colour or length remains after rewriting");
    for (const property of next.match(/--[a-z][a-z0-9-]*/g) ?? []) if (!engineVariables.get(file)?.has(property) && !(input.transformVersion === 2 && ["--sidebar-width", "--sidebar-width-icon", "--ui-width-notice-max", "--spacing-xs", "--color-line"].includes(property)) && !consumerVariables.get(file)?.has(property) && ![...Object.values(adapter.bindings).map(binding => binding.property), ...Object.values(adapter.controlProperties), ...Object.values(adapter.spacingProperties), ...Object.values(adapter.fontSizes)].includes(property)) add("K4", file, property, "Private CSS variable needs an independently bound consumer token");
    if (/^(?:bg|text|border|outline|ring|fill|stroke|divide|decoration)-(?:[a-z]+-\d{2,3}|black|white)(?:\/|$)/.test(next) || /^(?:bg|text|border|outline|ring|fill|stroke|divide|decoration)-\[/.test(next) && !next.includes("var(--")) add("K4", file, value, "Raw paint or arbitrary design value needs a consumer binding");
    if (/^(?:ring|border|outline|shadow|leading|tracking|font|duration|delay|ease|animate|fade|zoom|slide|opacity|z|transition)-/.test(next) && next === base) add("K4", file, value, "Design utility needs a consumer binding");
    return prefix + next;
  };
  // A registry Button import is rebound to the consumer's Button leaf, whose entrypoint dispatches
  // declared members only. Its call sites, and those of wrappers typed with its props (in any file of
  // this item), pass shadcn values; each becomes the declared member it evidences, or a K9 finding.
  const reboundButton = input.item !== "button" && input.leafByItem.button === "button";
  const buttonWrappers = new Map<string, readonly ("size" | "variant")[]>();
  if (reboundButton) for (const file of input.files) {
    const local = rebindsButton(file.content);
    if (local) for (const [name, wrapper] of buttonShapedWrappers(file.content, local)) buttonWrappers.set(name, wrapper.axes);
  }
  const translateButtonProps = (source: string, path: string): string => {
    let content = source;
    const local = rebindsButton(content);
    // A wrapper default is translated in place. A size default equal to the Button's own is dropped
    // with its explicit forward: an unset size then stays unset (keeping that default), and a caller's
    // shape member is never overridden by a size the wrapper always forwards.
    for (const [name, wrapper] of local ? [...buttonShapedWrappers(content, local)].reverse() : []) {
      let body = content.slice(wrapper.start, wrapper.end);
      const head = /^function [A-Za-z0-9]+\(\{([^}]*)\}/.exec(body)!;
      let list = head[1]!, rest = body.slice(head[0].length);
      for (const axis of wrapper.axes) {
        const fallback = new RegExp(`(\\n\\s*)${axis} = "([^"]*)"(,?)`).exec(list);
        if (!fallback) continue;
        const value = fallback[2]!;
        if (axis === "size" && value === SHADCN_BUTTON_MEMBERS.defaultSize) {
          const forward = /\n\s*size=\{size\}(?=\s)/;
          if (rest.split(forward).length === 2 && /\{\.\.\.props\}/.test(rest)) {
            list = list.replace(fallback[0], ""); rest = rest.replace(forward, "");
            notes.push({ file: path, value: `${name} size = "${value}"`, message: "Rebound Button: the wrapper's size default is the Button's own; size is forwarded only when a caller passes it" });
          } else add("K9", path, `${name} size=${value}`, "Rebound Button wrapper forwards its default size in an unsupported form");
          continue;
        }
        const member = buttonMember(axis, value);
        if (!member || member.axis !== axis) { add("K9", path, `${name} ${axis}=${value}`, "Rebound Button default has no declared member on its own axis"); continue; }
        list = list.replace(fallback[0], `${fallback[1]}${axis} = "${member.value}"${fallback[3]}`);
      }
      body = head[0].replace(head[1]!, list) + rest;
      content = content.slice(0, wrapper.start) + body + content.slice(wrapper.end);
    }
    const callers: [string, readonly ("size" | "variant")[]][] = [...(local ? [[local, ["size", "variant"] as const] as [string, readonly ("size" | "variant")[]]] : []), ...buttonWrappers];
    for (const [name, axes] of callers) {
      for (const match of [...content.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))].reverse()) {
        const end = openingTagEnd(content, match.index + match[0].length);
        const tag = content.slice(match.index, end).replace(/(\s)(size|variant)="([^"]*)"/g, (all, space: string, axis: "size" | "variant", value: string) => {
          if (!axes.includes(axis)) return all;
          const member = buttonMember(axis, value);
          if (!member) { add("K9", path, `<${name}> ${axis}=${value}`, "Rebound Button value has no declared member"); return all; }
          if (member.axis === "shape" && value !== SHADCN_BUTTON_MEMBERS.iconSize) notes.push({ file: path, value: `<${name}> size="${value}"`, message: "Restyled source: Button size to declared shape.icon-only; the slot declares no sized square member" });
          return `${space}${member.axis}="${member.value}"`;
        });
        content = content.slice(0, match.index) + tag + content.slice(end);
      }
    }
    return content;
  };
  const files = input.files.map(file => {
    const inPart = file.path.includes("/_parts/");
    const relative = inPart ? "../../" : "../";
    let needsIcon = false;
    let content = reboundButton && !input.retainRegistryButtonProps ? translateButtonProps(file.content, file.path) : file.content;
    if (input.transformVersion === 2 && input.item === "sidebar") {
      content = content.replace(/^const SIDEBAR_WIDTH(?:_MOBILE|_ICON)? = .*\n/gm, "")
        .replace(/^\s*"--sidebar-width(?:-icon)?": SIDEBAR_WIDTH(?:_MOBILE|_ICON)?,\n/gm, "")
        .replace(/  \/\/ Random width between 50 to 90%\.\n  const \[width\] = React\.useState\(\(\) => \{[\s\S]*?\n  \}\)\n/, "")
        .replace('"--skeleton-width": width,', 'maxWidth: "var(--ui-width-notice-max)",');
    }
    if (consumerVariables.get(file.path)?.has("--gap")) {
      content = content.replace('"--gap": `calc(var(--spacing) * ${spacing})`', '"--gap": `calc(var(--spacing-xs) * ${spacing})`');
      tokens.add("tokens.spacing.xs");
      notes.push({ file: file.path, value: "style --gap = calc(var(--spacing) * spacing)", message: "Restyled source: bind the public spacing multiplier to the existing spacing.xs unit; preserve caller value and default" });
    }
    if (input.item === "select" && input.leaf === "select" && !inPart) {
      content = content.replace('size?: "sm" | "default"', 'size?: "sm" | "default" | "lg"');
      if (content.includes("cn-select-trigger flex")) {
        content = content.replace("cn-select-trigger flex", "cn-select-trigger data-[size=lg]:h-(--ui-control-h-lg) flex");
        tokens.add("tokens.control-size.h-lg");
      }
    }
    // InputGroup is already inside SearchField/ComboBox. A full TextField would
    // install another context root and does not export the registry's Input API.
    if (fieldControl && file.path === "components/_parts/input-group/input-group.tsx") {
      content = content.replace(/import\s*\{([^}]+)\}\s*from\s*["']@\/(?:components\/ui|registry\/bases\/aria\/ui)\/(input|textarea)["']\s*;?/g,
        (all, names: string, item: string) => {
          const expected = item === "input" ? "Input" : "Textarea";
          const binding = new RegExp(`^\\s*${expected}(?:\\s+as\\s+([A-Za-z][A-Za-z0-9]*))?\\s*$`).exec(names);
          if (input.leafByItem[item] !== "text-field" || !binding) {
            add("K9", file.path, item, "Contextual input needs its selected text-field mapping and supported registry export");
            return all;
          }
          const local = binding?.[1] ?? expected;
          if (!new RegExp(`<${local}\\b`).test(content)) {
            add("K9", file.path, item, "Contextual input has no inspectable call"); return all;
          }
          contextualInputs.add(item);
          notes.push({ file: file.path, value: item, message: "InputGroup retains its enclosing RAC context through the native input primitive" });
          const primitive = item === "input" ? "Input" : "TextArea";
          return `import { ${primitive}${primitive === local ? "" : ` as ${local}`} } from "react-aria-components"\n`;
        });
    }
    // The rebound Button leaf is the consumer's open member-dispatch facade, so its props no longer carry
    // the pinned Button's string className; InputGroupButton keeps that contract for the cn call it makes.
    if (file.path === "components/_parts/input-group/input-group.tsx" && content.includes("function InputGroupButton(")) {
      const props = '  VariantProps<typeof inputGroupButtonVariants> & {\n    type?: "button" | "submit" | "reset"\n  }) {';
      if (content.split(props).length === 2) content = content.replace(props, props.replace('"reset"\n', '"reset"\n    className?: string\n'));
      else add("K9", file.path, "InputGroupButton", "InputGroupButton props differ from the pinned source");
    }
    for (const declaration of [...content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']\s*;?/g)]) {
      let unresolved = false;
      for (const binding of declaration[1]!.split(",").map(value => value.trim()).filter(Boolean)) {
        const [imported, local = imported] = binding.split(/\s+as\s+/);
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(imported ?? "") || !/^[A-Za-z][A-Za-z0-9]*$/.test(local ?? "")) { unresolved = true; continue; }
        const asset = adapter.glyphs[imported!] ?? adapter.glyphs[`${imported}Icon`];
        const pattern = new RegExp(`<${local}\\b([^>]*?)\\/>`, "g");
        if (!asset || !pattern.test(content)) { unresolved = true; add("K7", file.path, imported!, "Lucide binding has no equivalent asset or a non-static call site"); continue; }
        pattern.lastIndex = 0;
        content = content.replace(pattern, (_all, attributes: string) => iconCall(asset, attributes));
        assets.add(asset); components.add("components.icon"); needsIcon = true;
      }
      if (!unresolved) content = content.replace(declaration[0], "");
    }
    // The pinned checkbox shares check artwork between selected and mixed states.
    // Mixed state uses a currentColor rule; checked state retains the bound icon.
    if (input.item === "checkbox" && input.leaf === "checkbox") {
      content = content.replace(/\{\(isSelected \|\| isIndeterminate\) && \(\s*(<IconPlaceholder\b[\s\S]*?\/>)\s*\)\}/g,
        (_all, glyph: string) => `{isIndeterminate ? (<span aria-hidden="true" data-slot="checkbox-indeterminate" className="w-2 border-t" style={{ borderColor: "currentColor" }} />) : isSelected ? (${glyph}) : null}`);
    }
    content = content.replace(/<IconPlaceholder\b([\s\S]*?)\/>/g, (all, attributes: string) => {
      const name = /\blucide="([A-Za-z0-9]+)"/.exec(attributes)?.[1];
      const restyledGlyph = input.item === "breadcrumb" && name === "MoreHorizontalIcon";
      const asset = restyledGlyph ? "assets.icon-chevron-down" : name && adapter.glyphs[name];
      if (restyledGlyph) notes.push({ file: file.path, value: name!, message: "Restyled source: collapsed disclosure MoreHorizontalIcon to existing assets.icon-chevron-down" });
      if (!asset) { add("K7", file.path, name ?? "IconPlaceholder", "No asset leaf maps this glyph"); return all; }
      needsIcon = true; assets.add(asset); components.add("components.icon");
      const kept = attributes.replace(/\b(?:lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"\s*/g, "").trim();
      return iconCall(asset, kept);
    });
    content = content.replace(/import\s*\{\s*IconPlaceholder\s*\}\s*from\s*["'][^"']+icon-placeholder["']\s*;?/g, "");
    if (needsIcon) content = content.replace(/("use client"\s*)?/, match => `${match}import { Icon as LibraryIcon } from "${relative}icon/index"\n`);
    content = content.replace(/(from\s*["'])(@\/components\/ui\/|@\/registry\/bases\/aria\/ui\/)([a-z][a-z0-9-]*)(["'])/g, (_all, before: string, _prefix: string, item: string, after: string) => {
      const leaf = input.leafByItem[item];
      if (leaf) { components.add(`components.${leaf}`); return `${before}${relative}${leaf}/index${after}`; }
      parts.add(item); return `${before}${relative}_parts/${item}/index${after}`;
    });
    content = content.replace(/(from\s*["'])cn(["'])/g, `$1${relative}_parts/utils/index$2`);
    if (content.includes("_parts/utils/")) parts.add("utils");
    // These authenticated entries contain only imports and separate named functions.
    // Their Popover timing cannot override an unrelated trigger's class expression.
    // Unknown or changed source retains the conservative whole-file timing check.
    const functionStarts = isolatedTiming.has(file.path) ? [...content.matchAll(/^function [A-Za-z][A-Za-z0-9]*(?:<[^\n]+>)?\(/gm)].map(match => match.index) : [];
    const functionTiming = functionStarts.map((start, index) => ({
      start, end: functionStarts[index + 1] ?? content.length,
      keys: new Set([...content.slice(start, functionStarts[index + 1]).matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)].flatMap(match => timingKeys(match[0].slice(1, -1).split(/\s+/)))),
    }));
    // A lexical quoted-string walk avoids changing import specifiers and handles
    // escaped quotes in Tailwind's arbitrary selectors without evaluating code.
    content = content.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (quoted, offset: number) => {
      activeTiming = functionTiming.find(scope => offset >= scope.start && offset < scope.end)?.keys;
      const inner = quoted.slice(1, -1);
      if (!/(?:\bcn-|\b(?:bg|text|border|ring|rounded|h|w|size|p[trblxy]?|m[trblxy]?|gap|font|leading|duration|shadow|animate|fade|zoom|slide|outline|opacity|z|transition|ease|origin|translate-[xy])-|\b(?:border|transition)(?:\s|$))/.test(inner) || /^\.\.?\//.test(inner)) return quoted;
      explicitTiming = new Set(timingKeys(inner.split(/\s+/)));
      expressionSourceTerms = inner.split(/\s+/);
      expressionTerms = timingTerms(inner.split(/\s+/));
      return quoted[0] + inner.split(/\s+/).map(term => utility(term, file.path)).filter(Boolean).join(" ") + quoted[0];
    });
    for (const match of content.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)) if (match[2]!.startsWith("@/") || FOREIGN_ICONS.test(match[2]!)) add("K9", file.path, match[2]!, "Unresolved source import");
    if (/<IconPlaceholder\b|<svg\b|[✓✔✕✖×✗▾▴▸◂▶◀▲▼←→↑↓]/u.test(content)) add("K7", file.path, "glyph", "Unbound icon artwork remains");
    const name = file.path.split("/").at(-1)!;
    return { path: inPart ? file.path : `components/${input.leaf}/${name}`, content };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const unique = [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { transform: input.transformVersion === 2 ? "shadcn-aria-rewrite@2" : "shadcn-aria-rewrite@1", ...(contextualInputs.size ? { contextualInputs: sorted(contextualInputs) } : {}), ...(notes.length ? { notes: [...new Map(notes.map(note => [JSON.stringify(note), note])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) } : {}), files, outputSha256: files.map(file => ({ path: file.path, sha256: sha256(file.content) })), reads: { tokens: sorted(tokens), assets: sorted(assets), components: sorted(components) }, parts: sorted(parts), issues: unique };
}
