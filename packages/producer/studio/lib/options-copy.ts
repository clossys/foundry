import type { OptionCopy, OptionRow, OptionsCopy } from '../sections/studio-options';
import { studioCopy } from './studio-copy';

/** Existing Options labels, resolved from pinned Writer records. */
export function optionsCopy(): OptionsCopy {
  return {
    title: studioCopy('studio.options-title'),
    key: studioCopy('studio.options-key'),
    text: studioCopy('studio.options-text'),
    changeLabels: {
      added: studioCopy('studio.options-added'),
      changed: studioCopy('studio.options-changed'),
      removed: studioCopy('studio.options-removed'),
      same: studioCopy('studio.options-same'),
    },
  };
}

/** Preserve plain version interpolation and the existing pin/option wording. */
export function optionCopy(name: string, row: Pick<OptionRow, 'version' | 'pinned'>): OptionCopy {
  const values = { name, version: String(row.version) };
  return {
    frameTitle: studioCopy(row.pinned ? 'studio.options-pinned-title' : 'studio.options-option-title', values),
    stringsLabel: studioCopy('studio.options-strings-label', values),
  };
}
