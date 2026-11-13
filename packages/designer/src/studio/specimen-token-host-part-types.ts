import type { ReactNode } from 'react';

/** Token references carry selected member identities, never authored CSS or resolved values. */
export interface SpecimenSwatchHostRequest {
  readonly memberId: string;
  readonly mode: 'light' | 'dark';
}
export interface SpecimenContrastHostRequest {
  readonly backgroundMemberId: string;
  readonly colorMemberId: string;
  readonly pairMemberId: string;
  readonly mode: 'light' | 'dark';
  readonly children: ReactNode;
}
/** Studio infrastructure parts; these identities do not introduce design leaves. */
export interface SpecimenTokenHostParts {
  readonly 'studio.specimen-swatch'?: (input: SpecimenSwatchHostRequest) => ReactNode;
  readonly 'studio.specimen-contrast'?: (input: SpecimenContrastHostRequest) => ReactNode;
}
