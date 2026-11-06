import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldGroup, LinkButton } from '@clossys/designer-ui';

export type SlotTone = 'secondary' | 'outline' | 'destructive';

/**
 * What a slot card previews of its pin: a view-only frame of the rendered output, the record's
 * lead lines, its status, or a note when it has none. The detail page's specimen renders the full record.
 */
export type SlotPreview = { name: string } & (
  | { kind: 'viewports'; specimens: readonly { viewport: 375 | 768 | 1280; light: string; title: string }[]; empty: string }
  | { kind: 'record'; lead?: readonly string[]; status?: { label: string; tone: SlotTone; description: string }; empty: string }
);

/** One slot card: the slot, its shown state and the route of its detail page. */
export interface SlotCard {
  id: string;
  name: string;
  href: string;
  statusLabel: string;
  statusTone: SlotTone;
  version?: number;
  /** The shown version as displayed (Writer copy), when there is one. */
  versionLabel?: string;
  /** What the slot's pin produces at card size. */
  specimen: SlotPreview;
}

/** One IA group of the active tab: its label and its slots, in IA order. */
export interface SlotGroup {
  id: string;
  label: string;
  cards: readonly SlotCard[];
}

/** The `groups` input of `sections.studio.slot-groups`. */
export interface SlotGroupsInput {
  empty: string;
  groups: readonly SlotGroup[];
}

/** A gallery card's view-only frame height in CSS px. */
const CARD_FRAME_HEIGHT = 480;

/** The two projected specimen route shapes: Producer's specimen frame and a Publisher page preview (a shape, not a route this section links to). */
const PROJECTED_ROUTE = /^\/(?:__specimen$|preview\/)/;

/** Only already-projected local specimen routes are framed; never arbitrary URLs. */
function cardSource(src: string): string {
  if (/[\\\s\u0000-\u001f\u007f]/.test(src) || !src.startsWith('/') || src.startsWith('//')) throw new Error('Expected a local specimen route');
  const path = new URL(src, 'https://example.com').pathname;
  if (!PROJECTED_ROUTE.test(path)) throw new Error('Expected a projected specimen route');
  return src;
}

function CardPreview({ preview }: { preview: SlotPreview }) {
  if (preview.kind === 'viewports') {
    const frame = [...preview.specimens].sort((a, b) => b.viewport - a.viewport)[0];
    if (!frame) return <CardContent><Badge variant="outline" data-preview-status="empty">{preview.empty}</Badge></CardContent>;
    return <CardContent data-specimen-viewport={frame.viewport}>
      <iframe key={`${preview.name}:${frame.viewport}:card`} src={cardSource(frame.light)} title={frame.title} loading="lazy" inert width="100%" height={CARD_FRAME_HEIGHT} />
    </CardContent>;
  }
  if (preview.lead?.length) return <CardContent data-specimen-lead>
    {preview.lead.map((text, index) => <CardDescription key={index}>{text}</CardDescription>)}
  </CardContent>;
  if (preview.status) return <CardContent>
    <Badge variant={preview.status.tone} data-preview-status="status">{preview.status.label}</Badge>
    <CardDescription>{preview.status.description}</CardDescription>
  </CardContent>;
  return <CardContent><Badge variant="outline" data-preview-status="empty">{preview.empty}</Badge></CardContent>;
}

/** `sections.studio.slot-groups`: the active tab's IA groups, stacked, each a run of stock shadcn slot cards. */
export default function SlotGroupsSection({ groups, ...provenance }: { groups: SlotGroupsInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <CardContent {...provenance}>
    {groups.groups.length ? groups.groups.map(group => <section key={group.id} id={group.id} aria-label={group.label}>
      <CardTitle role="heading" aria-level={2}>{group.label}</CardTitle>
      <FieldGroup>
        {group.cards.map(card => <Card key={card.id} size="sm" data-slot-card={card.id}>
          <CardHeader>
            <CardTitle>
              <LinkButton href={card.href} variant="link" size="sm">{card.name}</LinkButton>
              {card.versionLabel ? <Badge variant="ghost">{card.versionLabel}</Badge> : null}
              <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
            </CardTitle>
            <CardDescription>{card.id}</CardDescription>
          </CardHeader>
          <CardPreview preview={card.specimen} />
        </Card>)}
      </FieldGroup>
    </section>) : <CardDescription>{groups.empty}</CardDescription>}
  </CardContent>;
}
