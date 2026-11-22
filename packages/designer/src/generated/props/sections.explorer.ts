// Generated from sections.explorer by src/generated/props/generate.ts; do not edit.
export const explorerContractSha256 = "832293ea856f23ea980296d7a4997e4da882999ab2a38c8cb0c25e8ec686adf1";

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
