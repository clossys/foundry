// A whole-comment line: var(--not-declared-anywhere, inherit) is skipped.
/**
 * A doc block line: var(--not-declared-anywhere, inherit) is skipped too.
 */
/* var(--not-declared-anywhere, inherit) */

const x = "var(--not-declared-anywhere, inherit)"; // note

export default function Page() {
  return <div style={{ color: x }} />;
}
