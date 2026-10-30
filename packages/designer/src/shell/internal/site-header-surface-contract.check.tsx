/** Compile-time assertions run by the actual package build, including retired-property refusals. */
import { SiteHeader } from "../SiteHeader.js";
import type { SiteHeaderSurface } from "../SiteHeader.js";
import type { SiteHeaderSurface as RootSurface } from "../../index.js";
import type { SiteHeaderSurface as ServerSurface } from "../server.js";
export const surfaceEntryParity: [SiteHeaderSurface, RootSurface, ServerSurface] = ["solid", "transparent", "glass"];

// New single-surface contract: these assertions fail on the old header.
export const solidSurface = <SiteHeader brand="Acme" surface="solid" tone="base" />;
export const transparentSurface = <SiteHeader brand="Acme" surface="transparent" tone="inverse" />;
export const glassSurface = <SiteHeader brand="Acme" surface="glass" tone="inverse" />;
export const stickySurface = <SiteHeader brand="Acme" surface="solid" position="sticky" />;
export const staticSurface = <SiteHeader brand="Acme" surface="transparent" position="static" />;
// @ts-expect-error fixed is the glass mechanism, not a selectable position member
export const invalidPosition = <SiteHeader brand="Acme" position="fixed" />;
// @ts-expect-error ground is removed from SiteHeader
export const staleHeaderGround = <SiteHeader brand="Acme" ground="inverse" />;
// @ts-expect-error placement is removed from SiteHeader
export const staleHeaderPlacement = <SiteHeader brand="Acme" placement="overlay" />;
// @ts-expect-error the separate secondary-action slot is removed
export const staleHeaderSecondary = <SiteHeader brand="Acme" secondaryAction="Sign in" />;
// @ts-expect-error the text surface badge is removed
export const staleHeaderBadge = <SiteHeader brand="Acme" surfaceLabel="Admin" />;
// @ts-expect-error only one responsive header layout exists
export const staleHeaderMobileLayout = <SiteHeader brand="Acme" mobileLayout="inline" />;
// @ts-expect-error surface accepts only solid, transparent and glass
export const unknownSurface = <SiteHeader brand="Acme" surface="opaque" />;

// @ts-expect-error the old placement type is not a public alias
import type { SiteHeaderPlacement as OldRootPlacement } from "../../index.js";
// @ts-expect-error the old placement type is not a shell alias
import type { SiteHeaderPlacement as OldShellPlacement } from "../index.js";
// @ts-expect-error the old placement type is not a server alias
import type { SiteHeaderPlacement as OldServerPlacement } from "../server.js";

export type RemovedPlacementAliases = [OldRootPlacement, OldShellPlacement, OldServerPlacement];
