"use client";
/** The frame owns centering, truncation tooltip and responsive title-menu composition. */
export function StudioTitle({ title }: { title: string }) {
  return <h1 className="min-w-0 truncate text-body font-semibold">{title}</h1>;
}
