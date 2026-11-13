/** Internal page cadence; authored and resolved records share only these structural fields. */
export type ContentGround = "base" | "sunken" | "inverse";
export interface GroundSection { readonly id: string; readonly kind: string; readonly ground?: ContentGround }
export interface GroundDocument { readonly sections: readonly GroundSection[]; readonly viewGrounds?: readonly string[]; readonly sectionGroundRhythm?: "view" | "base-then-sunken" }
export interface ContentGroundBand { id: string; role: "hero" | "band" | "closing" | "call-to-action"; ground: ContentGround; assigned: boolean; documentIndex: number; sectionIndex: number }
export interface ContentGroundPlan { bands: ContentGroundBand[]; repeats: { above: string; below: string; ground: ContentGround }[] }

/** The last automatic body defaults to base; an explicit body ground anchors the upward recurrence. */
export function planContentGrounds(documents: readonly GroundDocument[], options: { callToAction?: boolean | { id?: string } } = {}): ContentGroundPlan {
  const candidates = documents.flatMap((document, documentIndex) => document.sections.map((section, sectionIndex) => ({
    section, documentIndex, sectionIndex,
    hero: documentIndex === 0 && sectionIndex === 0 && section.kind === "hero",
    automatic: document.viewGrounds?.includes(section.id) === true || section.ground === undefined && (section.kind === "content-section" || document.sectionGroundRhythm === "view"),
    ground: section.ground ?? (section.kind !== "content-section" && document.sectionGroundRhythm === "base-then-sunken" && sectionIndex % 2 === 1 ? "sunken" as const : "base" as const),
  })));
  const body = candidates.filter(candidate => !candidate.hero);
  const hasClose = options.callToAction !== undefined && options.callToAction !== false;
  const bands: ContentGroundBand[] = new Array(body.length);
  let below: ContentGround | undefined;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const candidate = body[index]!;
    const closing = hasClose && index === body.length - 1;
    const legacyClose = closing && candidate.section.kind !== "content-section";
    const ground = legacyClose ? "base" : !candidate.automatic ? candidate.ground : below === undefined ? "base" : below === "base" ? "sunken" : "base";
    bands[index] = { id: candidate.section.id, role: closing ? "closing" : "band", ground, assigned: legacyClose || candidate.automatic, documentIndex: candidate.documentIndex, sectionIndex: candidate.sectionIndex };
    below = ground;
  }
  const hero = candidates.find(candidate => candidate.hero);
  if (hero !== undefined) bands.unshift({ id: hero.section.id, role: "hero", ground: hero.ground, assigned: false, documentIndex: hero.documentIndex, sectionIndex: hero.sectionIndex });
  if (hasClose) bands.push({ id: typeof options.callToAction === "object" ? options.callToAction.id ?? "call-to-action" : "call-to-action", role: "call-to-action", ground: "inverse", assigned: true, documentIndex: -1, sectionIndex: -1 });
  const repeats: ContentGroundPlan["repeats"] = [];
  for (let index = 1; index < bands.length; index += 1) {
    const above = bands[index - 1]!, current = bands[index]!;
    if (above.ground === current.ground) repeats.push({ above: above.id, below: current.id, ground: current.ground });
  }
  return { bands, repeats };
}

/** Apply by document position, retaining source objects and provenance whenever no ground changed. */
export function applyContentGrounds<T extends GroundDocument>(plan: ContentGroundPlan, documents: readonly T[]): T[] {
  const grounds = new Map(plan.bands.filter(band => band.role !== "call-to-action").map(band => [`${band.documentIndex}:${band.sectionIndex}`, band.ground]));
  return documents.map((document, documentIndex) => {
    const sections = document.sections.map((section, sectionIndex) => {
      const ground = grounds.get(`${documentIndex}:${sectionIndex}`);
      return ground === undefined || ground === section.ground ? section : { ...section, ground };
    });
    return sections.every((section, index) => section === document.sections[index]) ? document : { ...document, sections };
  }) as T[];
}
