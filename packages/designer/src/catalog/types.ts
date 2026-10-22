/**
 * Internal catalog manifests: the typed information architecture for this
 * package's five catalogs (tokens, assets, icons, atoms, blocks).
 *
 * This directory is internal data. It is not a `package.json` export and is
 * not re-exported from `src/index.ts`; tooling that renders or checks the
 * catalogs imports it by path.
 *
 * Shared rules every catalog follows:
 * - Three levels: L1 group, L2 sub-group, L3 leaf.
 * - Every leaf has exactly one home. A secondary use is metadata, never a
 *   second placement.
 * - No ampersand character in any id, label or note.
 * - Leaf ids are frozen addresses. Moving a leaf changes its `l1`/`l2`,
 *   never its id.
 * - Every leaf carries a lifecycle and an owner-review state.
 */
import type { IdentityCheckId, IdentityVerdict } from "../tokens/identity-checks.js";
import type { IdentityVariantRole } from "../tokens/identity-kit.js";
import type { IconNode } from "../icons/types.js";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** The five catalogs this package owns. */
export type CatalogKind = "tokens" | "assets" | "icons" | "atoms" | "blocks";

/**
 * Leaf lifecycle. `parked` keeps the code as it is: hidden from browse by
 * default, no new work, no deletion. Promotion to `stable` needs owner
 * sign-off.
 */
export type CatalogLifecycle = "draft" | "stable" | "deprecated" | "parked";

/** Whether the owner has visually reviewed and accepted the leaf. */
export type OwnerReview = "not-yet-reviewed" | "accepted";

/**
 * A catalog's group map: each L1 id maps to the union of its L2 ids. L2 ids
 * are scoped to their L1 (two L1 groups may each have a `focus` L2).
 */
export type GroupMap = Readonly<Record<string, string>>;

/** A valid `{ l1, l2 }` pair for a group map; an L2 from another L1 is a type error. */
export type Placement<M extends GroupMap> = {
  [K in keyof M & string]: { readonly l1: K; readonly l2: M[K] };
}[keyof M & string];

/** One L2 node of the display tree. */
export interface CatalogL2<L2 extends string = string> {
  readonly id: L2;
  readonly label: string;
}

/** One L1 node of the display tree, with its L2 children in display order. */
export interface CatalogL1<L1 extends string = string, L2 extends string = string> {
  readonly id: L1;
  readonly label: string;
  readonly children: readonly CatalogL2<L2>[];
}

/** The L1/L2 display tree for a group map, in display order. Leaves attach by `l1`/`l2`. */
export type CatalogTree<M extends GroupMap> = readonly {
  [K in keyof M & string]: CatalogL1<K, M[K]>;
}[keyof M & string][];

/** Fields every leaf in every catalog carries. */
export interface CatalogLeafBase {
  /** Display name. Never contains an ampersand. */
  readonly label: string;
  readonly lifecycle: CatalogLifecycle;
  readonly ownerReview: OwnerReview;
  /** Rename or move reasons, and other short notes. Never contains an ampersand. */
  readonly notes?: readonly string[];
}

