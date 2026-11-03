import { Badge, CardDescription, CardTitle, Field, FieldContent, FieldDescription, FieldGroup, FieldTitle, LinkButton, Separator } from '@clossys/designer-ui';

export type ModuleCheckTone = 'secondary' | 'outline' | 'destructive';

/** One finding: a failing check, a pending option or an open need, with where it lives. */
export interface ModuleCheckRow { id: string; badge: string; tone: ModuleCheckTone; title: string; detail?: string; href?: string; openLabel?: string }
export interface ModuleCheckGroup { id: 'failing' | 'options' | 'needs'; label: string; empty: string; rows: readonly ModuleCheckRow[] }

/** The `checks` input of `sections.module.checks`: the open page's findings, display-ready. */
export interface ModuleChecksInput { summary: string; groups: readonly ModuleCheckGroup[] }

/**
 * `sections.module.checks`: what needs attention on the open page, as shadcn item rows in three
 * groups: failing checks, pending options and open needs. Read-only: each row links to its leaf.
 */
export default function ModuleChecksSection({ checks, ...provenance }: { checks: ModuleChecksInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <FieldGroup {...provenance} className="gap-4">
    <CardDescription>{checks.summary}</CardDescription>
    {checks.groups.map((group, index) => <FieldGroup key={group.id} data-module-checks-group={group.id} className="gap-2">
      {index > 0 && <Separator />}
      <CardTitle role="heading" aria-level={3} className="flex items-center gap-2 text-sm">{group.label}<Badge variant="ghost" className="tabular-nums">{group.rows.length}</Badge></CardTitle>
      {group.rows.length
        ? group.rows.map(row => <Field key={row.id} data-module-check={row.id} className="gap-1">
          <FieldContent className="gap-1">
            <FieldTitle className="flex-wrap"><Badge variant={row.tone}>{row.badge}</Badge>{row.title}</FieldTitle>
            {row.detail && <FieldDescription className="text-xs leading-relaxed">{row.detail}</FieldDescription>}
            {row.href && <LinkButton variant="link" size="xs" href={row.href} className="h-auto self-start p-0">{row.openLabel ?? row.title}</LinkButton>}
          </FieldContent>
        </Field>)
        : <FieldDescription>{group.empty}</FieldDescription>}
    </FieldGroup>)}
  </FieldGroup>;
}
