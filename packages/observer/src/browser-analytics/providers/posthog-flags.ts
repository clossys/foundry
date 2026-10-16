/**
 * Feature flags and experiments for the PostHog adapter (unit H, C-71 to
 * C-79): an optional, closed `flags` block and a lookup handle bound to a
 * separately named experiments purpose.
 *
 * The handle uses the SDK instance the analytics transport already
 * initialized and starts no loader of its own. Flag work runs only while
 * three conditions hold together (C-72): that instance exists, its capture
 * gate is open, and the host has granted the experiments purpose. On top of
 * them the host must attest, from its own evidence for the SDK version it
 * installed, that the SDK's flag requests behave as C-73 requires; without a
 * passing attestation every lookup returns control and nothing is requested.
 *
 * Assignments live in memory only (C-77). Server bootstrap is not accepted
 * (C-78). Importing this module performs no I/O and reads no global (C-1).
 */

import { MAX_PROPERTY_STRING_LENGTH } from "../sanitize.js";

/** A flag value: a boolean flag or a string variant. */
export type PostHogFlagValue = boolean | string;

/** One declared flag: its control and every variant the host renders. */
export interface PostHogFlagDefinition {
  control: PostHogFlagValue;
  variants: readonly PostHogFlagValue[];
}

/** The flags block (C-71). It has these three keys and no other. */
export interface PostHogFlagsConfig {
  enabled: boolean;
  /** The host's experiments-purpose name, distinct from its analytics purpose. */
  purpose: string;
  /** The closed allowlist of flag keys and their variants (C-74). */
  definitions: Readonly<Record<string, PostHogFlagDefinition>>;
}

/**
 * What the host's evidence shows about flag requests for the SDK version it
 * installed (C-73, C-77). Each field must be exactly `true`; anything
 * unproven is `false`, and flags then stay at control.
 */
export interface PostHogFlagsCapability {
  /** With both feature-flag disables `true`, no flag request is made at init, opt-in, reload or by a callback. */
  holdsRequestsWhileDisabled: boolean;
  /** Options the instance retains start no flag request while capturing is opted out, nor on opting in again. */
  retainedOptionsStartNoRequest: boolean;
  /** An evaluation request carries no person properties, groups, URL or referrer. */
  requestCarriesNoPersonData: boolean;
  /** `reloadFeatureFlags()` requests evaluation and `onFeatureFlags` reports its result. */
  evaluatesOnReload: boolean;
  /** `featureFlags.reset()` removes every assignment the SDK holds, without resetting its session. */
  clearsFlagCache: boolean;
}

/** The five capability fields, in declaration order. */
export const FLAGS_CAPABILITY_FIELDS: readonly (keyof PostHogFlagsCapability)[] = Object.freeze([
  "holdsRequestsWhileDisabled",
  "retainedOptionsStartNoRequest",
  "requestCarriesNoPersonData",
  "evaluatesOnReload",
  "clearsFlagCache",
]);

/**
 * The lookup handle. It never throws from `lookup`, and before the three
 * conditions of C-72 hold, while evaluation is pending and after any failure
 * it returns control and sends nothing.
 */
export interface PostHogFlagsHandle {
  /** The experiments-purpose name from the flags block, or `null` when there is no valid block. */
  readonly purpose: string | null;
  /**
   * Supplies the host's evidence probe. Call it once, in the loader, before
   * the transport initializes the adapter. A later or second call, or a
   * non-function, leaves flags at control for the page load.
   */
  attest(probe: () => PostHogFlagsCapability): void;
  /** The separate experiments-purpose permission. It starts `false`; only an explicit `true` grants. */
  setExperimentsPermission(allowed: boolean): void;
  /** The validated variant for a declared key in the current eligible grant, otherwise control. */
  lookup(key: string, control: PostHogFlagValue): PostHogFlagValue;
  /** Called after an evaluation result arrives or flag state is cleared. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** The only properties an exposure keeps besides the delivery and URL fields (C-75). */
export const POSTHOG_FLAG_EXPOSURE_PROPERTIES: readonly string[] = Object.freeze(["$feature_flag", "$feature_flag_response"]);

/** The one exposure event name (C-75). */
export const POSTHOG_FLAG_EXPOSURE_EVENT = "$feature_flag_called";

/** A flag key, and the experiments-purpose name (C-74). */
export const FLAG_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** The two options flags may change, and only to these values while eligible (C-64). */
export const FLAGS_ENABLE_OPTIONS: Readonly<Record<string, boolean>> = Object.freeze({
  advanced_disable_feature_flags: false,
  advanced_disable_feature_flags_on_first_load: false,
});

/** The values those options are restored to when experiments is withdrawn with analytics open (C-77). */
export const FLAGS_DISABLE_OPTIONS: Readonly<Record<string, boolean>> = Object.freeze({
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
});

/** What the adapter reads from the flags block, after validation. */
export interface FlagsSettings {
  enabled: boolean;
  purpose: string | null;
  definitions: ReadonlyMap<string, Readonly<{ control: PostHogFlagValue; variants: readonly PostHogFlagValue[] }>>;
}

const FLAGS_KEYS: readonly string[] = ["enabled", "purpose", "definitions"];
const DEFINITION_KEYS: readonly string[] = ["control", "variants"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Reads one own data property; an accessor or a missing property throws. */
function readData(record: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`The PostHog flags ${label} must be plain data.`);
  }
  return descriptor.value;
}