/** A tracked piece of work in this repository. */
export interface WorkRef {
  readonly kind: "issue" | "pull-request";
  readonly number: number;
  /** Pull request state when known. */
  readonly state?: "draft" | "ready" | "merged";
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Token L1 groups follow the Tailwind v4 namespaces. 6 L1, 31 L2. */
export type TokenGroupMap = {
  color: "surface" | "ink" | "line" | "primary" | "control" | "status" | "overlay" | "focus" | "palette" | "data";
  type: "font" | "display" | "weight" | "text" | "tracking" | "leading";
  layout: "spacing" | "breakpoint" | "container" | "region";
  shape: "radius" | "border" | "focus" | "icon";
  depth: "shadow" | "blur" | "z";
  motion: "ease" | "duration" | "transition" | "animate";
}
export type TokenL1 = keyof TokenGroupMap;
export type TokenPlacement = Placement<TokenGroupMap>;

/** A CSS custom property name. Token ids are frozen. */
export type TokenId = `--${string}`;

/**
 * - `brand-required`: brand.css must declare it (per-mode tokens in all three
 *   brand blocks: light, dark by OS preference, dark by explicit override).
 * - `brand-optional`: brand.css may declare it; otherwise `fallback` applies.
 * - `fixed-standard`: the package declares it; brands do not override it.
 * - `parked`: declared and kept, excluded from brand.css and brand checks.
 */
export type TokenTier = "brand-required" | "brand-optional" | "fixed-standard" | "parked";

/** A token value: a literal CSS value, or an alias of another token. */
export type TokenValue = { readonly literal: string } | { readonly alias: TokenId };

/** One value per colour mode. */
export interface PerMode<T> {
  readonly light: T;
  readonly dark: T;
}

/**
 * Mode shape and reference (template starter) value. A per-mode token carries
 * one reference value per mode; an invariant token carries one.
 */
export type TokenModes =
  | { readonly modes: "invariant"; readonly reference: TokenValue }
  | { readonly modes: "per-mode"; readonly reference: PerMode<TokenValue> };

/**
 * A brand-optional token always names its fallback (one value, or one per
 * mode for a per-mode token); no other tier has one.
 */
export type TokenTierFields =
  | { readonly tier: "brand-optional"; readonly fallback: TokenValue | PerMode<TokenValue> }
  | { readonly tier: Exclude<TokenTier, "brand-optional">; readonly fallback?: never };

/** A contrast obligation: `fg` drawn on `bg` must reach `min` (WCAG ratio). */
export interface ContrastPair {
  readonly fg: TokenId;
  readonly bg: TokenId;
  readonly min: number;
  /** For a translucent `bg`: the ground it is composited over before measuring. */
  readonly over?: TokenValue;
}

/** One token leaf. `consumers` is computed from source, so it is not authored here. */
export type TokenEntry = CatalogLeafBase &
  TokenPlacement &
  TokenModes &
  TokenTierFields & {
    readonly id: TokenId;
    /** True for the owner-named component levers (panel, display axes, icon stroke, widths). */
    readonly lever: boolean;
    /** True when the key lives in Tailwind's `@theme`; false for a plain `--ui-*` property. */
    readonly inTheme: boolean;
    /** Generated utility names, for example `bg-primary` or `max-w-reading`. */
    readonly utilities: readonly string[];
    /** Contrast obligations where this token is the foreground. */
    readonly pairs: readonly ContrastPair[];
    /** Evidence row numbers from the token audit this catalog supersedes; empty for a new token. */
    readonly sourceRows: readonly number[];
    /** Earlier ids this token replaces (renames), oldest first. */
    readonly previousIds: readonly string[];
  };

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** 3 L1, 7 L2. */
export type AssetGroupMap = {
  logo: "lockup" | "mark" | "display";
  "app-identity": "favicon" | "app-icon" | "manifest";
  imagery: "rules";
}
export type AssetL1 = keyof AssetGroupMap;
export type AssetPlacement = Placement<AssetGroupMap>;

/** Identity-kit role, reused from the kit itself. */
export type AssetRole = IdentityVariantRole;

/** How a brand's file for a slot may come to exist. */
export type AssetSource = "generated" | "adopted" | "supplied" | "derived";

/** What the slot holds: a file, a display contract expressed as tokens, or a rule. */
export type AssetSlotKind = "file" | "display" | "rule";

/** Requirement for a brand-bound site. */
export type AssetRequirement = "required" | "optional" | "derived-when-absent";

/** A ground the asset must read on. */
export type AssetGround = "light" | "dark" | "inverse";

/** Check ids: the identity kit's four, plus checks the catalog adds. */
export type AssetCheckId =
  | IdentityCheckId
  | "pixel-legibility"
  | "opaque-ground"
  | "maskable-safe-zone"
  | "manifest-schema"
  | "manifest-icons-resolve"
  | "manifest-theme-color"
  | "aspect-ratio-set"
  | "token-treatment"
  | "alt-text"
  | "format-budget";

/** One check a slot is held to. `exists` is false while no implementation exists yet. */
export interface AssetCheck {
  readonly id: AssetCheckId;
  readonly exists: boolean;
  readonly note?: string;
}

/** One file a slot produces. */
export interface AssetFile {
  readonly name: string;
  readonly format: "svg" | "png" | "ico" | "webmanifest";
  /** Square pixel sizes, for raster formats. */
  readonly sizes?: readonly number[];
}

/** A production step and whether a generator for it exists today. */
export interface AssetProduction {
  readonly step: "generate-or-adopt" | "derive" | "rasterise" | "generate" | "none";
  readonly exists: boolean;
}

/** Display contract for a `display` slot (lockup rendering sizes). */
export interface AssetDisplayMetrics {
  readonly heightPx: number;
  readonly gapPx: number;
  readonly tokens: readonly TokenId[];
}

/** Font licence state of a lockup's wordmark face. */
export type FontLicence = "permitted" | "restricted" | "unknown";

/** One asset slot: the contract the designer owns. Brands own the files that fill it. */
export type AssetSlotEntry = CatalogLeafBase &
  AssetPlacement & {
    /** Frozen slot id, for example `logo.mark.primary` or `favicon.svg`. */
    readonly id: string;
    readonly kind: AssetSlotKind;
    /** Identity-kit role, or null when the slot has none. */
    readonly role: AssetRole | null;
    readonly requirement: AssetRequirement;
    readonly sources: readonly AssetSource[];
    readonly production: AssetProduction;
    readonly files: readonly AssetFile[];
    readonly grounds: readonly AssetGround[];
    /** Minimum clear-space ratio (the `data-clear-space` root attribute), or null when not applicable. */
    readonly clearSpace: number | null;
    /** Minimum rendered size in px, or null when not applicable. */
    readonly minSizePx: number | null;
    readonly checks: readonly AssetCheck[];
    /** Present on `display` slots only. */
    readonly display?: AssetDisplayMetrics;
    /** Brand owns the final files. */
    readonly owner: "brand";
  };

/** Per-brand fill state of one slot. Held by the consumer, typed here so both sides agree. */
export interface AssetSlotFill {
  readonly slotId: string;
  readonly source: AssetSource;
  readonly checks: readonly { readonly id: AssetCheckId; readonly verdict: IdentityVerdict; readonly evidence: string }[];
  readonly fontLicence?: FontLicence;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** 2 L1, 11 L2. */
export type IconGroupMap = {
  interface: "direction" | "controls" | "status" | "theme";
  subject: "people" | "places" | "documents" | "time" | "commerce" | "trust" | "structure";
}
export type IconL1 = keyof IconGroupMap;
export type IconPlacement = Placement<IconGroupMap>;

/** Fixed-standard icon sizes (`--ui-icon-sm|md|lg`). */
export type IconSize = "sm" | "md" | "lg";

/** Upstream provenance of a vendored glyph. */
export interface IconSource {
  readonly library: "lucide";
  /** Upstream kebab-case name. */
  readonly name: string;
  readonly version: string;
  /**
   * The earlier upstream name this package's export still follows, present
   * when upstream has since renamed the glyph.
   */
  readonly renamedFrom?: string;
}

/** One glyph leaf. `consumers` is computed from source, so it is not authored here. */
export type IconEntry = CatalogLeafBase &
  IconPlacement & {
    /** Export name from `./icons`, frozen. */
    readonly id: string;
    readonly source: IconSource;
    /** The vendored glyph data itself (the same constant `./icons` exports). */
    readonly nodes: IconNode;
    readonly sizes: readonly IconSize[];
    /** Stroke comes from the `--ui-icon-stroke` lever; `override` is a per-glyph optical correction. */
    readonly stroke: { readonly lever: "--ui-icon-stroke"; readonly override?: number };
    /** Default naming: decorative (`aria-hidden`) or labelled (the consumer passes the accessible name). */
    readonly naming: "decorative" | "labelled";
    readonly mirrorInRtl: boolean;
  };

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

/** 4 L1, 17 L2. */
export type AtomGroupMap = {
  interaction:
    | "actions"
    | "navigation"
    | "text-entry"
    | "choice"
    | "number-and-range"
    | "date-and-time"
    | "color"
    | "files"
    | "form-wiring";
  content: "data-display" | "text" | "imagery" | "charts";
  feedback: "messages" | "progress-and-loading";
  containment: "structure" | "overlays";
}
export type AtomL1 = keyof AtomGroupMap;
export type AtomPlacement = Placement<AtomGroupMap>;

/** Atom ids keep their existing `<verb>.<name>` shape, for example `act.button`. */
export type AtomId = `${string}.${string}`;

/**
 * - `main`: on the default branch.
 * - `in-flight`: an open issue or pull request is building it.
 * - `gap`: react-aria-components has it and nothing exists here.
 * - `parked`: no react-aria-components base; kept untouched.
 */
export type AtomStatus = "main" | "in-flight" | "gap" | "parked";

/**
 * The react-aria-components base. `rac` lists the exact components or hooks
 * the atom composes (or will compose, for a gap or in-flight leaf). `none`
 * says why there is no base; `mapsTo` names the base it should move onto.
 */
export type RacBase =
  | { readonly kind: "rac"; readonly parts: readonly string[]; readonly minVersion?: string }
  | {
      readonly kind: "none";
      readonly reason: "presentational" | "hand-built" | "native-element";
      readonly mapsTo?: readonly string[];
    };

/** What happens to the leaf next. */
export type AtomDisposition =
  | "keep"
  | "build-now"
  | "not-now"
  | "finish"
  | "map-to-rac"
  | "remove"
  | "presentational-exception"
  | "register"
  | "decision-pending"
  | "park";

/** A react-aria-components render-prop state the atom styles, forced in preview through `data-*`. */
export type AtomState =
  | "isHovered"
  | "isPressed"
  | "isFocused"
  | "isFocusVisible"
  | "isDisabled"
  | "isInvalid"
  | "isSelected"
  | "isReadOnly"
  | "isPending"
  | "isIndeterminate"
  | "isOpen"
  | "isExpanded";

/** One public prop. A union prop (`values`) becomes a live control. */
export interface AtomProp {
  readonly name: string;
  readonly values?: readonly (string | number | boolean)[];
  readonly default?: string | number | boolean;
}

/** Keyboard and naming contract, inherited from react-aria-components and listed so it can be checked. */
export interface A11yContract {
  readonly role: string;
  readonly nameFrom: string;
  readonly keys: readonly { readonly key: string; readonly action: string }[];
}

/** An authored config address, `<prefix>.<variant>`. */
export interface AuthoredConfig {
  readonly id: string;
  readonly ownerApproved: boolean;
}

/** The authored component contract. Optional until a leaf has been reviewed. */
export interface AtomContract {
  readonly props: readonly AtomProp[];
  readonly variants: readonly string[];
  readonly sizes: readonly ("sm" | "md" | "lg")[];
  readonly states: readonly AtomState[];
  readonly grounds: readonly ("base" | "sunken" | "inverse")[];
  /** Named children, for example `icon-end`, `label`, `description`. */
  readonly slots: readonly string[];
  /** Tokens consumed, by catalog token id. */
  readonly tokens: readonly TokenId[];
  readonly a11y: A11yContract;
  /** Draft 0 to 8, stable 1 to 8. */
  readonly configs: readonly AuthoredConfig[];
}

/** One atom leaf. */
export type AtomEntry = CatalogLeafBase &
  AtomPlacement & {
    readonly id: AtomId;
    /** Export name, or null for a leaf with nothing built yet. */
    readonly export: string | null;
    /** Package-relative source files, empty when nothing exists. */
    readonly files: readonly string[];
    readonly racBase: RacBase;
    readonly status: AtomStatus;
    /** Present while `status` is `in-flight`. */
    readonly inFlight?: WorkRef;
    readonly disposition: AtomDisposition;
    readonly contract?: AtomContract;
  };

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** L1 is the block's function; L2 its family. 5 L1, 33 L2. */
export type BlockGroupMap = {
  explain: "headings" | "sections" | "capabilities" | "evidence" | "media" | "reading" | "sequence" | "brand" | "specimens";
  organize: "collection" | "comparison" | "offers" | "metrics" | "records" | "activity" | "containers";
  collect: "forms" | "fields" | "import" | "settings" | "access" | "conversation";
  navigate: "destinations" | "app-navigation" | "hierarchy" | "in-page" | "actions" | "paging" | "filtering";
  respond: "states" | "decisions" | "notices" | "notifications";
}
export type BlockL1 = keyof BlockGroupMap;
export type BlockPlacement = Placement<BlockGroupMap>;

/** Block ids keep their `<shape>.<name>` prefix, which records data shape, not placement. */
export type BlockId = `${"say" | "items" | "matrix" | "prose" | "form"}.${string}`;

/**
 * - `yes`: exported on the default branch and vendored by the consumer.
 * - `exported`: exported on the default branch; the consumer's vendored copy has not caught up.
 * - `no`: not built.
 */
export type BlockBuilt = "yes" | "exported" | "no";

/** A deprecated block always names its successor; no other lifecycle has one. */
export type BlockLifecycleFields =
  | { readonly lifecycle: "deprecated"; readonly successor: BlockId }
  | { readonly lifecycle: Exclude<CatalogLifecycle, "deprecated">; readonly successor?: never };

/** One identity axis and its values, in axis order. */
export interface BlockAxis {
  readonly name: string;
  readonly values: readonly string[];
}

/** The authored block contract. Optional until a leaf has been reviewed. */
export interface BlockContract {
  /** Content contract, for example `tiers[{name, price, features, cta}]`. */
  readonly requiredFields: readonly string[];
  readonly axes: readonly BlockAxis[];
  /** Named regions the host fills. */
  readonly slots: readonly string[];
  /** Address `<blockId>@<non-default axes>`. Draft 0 to 8, stable 1 to 8. */
  readonly configs: readonly AuthoredConfig[];
  readonly surface: "marketing" | "app" | "both";
  /** Exact specimen fixture id, or null when none exists. */
  readonly specimen: string | null;
  /** Secondary use cases. Metadata only, never a second placement. */
  readonly alsoUsedFor: readonly string[];
}

/** One block leaf. `atoms`, `tokens` and `composedBy` are computed, so they are not authored here. */
export type BlockEntry = Omit<CatalogLeafBase, "lifecycle"> &
  BlockPlacement &
  BlockLifecycleFields & {
    readonly id: BlockId;
    /** Export name, or null for a block not built yet. */
    readonly export: string | null;
    readonly built: BlockBuilt;
    readonly inFlight?: WorkRef;
    /** Has an exact specimen and may be promoted to stable with owner sign-off. */
    readonly stableCandidate: boolean;
    /** Owner sign-off for `stable`. */
    readonly signedOff: boolean;
    readonly contract?: BlockContract;
  };

// ---------------------------------------------------------------------------
// Catalog wrapper
// ---------------------------------------------------------------------------

/** One catalog: its display tree and its leaves. */
export interface Catalog<K extends CatalogKind, M extends GroupMap, E> {
  readonly kind: K;
  readonly groups: CatalogTree<M>;
  readonly entries: readonly E[];
}
