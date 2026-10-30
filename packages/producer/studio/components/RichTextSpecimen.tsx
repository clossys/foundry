'use client';
import type { RichTextValue } from '@clossys/designer/components';
import { RichText } from './director-specimen-ds';

/** All Studio documents use the selected Designer document leaf in read-only mode. */
export function RichTextSpecimen({ value, readOnly }: { value: RichTextValue; readOnly: true }) {
  return <RichText value={value} readOnly={readOnly} />;
}
