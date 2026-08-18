/**
 * Managed blocks: a region this engine owns inside a file it does not.
 *
 * A shell startup file belongs to its operator. Provisioning needs to
 * contribute a few lines to it without claiming the whole file, and must be
 * able to update those lines later without disturbing anything around them.
 * Markers make that region addressable; everything here is pure string work so
 * the tricky cases are testable without a filesystem.
 */

export function renderManagedBlock(body: string, startMarker: string, endMarker: string): string {
  return `${startMarker}\n${body.trim()}\n${endMarker}`;
}

/**
 * Return the file's content with the managed region removed.
 *
 * Refuses on malformed or duplicated markers rather than guessing. Guessing
 * here means picking one of two blocks to overwrite and silently discarding
 * whatever sat between them -- in a file the engine does not own.
 */
export function withoutManagedBlock(
  contents: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker);

  if (start === -1 && end === -1) return contents.trimEnd();
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Malformed managed block markers");
  }
  if (
    contents.indexOf(startMarker, start + startMarker.length) !== -1 ||
    contents.indexOf(endMarker, end + endMarker.length) !== -1
  ) {
    throw new Error("Duplicate managed block markers");
  }

  return `${contents.slice(0, start)}${contents.slice(end + endMarker.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * The exact content the destination should hold: whatever the operator already
 * had, then the managed block.
 *
 * `legacyBody` handles a migration this engine will keep meeting: a destination
 * that was once the source file itself, wholesale, before markers existed. Left
 * alone, that content would be treated as the operator's own and preserved
 * above the new block, duplicating every line. Recognising it lets the block
 * replace it exactly once.
 */
export function composeManagedBlock(
  existing: string,
  body: string,
  startMarker: string,
  endMarker: string,
  legacyBody?: string,
): string {
  const block = renderManagedBlock(body, startMarker, endMarker);
  const isLegacyWholesaleCopy =
    legacyBody !== undefined && existing.trim() === legacyBody.trim() && existing.trim() !== "";
  const base = isLegacyWholesaleCopy ? "" : withoutManagedBlock(existing, startMarker, endMarker);
  return `${base ? `${base}\n\n` : ""}${block}\n`;
}

/**
 * Whether the destination holds exactly one well-formed copy of the expected
 * block. Counting is the point: a file containing the right block twice is not
 * "installed", it is a file that will export the same lines twice.
 */
export function hasExactlyOneBlock(
  contents: string,
  body: string,
  startMarker: string,
  endMarker: string,
): boolean {
  const expected = renderManagedBlock(body, startMarker, endMarker);
  const startCount = contents.split(startMarker).length - 1;
  const endCount = contents.split(endMarker).length - 1;
  return startCount === 1 && endCount === 1 && contents.includes(expected);
}
