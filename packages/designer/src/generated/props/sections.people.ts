// Generated from sections.people by src/generated/props/generate.ts; do not edit.
export const peopleContractSha256 = "baeb2862a1707f69ed8dade1dab4a6630247207e4530a3adcf1fdd75f3bc06fa";

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
