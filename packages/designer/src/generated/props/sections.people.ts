// Generated from sections.people by src/generated/props/generate.ts; do not edit.
export const peopleContractSha256 = "ea86e09cd9a8844fae461ac120e8af522fd6397a3ced9b169838e6d6a47e6a5e";

export type PeopleCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  people: Array<{
    name: string; // label
    role?: string; // label
    initials: string; // label
  }>;
};
export type PeopleVariant = Record<string, never>;
export interface PeopleProps {
  copy: PeopleCopy;
  variant?: PeopleVariant;
}