/** Copies a plain-data object after checking its keys; accessors and symbols are refused. */
function readClosed(value: unknown, label: string, allowed: readonly string[] | null): Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`The PostHog flags ${label} must be a plain object.`);
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (allowed !== null && !allowed.includes(key))) {
      throw new TypeError(`The PostHog flags ${label} has no key named ${String(key)}.`);
    }
    out[key] = readData(value, key, label);
  }
  return out;
}

function isFlagValue(value: unknown): value is PostHogFlagValue {
  return (
    typeof value === "boolean" ||
    (typeof value === "string" && value !== "" && value.length <= MAX_PROPERTY_STRING_LENGTH)
  );
}

function readVariants(value: unknown, key: string): readonly PostHogFlagValue[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) {
    throw new TypeError(`The PostHog flag ${key} needs a non-empty array of variants.`);
  }
  for (const name of Reflect.ownKeys(value)) {
    if (name === "length") continue;
    if (typeof name !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length) {
      throw new TypeError(`The PostHog flag ${key} variants must be a plain array.`);
    }
  }
  const variants: PostHogFlagValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const variant = readData(value, String(index), `${key} variants`);
    if (!isFlagValue(variant)) {
      throw new TypeError(
        `Each PostHog flag variant must be a boolean or a non-empty string of at most ${MAX_PROPERTY_STRING_LENGTH} characters.`,
      );
    }
    if (variants.includes(variant)) throw new TypeError(`The PostHog flag ${key} declares a variant twice.`);
    variants.push(variant);
  }
  return Object.freeze(variants);
}

/**
 * Validates the flags block (C-63, C-71, C-74). A missing block is off. A
 * block that is not plain data, has a key outside its type, an accessor, a
 * non-boolean `enabled`, an empty or malformed `purpose`, a malformed key, an
 * invalid or duplicate variant, or a control that is not one of its variants
 * throws a `TypeError`.
 */
export function readFlagsSettings(flags: unknown): FlagsSettings {
  if (flags === undefined) return { enabled: false, purpose: null, definitions: new Map() };
  const block = readClosed(flags, "option", FLAGS_KEYS);
  if (typeof block.enabled !== "boolean") throw new TypeError("The PostHog flags option needs a boolean enabled.");
  const purpose = block.purpose;
  if (typeof purpose !== "string" || !FLAG_KEY_PATTERN.test(purpose)) {
    throw new TypeError("The PostHog flags option needs an experiments purpose name.");
  }
  const entries = readClosed(block.definitions, "definitions", null);
  const definitions = new Map<string, Readonly<{ control: PostHogFlagValue; variants: readonly PostHogFlagValue[] }>>();
  for (const key of Object.keys(entries)) {
    if (!FLAG_KEY_PATTERN.test(key)) throw new TypeError(`The PostHog flag key ${key} is malformed.`);
    const definition = readClosed(entries[key], `definition ${key}`, DEFINITION_KEYS);
    const variants = readVariants(definition.variants, key);
    const control = definition.control;
    if (!isFlagValue(control) || !variants.includes(control)) {
      throw new TypeError(`The PostHog flag ${key} control must be one of its variants.`);
    }
    definitions.set(key, Object.freeze({ control, variants }));
  }
  return { enabled: block.enabled, purpose, definitions };
}

/** The SDK members flag work calls. All optional: a missing one leaves flags at control. */
export interface PostHogFlagsSdk {
  set_config?(config: Record<string, unknown>): void;
  reloadFeatureFlags?(): void;
  onFeatureFlags?(callback: (flags: unknown, variants: unknown, context?: unknown) => void): unknown;
  readonly featureFlags?: { reset?(): void };
}

