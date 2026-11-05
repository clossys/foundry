import type { DesignerReceipt } from "../../library-cli/write-receipt.js";

export interface DesignerHistoryRow { index: number; command: string; contentHash: string; inputs: Readonly<Record<string, unknown>> }
export function designerWriteHistory(receipt: DesignerReceipt | undefined, leaf: string): readonly DesignerHistoryRow[] {
  return (receipt?.writes ?? []).flatMap((write, index) => {
    const changes = write.inputs.changes;
    const matches = write.inputs.leaf === leaf || Array.isArray(changes) && changes.some(row => row && typeof row === "object" && row.slot === leaf);
    return matches ? [{ index, command: write.command, contentHash: write.contentHash, inputs: write.inputs }] : [];
  }).reverse();
}
