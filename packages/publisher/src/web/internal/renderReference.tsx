import type { ReactElement } from "react";

/** The same caller-labelled diagnostic line for the live status and error surfaces. */
export function renderReference(reference: { label: string; value: string } | null | undefined): ReactElement | null {
  if (reference == null) return null;
  if (typeof reference.label !== "string" || reference.label.trim().length === 0) {
    throw new TypeError("StatusView: reference needs a nonblank label.");
  }
  if (typeof reference.value !== "string" || reference.value.trim().length === 0) {
    throw new TypeError("StatusView: reference needs a nonblank value.");
  }
  return (
    <span className="block text-body-s text-ink-secondary">
      {reference.label}: <code className="select-all">{reference.value}</code>.
    </span>
  );
}
