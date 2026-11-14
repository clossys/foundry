/**
 * The rule registry `clossys rule` writes, relative to the repository root. A leaf module: owner.ts and the
 * owner wiring check (which owner.ts reaches through the pipeline steps) both read it, so neither import order
 * can see it uninitialized.
 */
export const RULES_FILE = "scripts/rules/registry.json";
