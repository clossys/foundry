/** Studio infrastructure identities are separate from consumer design leaves. */
export const STUDIO_SPECIMEN_HOST_PARTS = {
  'studio.specimen-swatch': {
    module: '@clossys/designer/studio',
    export: 'renderSpecimenSwatchHostPart',
    source: 'studio/specimen-token-host-parts.tsx',
    tokenInputs: ['memberId'],
    styleProperties: ['background'],
  },
  'studio.specimen-contrast': {
    module: '@clossys/designer/studio',
    export: 'renderSpecimenContrastHostPart',
    source: 'studio/specimen-token-host-parts.tsx',
    tokenInputs: ['backgroundMemberId', 'colorMemberId', 'pairMemberId'],
    styleProperties: ['background', 'color'],
  },
} as const;
export type StudioSpecimenHostPartId = keyof typeof STUDIO_SPECIMEN_HOST_PARTS;