/** What the adapter gives the flags controller. */
export interface FlagsLink {
  /** The instance the transport initialized, or `null` before `init`. */
  instance(): PostHogFlagsSdk | null;
  /** Whether the analytics capture gate (C-67) is open. */
  gateOpen(): boolean;
  /** Sends one exposure through the adapter's own capture, marked for the hook. */
  sendExposure(key: string, value: PostHogFlagValue, flagsGeneration: number): void;
}

export interface FlagsController {
  readonly handle: PostHogFlagsHandle;
  /** At the end of `init`: the probe is called once. */
  afterInit(): void;
  /** After the capture gate opens for a grant. */
  afterGateOpened(): void;
  /** In step 1 of a withdrawal, before any SDK call: local state only, no SDK call. */
  closeForAnalytics(): void;
  /** After a withdrawal's stop steps have run: listeners learn that state was cleared. */
  afterAnalyticsClosed(): void;
  /** Whether an exposure marked with this generation may pass the hook now. */
  admitsExposure(flagsGeneration: number): boolean;
}

function swallow(call: () => void): boolean {
  try {
    call();
    return true;
  } catch {
    return false;
  }
}

/** Creates the flags controller for one adapter. Nothing runs until the adapter calls it. */
export function createFlagsController(settings: FlagsSettings, link: FlagsLink): FlagsController {
  let initDone = false;
  let probe: (() => unknown) | null = null;
  let offForPage = false;
  let attested = false;
  let evidenceHolds = false;

  let experimentsGranted = false;
  let generation = 0;
  let active = false;
  let requested = false;
  let cleaning = false;
  let assignments: Map<string, PostHogFlagValue> | null = null;
  let exposed = new Set<string>();
  let unsubscribe: unknown = null;

  /** Set once evaluation options were changed; the SDK may then hold flag state. */
  let sdkTouched = false;
  /** SDK-held flag state that must be cleared before evaluation resumes (C-77). */
  let sdkUntrusted = false;

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) swallow(listener);
  }

  function probePasses(): boolean {
    if (probe === null) return false;
    try {
      const report: unknown = probe();
      if (report === null || typeof report !== "object") return false;
      if (typeof (report as { then?: unknown }).then === "function") return false;
      const fields = report as Record<string, unknown>;
      return FLAGS_CAPABILITY_FIELDS.every((field) => fields[field] === true);
    } catch {
      return false;
    }
  }

  function eligible(): boolean {
    return (
      settings.enabled &&
      !offForPage &&
      evidenceHolds &&
      experimentsGranted &&
      link.instance() !== null &&
      link.gateOpen()
    );
  }

  /** Closes flag work locally and synchronously; returns the callback unsubscriber, which is not called here. */
  function closeLocal(): unknown {
    generation += 1;
    active = false;
    requested = false;
    assignments = null;
    exposed = new Set();
    const pendingUnsubscribe = unsubscribe;
    unsubscribe = null;
    return pendingUnsubscribe;
  }

  function onResult(grant: number, variants: unknown, context: unknown): void {
    if (grant !== generation || !active || !requested || !eligible()) return;
    if (context !== null && typeof context === "object") {
      const failed = Object.getOwnPropertyDescriptor(context, "errorsLoading");
      if (failed !== undefined && (!("value" in failed) || failed.value !== false)) return;
    }
    if (!isPlainObject(variants)) return;
    const next = new Map<string, PostHogFlagValue>();
    for (const [key, definition] of settings.definitions) {
      const descriptor = Object.getOwnPropertyDescriptor(variants, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      const value: unknown = descriptor.value;
      if (isFlagValue(value) && definition.variants.includes(value)) next.set(key, value);
    }
    assignments = next;
    notify();
  }

  function start(): void {
    if (active || cleaning || !eligible()) return;
    const target = link.instance();
    if (target === null) return;
    const setConfig = target.set_config;
    const reload = target.reloadFeatureFlags;
    const onFlags = target.onFeatureFlags;
    if (typeof setConfig !== "function" || typeof reload !== "function" || typeof onFlags !== "function") return;

    const grant = ++generation;
    active = true;
    requested = false;
    assignments = new Map();
    exposed = new Set();

    // SDK-held state from an earlier eligible period is cleared before any evaluation (C-77).
    if (sdkUntrusted) {
      let cleared = false;
      try {
        const flagsState = target.featureFlags;
        if (flagsState && typeof flagsState.reset === "function") {
          flagsState.reset();
          cleared = true;
        }
      } catch {
        cleared = false;
      }
      if (grant !== generation) return;
      if (!cleared) {
        active = false;
        return;
      }
      sdkUntrusted = false;
    }

    let subscribed: unknown;
    try {
      subscribed = onFlags.call(target, (_flags: unknown, variants: unknown, context?: unknown) => onResult(grant, variants, context));
    } catch {
      active = false;
      return;
    }
    if (grant !== generation) {
      // The grant moved inside the call; the subscription belongs to no grant.
      if (typeof subscribed === "function" && link.gateOpen()) swallow(() => (subscribed as () => void)());
      return;
    }
    unsubscribe = subscribed;

    sdkTouched = true;
    try {
      setConfig.call(target, { ...FLAGS_ENABLE_OPTIONS });
    } catch {
      active = false;
      return;
    }
    if (grant !== generation) return;

    requested = true;
    swallow(() => reload.call(target));
  }

  /** Experiments withdrawn while analytics stays open: clear SDK flag state and restore both disables (C-77). */
  function cleanUp(pendingUnsubscribe: unknown): void {
    const target = link.instance();
    if (target === null || !link.gateOpen()) {
      if (sdkTouched) sdkUntrusted = true;
      return;
    }
    cleaning = true;
    try {
      if (typeof pendingUnsubscribe === "function") swallow(() => (pendingUnsubscribe as () => void)());
      if (!sdkTouched) return;
      // An analytics withdrawal inside a call ends the cleanup: no flags SDK call follows it.
      if (!link.gateOpen()) {
        sdkUntrusted = true;
        return;
      }
      let cleared = false;
      try {
        const flagsState = target.featureFlags;
        if (flagsState && typeof flagsState.reset === "function") {
          flagsState.reset();
          cleared = true;
        }
      } catch {
        cleared = false;
      }
      if (!link.gateOpen()) {
        sdkUntrusted = true;
        return;
      }
      const setConfig = target.set_config;
      const restored = typeof setConfig === "function" && swallow(() => setConfig.call(target, { ...FLAGS_DISABLE_OPTIONS }));
      if (cleared && restored) {
        sdkTouched = false;
        sdkUntrusted = false;
      } else {
        sdkUntrusted = true;
      }
    } finally {
      cleaning = false;
    }
  }

  const handle: PostHogFlagsHandle = {
    purpose: settings.purpose,

    attest(candidate: () => PostHogFlagsCapability): void {
      if (initDone || attested || typeof candidate !== "function") {
        offForPage = true;
        probe = null;
        return;
      }
      attested = true;
      probe = candidate;
    },

    setExperimentsPermission(allowed: boolean): void {
      if (allowed === true) {
        if (experimentsGranted) return;
        experimentsGranted = true;
        start();
        return;
      }
      if (!experimentsGranted) return;
      experimentsGranted = false;
      const pendingUnsubscribe = closeLocal();
      cleanUp(pendingUnsubscribe);
      notify();
      // A grant that arrived during cleanup starts now.
      start();
    },

    lookup(key: string, control: PostHogFlagValue): PostHogFlagValue {
      const definition = typeof key === "string" ? settings.definitions.get(key) : undefined;
      if (definition === undefined) return control;
      // A lookup whose control differs from the declared one is a host error: declared control, nothing sent.
      if (control !== definition.control) return definition.control;
      if (!active || !eligible() || assignments === null) return definition.control;
      const value = assignments.get(key);
      if (value === undefined) return definition.control;
      const grant = generation;
      const pair = `${key}\u0000${typeof value}\u0000${String(value)}`;
      if (!exposed.has(pair)) {
        exposed.add(pair);
        link.sendExposure(key, value, grant);
      }
      return grant === generation && active && eligible() ? value : definition.control;
    },

    subscribe(listener: () => void): () => void {
      if (typeof listener !== "function") return () => {};
      const entry = () => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };

  return {
    handle,
    afterInit(): void {
      initDone = true;
      evidenceHolds = settings.enabled && !offForPage && probePasses();
      start();
    },
    afterGateOpened(): void {
      start();
    },
    closeForAnalytics(): void {
      closeLocal();
      if (sdkTouched) sdkUntrusted = true;
    },
    afterAnalyticsClosed(): void {
      notify();
    },
    admitsExposure(flagsGeneration: number): boolean {
      return flagsGeneration === generation && active && eligible();
    },
  };
}
