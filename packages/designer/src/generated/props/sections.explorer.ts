// Generated from sections.explorer by src/generated/props/generate.ts; do not edit.
export const explorerContractSha256 = "3c0376f10981d9187dc70e6710456ebe1785df1507adf25de83a68d86a3723dc";

export type ExplorerCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  tree: {
    label: string; // label
    nodes: Array<{
      label: string; // label
      description?: string; // body
    }>;
  };
  list: {
    label: string; // label
    items: Array<{
      label: string; // label
    }>;
  };
  labels?: {
    details?: string; // label
  };
};
export type ExplorerVariant = Record<string, never>;
export interface ExplorerProps {
  copy: ExplorerCopy;
  variant?: ExplorerVariant;
}
