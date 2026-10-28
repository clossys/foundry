/** Count visible Unicode characters without trimming authored inline spacing. */
export function proseParagraphTextLength(paragraph: readonly { text: string }[]): number {
  return paragraph.reduce((length, span) => length + [...span.text].length, 0);
}
