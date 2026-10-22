import { useEffect, useState } from "react";
import type { TableFilterNode } from "../table-model/index.js";

export function FilterAnnouncement({ filters, applied, resultCount, resultMessage }: { filters: readonly TableFilterNode[] | undefined; applied: number; resultCount?: number; resultMessage: (count: number) => string }) {
  const [message, setMessage] = useState("");
  // Parents may validate/copy their model on every render; draft keystrokes do not reset this timer.
  const signature = JSON.stringify(filters ?? []);
  useEffect(() => {
    if (resultCount === undefined) { setMessage(""); return; }
    const timer = setTimeout(() => setMessage(resultMessage(resultCount)), 500);
    return () => clearTimeout(timer);
  }, [signature, applied, resultCount, resultMessage]);
  return <span className="sr-only" role="status" aria-live="polite">{resultCount === undefined ? "" : message}</span>;
}
