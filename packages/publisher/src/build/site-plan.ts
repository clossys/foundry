/**
 * Publisher and Writer input shapes the record suites and `publish --install` read, plus the
 * Writer text lookup. Pure: the caller reads every input.
 */

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** One `- <key>: writer:<cell>` bullet of a Publisher page cell. */
export interface PageCopyBinding { readonly key: string; readonly cell: string }
export interface PublisherEntry {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly kind: string;
  readonly path?: string;
  readonly slug?: string;
  readonly source?: { readonly frameId?: string; readonly sectionIds?: readonly string[] };
  readonly pin?: { readonly nav?: boolean; readonly footer?: boolean };
}
export interface PublisherRouteSlot {
  readonly section: string;
  readonly config?: string;
  readonly state?: string;
  readonly heldBy?: string;
  /** Host-injected data the Publisher owns (for example action destinations), keyed by contract field path. */
  readonly data?: Readonly<Record<string, Json>>;
}
export interface PublisherRoute {
  readonly instanceId: string;
  readonly path: string;
  readonly slots: readonly PublisherRouteSlot[];
  readonly requested?: readonly { readonly agent?: string; readonly section?: string; readonly config?: string }[];
}
export interface PublisherInput {
  readonly publicationId: string;
  /** The content map's format (`web.page.responsive`, `deck.16x9`, ...). */
  readonly format?: string;
  readonly entries: readonly PublisherEntry[];
  readonly routes: readonly PublisherRoute[];
  /** Page cell id → Copy bullets; entry id → page cell id. */
  readonly copy: Readonly<Record<string, readonly PageCopyBinding[]>>;
  readonly cellOfEntry: Readonly<Record<string, string>>;
}

export interface WriterRecord { readonly id: string; readonly context?: string; readonly text: string }
export interface WriterSectionBinding {
  readonly sectionId: string;
  readonly configId: string;
  readonly fields: readonly { readonly key: string; readonly ref: { readonly id: string } }[];
}
export interface WriterInput {
  readonly aliases: Readonly<Record<string, string>>;
  readonly records: readonly WriterRecord[];
  readonly sections: readonly WriterSectionBinding[];
}

/** Writer text by alias (`<cell>.<key>`), falling back to a record whose context is that alias. */
export function writerText(writer: WriterInput) {
  const byId = new Map(writer.records.map(record => [record.id, record]));
  const byContext = new Map(writer.records.filter(record => record.context).map(record => [record.context!, record]));
  return {
    alias(alias: string): string | undefined {
      const id = Object.hasOwn(writer.aliases, alias) ? writer.aliases[alias] : undefined;
      const record = (id ? byId.get(id) : undefined) ?? byContext.get(alias);
      return typeof record?.text === "string" && record.text.trim() ? record.text : undefined;
    },
    record(id: string): string | undefined {
      const text = byId.get(id)?.text;
      return typeof text === "string" && text.trim() ? text : undefined;
    },
  };
}
