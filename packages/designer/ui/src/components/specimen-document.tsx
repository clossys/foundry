import type { ReactNode } from "react"

/*
 * Studio specimen documents: one pinned theme, font or component shown alone on the page ground,
 * the way the shadcn BlockViewer (apps/v4 block-viewer) shows a block in its iframe. Producer's
 * specimen pages only place these; every class and style below is this Designer file's.
 */

/** A pinned theme: its colour swatches (each pair over its foreground) and a type sample. */
export function ThemeSpecimen({ names }: { names: readonly string[] }) {
  const pairs = names.filter((name) => !name.endsWith("-foreground"))
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="font-heading text-5xl font-semibold tracking-tight">Aa Theme</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">The quick brown fox jumps over the lazy dog. 0123456789</p>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {pairs.map((name) => (
          <div key={name} className="overflow-hidden rounded-lg border">
            <div
              className="flex h-20 items-end p-2 text-sm font-medium"
              style={{ background: `var(--${name})`, color: names.includes(`${name}-foreground`) ? `var(--${name}-foreground)` : undefined }}
            >
              Aa
            </div>
            <div className="bg-card px-2 py-1.5 text-xs text-card-foreground">{name}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

const RAMP = [
  ["text-6xl", "Display"],
  ["text-5xl", "Heading 1"],
  ["text-4xl", "Heading 2"],
  ["text-3xl", "Heading 3"],
  ["text-2xl", "Heading 4"],
  ["text-xl", "Heading 5"],
  ["text-base", "Body"],
  ["text-sm", "Small"],
] as const

/** A pinned font: its type ramp, set in the font's installed CSS variable. */
export function FontSpecimen({ variable, family }: { variable: string; family: string }) {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground" style={{ fontFamily: `var(${variable})` }}>
      <p className="text-sm text-muted-foreground">{family}</p>
      <div className="mt-6 flex flex-col gap-4">
        {RAMP.map(([size, label]) => (
          <div key={label} className="flex items-baseline gap-6 border-b pb-3">
            <span className="w-24 shrink-0 font-sans text-xs text-muted-foreground">{label}</span>
            <span className={`${size} font-semibold tracking-tight`}>The quick brown fox</span>
          </div>
        ))}
      </div>
    </main>
  )
}

/**
 * One component centred on the page ground, in its slot's declared specimen state. In the
 * `visible` state its screen-reader-only text shows (Tailwind's stock `not-sr-only`).
 */
export function ComponentSpecimen({ state = "rest", children }: { state?: string; children?: ReactNode }) {
  return (
    <main
      data-specimen-state={state}
      className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground data-[specimen-state=visible]:[&_.sr-only]:not-sr-only"
    >
      {children}
    </main>
  )
}
