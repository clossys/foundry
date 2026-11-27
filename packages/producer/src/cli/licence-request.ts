/**
 * CP1-REFS (c): the one line a consumer reads under a `source.ref` licence failure on an `original` asset (a brand mark
 * the consumer owns). The standard's licence list, the requirement data and the criterion stay as they are; the line
 * only names what the standard takes and the verb that asks the owner for another licence. Whether a consumer's own
 * mark may carry a licence outside that list is the owner's call, never this text's.
 */
const LICENCE_FINDING = /source\.ref: meta\.source\.license (.+?) is not one of (.+?)(?:;|$)/;

/** The request line for `<agent>/<slot>`'s refused submit, or undefined when no finding is a licence failure of an original. */
export function licenceRequestLine(target: string, kind: string | undefined, findings: readonly string[]): string | undefined {
  if (kind !== "original") return undefined;
  const match = findings.map(each => LICENCE_FINDING.exec(each)).find(Boolean);
  if (!match) return undefined;
  const takes = match[2]!.split(/,\s*/).join(" or ");
  return `licence: the standard takes ${takes} for the mark file (meta.source.license, now ${match[1]}); to use another licence, ask the owner with clossys request --kind change --subject ${target} --from ${target} --why "<the licence the mark needs, and why>"`;
}
