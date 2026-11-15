/**
 * Exported Director types (target format, ia-target director.md 9.2).
 *
 * A Director slot's contract: the question its brief asks, one `## <Key>` section per mustContain key in every
 * candidate (refs read a key as `:Key`), and the forbid list the director-boundary check enforces (no measurable
 * style values, no agent step order, no model or seat names).
 */
export interface DirectorContract {
  question: string;
  mustContain: { key: string; hint: string }[];
  forbid: string[];
}

/** The three Director L0s: coverage ownership (director.md 1). */
export type DirectorL0 = "strategy" | "roadmap" | "execution";

/** `starter` = read by a v0 starter slot and shipped with a package template; `other-live` = live, no template. */
export type DirectorSlotMark = "starter" | "other-live";

/** One Director L3 slot as the package tree places it. Ids are permanent; l0/l1/l2 grouping lives in ia data. */
export interface DirectorSlot {
  id: string;
  l0: DirectorL0;
  l1: string;
  l2: string;
  label: string;
  mark: DirectorSlotMark;
  brief?: DirectorContract;
  /** Director slots this slot reads (the catalog cell links). */
  uses: string[];
}

/** A retired Director id: it never comes back as a live slot (`retired.json`). */
export interface DirectorRetired {
  id: string;
  fate: "merged" | "removed";
  target?: string;
  retiredAt: string;
  decidedBy: string;
  reason: string;
}
