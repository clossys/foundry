import type { PresenceInstallation, PresenceSubjectKind } from "./types.js";

const zeroSpend: PresenceInstallation["paidSpendCeiling"] = 0;
const organization: PresenceSubjectKind = "organization";
void zeroSpend;
void organization;

// @ts-expect-error V1 has no positive paid-spend authority.
const paidSpend: PresenceInstallation["paidSpendCeiling"] = 1;
// @ts-expect-error This role manages declared organizational/product presence, never a synthetic person.
const syntheticPerson: PresenceSubjectKind = "person";
void paidSpend;
void syntheticPerson;
