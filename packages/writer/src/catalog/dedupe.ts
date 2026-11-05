import type { StringRecord } from "../model/types.js";

export interface StringSplit { recordIds: readonly string[]; reason: string }
export interface DuplicateTextFinding { leaf: string; text: string; recordIds: string[] }

/** One text per leaf; an intentional semantic split needs an explicit reason. */
export function checkStringDuplicates(records: readonly StringRecord[], splits: readonly StringSplit[] = []): DuplicateTextFinding[] {
  const groups = new Map<string, StringRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.leaf, record.text]);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].filter(group => group.length > 1).flatMap(group => {
    const recordIds = group.map(record => record.id).sort();
    const declared = splits.some(split => split.reason.trim().length > 0 &&
      split.recordIds.length === recordIds.length && new Set(split.recordIds).size === recordIds.length &&
      [...split.recordIds].sort().every((id, index) => id === recordIds[index]));
    return declared ? [] : [{ leaf: group[0]!.leaf, text: group[0]!.text, recordIds }];
  });
}
