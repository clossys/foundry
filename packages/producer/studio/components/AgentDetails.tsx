'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLinkIcon, QuoteIcon, TerminalIcon } from 'lucide-react';
import {
  Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@clossys/designer-ui';
import type { AgentCells, CellDetail } from '../lib/cells-client';
import type { Agent } from '../lib/agents';
import { directorSections } from '../lib/director-specimen';
import { designerFill, designerLayer } from '../lib/designer-fill';
import { writerProjection } from '../lib/writer-specimen';
import { loadPublication, safePreviewUrl, selectedPublicationId, selectedPublishedPage, PUBLISH_PREVIEW_COMMAND, type PublicationResponse } from '../lib/publisher-preview';
import { humanize, presentText, sectionBullets } from '../lib/studio-text';

type Titles = ReadonlyMap<string, string>;

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="flex flex-col gap-3">
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Prose({ value, titles }: { value: string; titles: Titles }) {
  const shown = presentText(value, titles);
  return <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <span>{shown.text}</span>
    {shown.citations.length > 0 && <Badge variant="outline" className="font-normal"><QuoteIcon data-icon="inline-start" />{shown.citations.length === 1 ? '1 source' : `${shown.citations.length} sources`}</Badge>}
    {shown.ownerInput && <Badge variant="secondary">Owner input</Badge>}
  </span>;
}

const DIRECTOR_SECTIONS: Record<string, string> = {
  Direction: 'What this cell commits the business to.',
  Because: 'The reasoning and evidence behind the direction.',
  Watch: 'Signals that would change the direction.',
};

export function DirectorDetail({ detail, titles }: { detail: CellDetail; titles: Titles }) {
  const sections = directorSections(detail.content);
  if (!sections.length) return <Empty>This cell has no direction yet.</Empty>;
  return <div className="flex flex-col gap-8">
    {sections.map(section => <Section key={section.title} title={section.title} description={DIRECTOR_SECTIONS[section.title]}>
      <ul className="flex flex-col gap-3">
        {section.value.split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean).map((line, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
          <Prose value={line} titles={titles} />
        </li>)}
      </ul>
    </Section>)}
  </div>;
}

export function DesignerDetail({ detail, titles }: { detail: CellDetail; titles: Titles }) {
  const layer = designerLayer(detail.id);
  const fill = designerFill(detail.content, layer);
  const rationale = sectionBullets(detail.content, 'Rationale');
  const label = (id: string) => presentText(id, titles).text;
  return <div className="flex flex-col gap-8">
    <Section title="Rationale" description="Why this design decision was made.">
      {rationale.length ? <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed">{rationale.map((line, index) => <li key={index}><Prose value={line} titles={titles} /></li>)}</ul> : <Empty>No rationale recorded yet.</Empty>}
    </Section>
    {!fill ? <Section title="Fill"><Empty>This cell has no readable fill.</Empty></Section> : <>
      {fill.artwork.length > 0 && <Section title="Artwork" description="Each variant as the Designer drew it.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{fill.artwork.map(art => {
          const inverse = /revers|invers|dark|knockout/i.test(art.variant);
          return <figure key={art.variant} className="flex flex-col overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <div className={`flex h-36 items-center justify-center p-8 ${inverse ? 'bg-neutral-950' : 'bg-white'}`}>
              {/* An <img> renders the SVG inert: no script or event handlers run. */}
              <img alt={`${humanize(art.variant)} variant`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.svg)}`} className="size-full object-contain" />
            </div>
            <figcaption className="border-t px-3 py-2 text-xs text-muted-foreground">{humanize(art.variant)}</figcaption>
          </figure>;
        })}</div>
      </Section>}
      {fill.tokens.length > 0 && <Section title="Values" description="Light and dark values this token resolves to.">
        <Card className="py-0"><Table aria-label="Token values">
          <TableHeader><TableHead isRowHeader>Step</TableHead><TableHead>Light</TableHead><TableHead>Dark</TableHead></TableHeader>
          <TableBody>{fill.tokens.map(token => <TableRow key={`${token.token}-${token.step}`}>
            <TableCell className="font-medium">{humanize(token.step)}</TableCell>
            <TableCell><TokenValue value={token.value} color={token.color} resolve={aliasResolver(fill.tokens, false)} /></TableCell>
            <TableCell>{token.dark ? <TokenValue value={token.dark} color={token.color} resolve={aliasResolver(fill.tokens, true)} /> : /^\{/.test(token.value.trim()) ? <TokenValue value={token.value} color={token.color} resolve={aliasResolver(fill.tokens, true)} /> : <span className="text-muted-foreground">Same as light</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table></Card>
      </Section>}
      {fill.implementation && <Section title="Implementation"><p className="text-sm"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{fill.implementation}</code></p></Section>}
      {fill.slots.length > 0 && <Section title="Regions" description="Where each region of this frame is filled.">
        <Card className="py-0"><Table aria-label="Frame regions">
          <TableHeader><TableHead isRowHeader>Region</TableHead><TableHead>Filled by</TableHead></TableHeader>
          <TableBody>{fill.slots.map(([slot, port]) => <TableRow key={slot}><TableCell className="font-medium">{humanize(slot)}</TableCell><TableCell className="text-muted-foreground">{humanize(port)}</TableCell></TableRow>)}</TableBody>
        </Table></Card>
      </Section>}
      {fill.members.length > 0 && <Section title="Variants"><div className="flex flex-wrap gap-2">{fill.members.map(member => <Badge key={member} variant="secondary">{member.split('.').map(humanize).join(': ')}</Badge>)}</div></Section>}
      {fill.composes.length > 0 && <Section title="Composes" description="Components this cell is built from."><div className="flex flex-wrap gap-2">{fill.composes.map(part => <Badge key={part} variant="outline">{label(part)}</Badge>)}</div></Section>}
      {fill.reads.length > 0 && <Section title="Reads" description="Design values this cell depends on."><div className="flex flex-wrap gap-2">{fill.reads.map(read => <Badge key={read} variant="outline">{label(read)}</Badge>)}</div></Section>}
    </>}
  </div>;
}

type Resolve = (value: string) => { label?: string; value: string };

/** DTCG aliases (`{token.path.step}`) show the step they point to and its resolved value. */
function aliasResolver(tokens: readonly { token: string; step: string; value: string; dark?: string }[], dark: boolean): Resolve {
  return value => {
    const alias = /^\{([\w.-]+)\}$/.exec(value.trim())?.[1];
    if (!alias) return { value };
    const step = alias.split('.').pop() ?? alias;
    const target = tokens.find(entry => alias.endsWith(`${entry.token}.${entry.step}`)) ?? tokens.find(entry => entry.step === step);
    const resolved = target ? (dark ? target.dark ?? target.value : target.value) : '';
    return { label: humanize(step), value: /^\{/.test(resolved) ? '' : resolved };
  };
}

function TokenValue({ value, color, resolve }: { value: string; color: boolean; resolve: Resolve }) {
  const shown = resolve(value);
  return <span className="inline-flex items-center gap-2">
    {color && shown.value && <span aria-hidden className="size-4 shrink-0 rounded-sm ring-1 ring-foreground/15" style={{ background: shown.value }} />}
    {shown.label ? <span className="text-xs">Same as {shown.label}{shown.value && <code className="ml-1.5 font-mono text-muted-foreground">{shown.value}</code>}</span>
      : <code className="font-mono text-xs">{shown.value}</code>}
  </span>;
}

export function WriterDetail({ detail }: { detail: CellDetail }) {
  const projection = writerProjection(detail);
  const tone = [...new Set(projection.tone)];
  return <div className="flex flex-col gap-8">
    {tone.length > 0 && <Section title="Voice">
      <div className="flex flex-wrap gap-2">{tone.map(entry => <Badge key={entry} variant="secondary">{entry}</Badge>)}</div>
    </Section>}
    {projection.banned.length > 0 && <Section title="Words to avoid" description="The voice never uses these.">
      <div className="flex flex-wrap gap-2">{projection.banned.map(word => <Badge key={word} variant="outline" className="line-through decoration-muted-foreground/60">{word}</Badge>)}</div>
    </Section>}
    <Section title="Copy" description="Every string this cell supplies, in the order it appears." action={projection.locales.length > 0 ? <div className="flex flex-wrap justify-end gap-1.5">{projection.locales.map(locale => <Badge key={locale} variant="outline" aria-label={`Locale ${locale}`}>{locale.toUpperCase()}</Badge>)}</div> : undefined}>
      {projection.records.length ? <Card className="py-0"><Table aria-label="Copy records">
        <TableHeader><TableHead isRowHeader className="w-40">Context</TableHead><TableHead>Text</TableHead></TableHeader>
        <TableBody>{projection.records.map(record => {
          const shown = presentText(record.text ?? '');
          return <TableRow key={`${record.locale}-${record.id}`}>
            <TableCell className="align-top font-medium">{humanize(record.context)}</TableCell>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col items-start gap-1">
                <span className={shown.ownerInput ? 'text-muted-foreground' : undefined}>{shown.text || 'Awaiting copy'}</span>
                {shown.ownerInput && <Badge variant="secondary">Owner input</Badge>}
              </span>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></Card> : <Empty>This cell has no copy records yet.</Empty>}
    </Section>
  </div>;
}

type Publication = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: PublicationResponse };

export function PublisherDetail({ detail, index, revision }: { detail: CellDetail; index: AgentCells; revision: number }) {
  const [publication, setPublication] = useState<Publication>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setPublication({ state: 'loading' });
    loadPublication(controller.signal, selectedPublicationId(index, detail.id)).then(value => setPublication({ state: 'ready', value }), error => { if (!controller.signal.aborted) setPublication({ state: 'error', message: error instanceof Error ? error.message : 'Publication is unavailable.' }); });
    return () => controller.abort();
  }, [index, detail.id, revision]);
  const fields = detail.fields ?? {};
  const rows: [string, string][] = [
    ['Title', typeof fields.title === 'string' ? fields.title : humanize(detail.id)],
    ['Address', typeof fields.path === 'string' ? fields.path : 'Not set'],
    ['Kind', typeof fields.kind === 'string' ? humanize(fields.kind) : 'Page'],
  ];
  const page = publication.state === 'ready' && publication.value.state === 'ready' ? selectedPublishedPage(index, detail.id, publication.value.pages) : undefined;
  return <div className="flex flex-col gap-8">
    <Section title="Page">
      <Card className="py-0"><Table aria-label="Page fields">
        <TableHeader><TableHead isRowHeader className="w-40">Field</TableHead><TableHead>Value</TableHead></TableHeader>
        <TableBody>{rows.map(([label, value]) => <TableRow key={label}><TableCell className="font-medium">{label}</TableCell><TableCell>{value}</TableCell></TableRow>)}</TableBody>
      </Table></Card>
    </Section>
    <Section title="Publication" description="The emitted preview of this page.">
      {publication.state === 'loading' ? <Skeleton className="h-24 w-full" />
        : publication.state === 'error' ? <Empty>{publication.message}</Empty>
          : publication.value.state !== 'ready' ? <Card>
            <CardHeader>
              <CardTitle>{publication.value.state === 'missing' ? 'Not published yet' : 'Preview unreadable'}</CardTitle>
              <CardDescription>{publication.value.state === 'missing' ? '' : `${publication.value.message.replace(/\.$/, '')}. `}Run this command to emit a browser preview.</CardDescription>
            </CardHeader>
            <CardContent><code className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs"><TerminalIcon className="size-3.5" />{PUBLISH_PREVIEW_COMMAND}</code></CardContent>
          </Card>
            : page?.emitted && safePreviewUrl(page.previewUrl) ? <div><LinkButton variant="outline" href={page.previewUrl} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon data-icon="inline-start" />Open preview</LinkButton></div>
              : <Empty>This page is not part of the emitted publication yet.</Empty>}
    </Section>
  </div>;
}

export function AgentDetail({ agent, index, detail, titles, revision }: { agent: Agent; index: AgentCells; detail: CellDetail; titles: ReadonlyMap<string, string>; revision: number }) {
  if (agent === 'director') return <DirectorDetail detail={detail} titles={titles} />;
  if (agent === 'designer') return <DesignerDetail detail={detail} titles={titles} />;
  if (agent === 'writer') return <WriterDetail detail={detail} />;
  return <PublisherDetail detail={detail} index={index} revision={revision} />;
}
