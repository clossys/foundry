/**
 * Compile-time proof for the flags extension of the PostHog adapter's
 * configuration and handle types (P-45, P-52).
 *
 * Named `*.check.ts`, not `*.test.ts`, so it is part of the real `tsc` run
 * (`npm run typecheck`) and fails the build when a type regresses. Nothing
 * imports it at runtime.
 *
 * What it proves:
 * - `PostHogProviderConfig` takes an optional `flags` block, and a
 *   configuration without one still type-checks;
 * - the block is closed to `enabled`, `purpose` and `definitions`, and has no
 *   bootstrap map; a definition is closed to `control` and `variants`;
 * - the returned provider carries the `flags` handle, whose lookup takes and
 *   returns only a boolean or a string;
 * - the evidence probe reports exactly the five capability fields.
 *
 * Each `@ts-expect-error` line fails the build if the line below it starts
 * to type-check.
 */

import type {
  PostHogFlagDefinition,
  PostHogFlagsCapability,
  PostHogFlagsConfig,
  PostHogFlagsHandle,
  PostHogFlagValue,
  PostHogProvider,
  PostHogProviderConfig,
} from "./providers/posthog.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// A configuration without flags, and one with them, type-check.
export const minimal: PostHogProviderConfig = { key: "k", apiHost: "https://analytics.example.test" };
export const withFlags: PostHogProviderConfig = {
  key: "k",
  apiHost: "https://analytics.example.test",
  flags: {
    enabled: true,
    purpose: "experiments",
    definitions: { "hero-copy": { control: "control", variants: ["control", "short"] }, "new-nav": { control: false, variants: [false, true] } },
  },
};

// The block and a definition are closed sets of keys.
export const flagsKeysAreClosed: Equal<keyof PostHogFlagsConfig, "enabled" | "purpose" | "definitions"> = true;
export const definitionKeysAreClosed: Equal<keyof PostHogFlagDefinition, "control" | "variants"> = true;
export const valuesAreBooleanOrString: Equal<PostHogFlagValue, boolean | string> = true;
export const capabilityFields: Equal<
  keyof PostHogFlagsCapability,
  "holdsRequestsWhileDisabled" | "retainedOptionsStartNoRequest" | "requestCarriesNoPersonData" | "evaluatesOnReload" | "clearsFlagCache"
> = true;
export const handleMembers: Equal<keyof PostHogFlagsHandle, "purpose" | "attest" | "setExperimentsPermission" | "lookup" | "subscribe"> = true;

// No bootstrap map, on the block or beside it.
export const bootstrapOnBlock: PostHogFlagsConfig = {
  enabled: true,
  purpose: "experiments",
  definitions: {},
  // @ts-expect-error the flags block has no bootstrap map (C-78).
  bootstrap: { "hero-copy": "short" },
};
export const bootstrapBeside: PostHogProviderConfig = {
  key: "k",
  apiHost: "https://analytics.example.test",
  // @ts-expect-error the configuration has no bootstrap map (C-78).
  bootstrap: { featureFlags: { "hero-copy": "short" } },
};

// A definition carries no rollout, payload or other key.
export const rollout: PostHogFlagDefinition = {
  control: true,
  variants: [true, false],
  // @ts-expect-error a definition is `control` and `variants` only.
  rollout: 50,
};
// @ts-expect-error a variant is a boolean or a string.
export const numericVariant: PostHogFlagDefinition = { control: 1, variants: [1, 2] };
// @ts-expect-error `purpose` is required.
export const noPurpose: PostHogFlagsConfig = { enabled: true, definitions: {} };

// The provider carries the handle; its lookup returns a flag value.
export function lookupType(provider: PostHogProvider): PostHogFlagValue {
  const handle: PostHogFlagsHandle = provider.flags;
  // @ts-expect-error the control is a boolean or a string.
  handle.lookup("hero-copy", 1);
  return handle.lookup("hero-copy", "control");
}
