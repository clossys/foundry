import type { ContractCopy } from '../sections/studio-contract';
import { studioCopy } from './studio-copy';

/** Resolve the existing Contract section labels from its pinned Writer records. */
export function contractCopy(): ContractCopy {
  return {
    title: studioCopy('studio.contract-title'),
    description: studioCopy('studio.contract-description'),
    factsLabel: studioCopy('studio.contract-facts-label'),
    inputsLabel: studioCopy('studio.contract-inputs-label'),
    fact: studioCopy('studio.contract-fact'),
    value: studioCopy('studio.contract-value'),
    input: studioCopy('studio.contract-input'),
    type: studioCopy('studio.contract-type'),
    required: studioCopy('studio.contract-required'),
    yes: studioCopy('studio.contract-yes'),
    no: studioCopy('studio.contract-no'),
    none: studioCopy('studio.contract-none'),
  };
}
