import {
  resolveAdminDirectorCellTitle,
  type AdminCopy,
  type AdminCopyResolveOptions,
} from '@clossys/writer/admin-copy';

/** A host projection of titles from its actual Director brief, not a file schema.
 * The host owns loading and validating that brief; no source path is assumed. */
export interface DirectorBriefFactTitles {
  readonly reference: string;
  readonly facts: readonly { readonly id: string; readonly title?: unknown }[];
}

type WriterTitle = NonNullable<ReturnType<typeof resolveAdminDirectorCellTitle>>;
export type DirectorLabelProvenance = {
  readonly kind: 'writer-copy';
  readonly ref: WriterTitle['ref'];
  readonly binding: WriterTitle['binding'];
  readonly servedLocale: WriterTitle['servedLocale'];
  readonly status: WriterTitle['status'];
  readonly activation: WriterTitle['activation'];
} | {
  readonly kind: 'director-brief-fact';
  readonly reference: string;
  readonly factId: string;
  readonly field: 'title';
};

export type DirectorLabelResult = {
  readonly state: 'bound';
  readonly text: string;
  readonly role: 'heading' | 'source-label';
  readonly provenance: DirectorLabelProvenance;
} | {
  readonly state: 'need';
  readonly code: 'cell-title-unavailable' | 'brief-unavailable' | 'fact-title-unavailable';
  readonly message: string;
};

export interface DirectorCopyBindingOptions {
  readonly copy?: AdminCopy;
  readonly options?: AdminCopyResolveOptions;
  readonly brief?: DirectorBriefFactTitles;
}

export interface DirectorCopyBindings {
  readonly cellTitle: (cellId: string) => DirectorLabelResult;
  readonly factLabel: (factId: string) => DirectorLabelResult;
}

const nonblank = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const usable = (title: unknown, id: string): title is string => nonblank(title) && title.trim() !== id.trim() && !/\bfact\s*:/i.test(title);

/** Native card ports consume text only; source identities stay in provenance.
 * Preview approval policy must be selected explicitly by the host. Brief titles
 * retain Director provenance: transporting one does not create a Writer record. */
export function createDirectorCopyBindings({ copy, options, brief }: DirectorCopyBindingOptions = {}): DirectorCopyBindings {
  return {
    cellTitle(cellId) {
      let resolved: WriterTitle | undefined;
      try { resolved = resolveAdminDirectorCellTitle(cellId, copy, options); }
      catch { /* An unavailable or invalid host copy source cannot supply a title. */ }
      if (!resolved || !usable(resolved.text, cellId)) return { state: 'need', code: 'cell-title-unavailable', message: 'This card title is not available yet.' };
      return {
        state: 'bound', text: resolved.text, role: 'heading',
        provenance: {
          kind: 'writer-copy', ref: resolved.ref, binding: resolved.binding,
          servedLocale: resolved.servedLocale, status: resolved.status, activation: resolved.activation,
        },
      };
    },
    factLabel(factId) {
      if (!object(brief) || !nonblank(brief.reference) || !Array.isArray(brief.facts)) return { state: 'need', code: 'brief-unavailable', message: 'Source titles are not available yet.' };
      const matches = brief.facts.filter(fact => object(fact) && fact.id === factId);
      const fact = matches[0];
      if (!nonblank(factId) || matches.length !== 1 || !fact || !usable(fact.title, factId)) return { state: 'need', code: 'fact-title-unavailable', message: 'This source title is not available yet.' };
      return {
        state: 'bound', text: fact.title, role: 'source-label',
        provenance: { kind: 'director-brief-fact', reference: brief.reference, factId, field: 'title' },
      };
    },
  };
}
