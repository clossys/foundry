import { useEffect, useState } from "react";
import type { AccessMatrixProps, AccessMatrixValue } from "../AccessMatrix.js";
import { accessCell } from "./validate.js";

export function accessSummary(roles: AccessMatrixProps["roles"], groups: AccessMatrixProps["groups"], value: AccessMatrixValue, baseline: AccessMatrixValue): { grants: number; revokes: number } {
  let grants = 0, revokes = 0;
  for (const role of roles) for (const group of groups) for (const permission of group.permissions) {
    const next = accessCell(value, role.id, permission.id), before = accessCell(baseline, role.id, permission.id);
    if (next?.state === "inherited" || before?.state === "inherited") continue;
    if (next?.state === "granted" && before?.state !== "granted") grants++;
    if (before?.state === "granted" && next?.state !== "granted") revokes++;
  }
  return { grants, revokes };
}

export function useDebouncedSummary(text: string): string {
  const [announced, setAnnounced] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(text), 500);
    return () => clearTimeout(timer);
  }, [text]);
  return announced;
}
