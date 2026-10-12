import type { ReactElement } from "react";

/** The same caller-labelled diagnostic line for the live status and error surfaces. */
export function renderReference(reference: { label: string; value: string } | undefined): ReactElement | null {
  if (reference === undefined) return null;
  return (
    <span className="block text-body-s text-ink-secondary">
      {reference.label}: <code className="select-all">{reference.value}</code>.
    </span>
  );
}
