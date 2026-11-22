// Generated from sections.people by src/generated/props/generate.ts; do not edit.
export const peopleContractSha256 = "661b4ab3479a24c75810d57d9424c2b8c61a86cf42a65392f812993bd6c33310";

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
