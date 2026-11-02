import { lstatSync } from 'node:fs';
import { listCandidateNames, readCandidate, readIa, readPin, readSlot } from '../records/slots.js';
import {
  SLOT_AGENTS, pinFile, slotDir, slotFile, slotPositions, validateCandidate, validateSlotDoc,
  type SlotAgent, type SlotDoc, type SlotPosition,
} from '../records/slot-model/index.js';

export interface SlotCensusRow {
  id: string;
  agent: SlotAgent;
  folder: 'present' | 'missing' | 'error';
  candidates: string[];
  slot: 'valid' | 'missing' | 'invalid' | 'error';
  pin: 'valid' | 'missing' | 'invalid' | 'missing-candidate' | 'hash-drift' | 'invalid-candidate' | 'unvalidated-candidate' | 'error';
  /** The candidate directory could not be read safely. */
  candidatesError?: true;
}

export type SlotCensus =
  | { state: 'ready'; total: number; withCandidate: number; pinned: number; rows: SlotCensusRow[] }
  | { state: 'error'; message: string };

function presence(path: string): 'present' | 'missing' | 'error' {
  try { lstatSync(path); return 'present'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'; }
}

function censusRow(consumer: string, agent: SlotAgent, id: string, position: SlotPosition) {
  const dir = slotDir(consumer, agent, position, id);
  const folder = presence(dir);
  const row: SlotCensusRow = { id, agent, folder, candidates: [], slot: 'missing', pin: 'missing' };
  try { row.candidates = listCandidateNames(dir); } catch { row.candidatesError = true; }
  let doc: SlotDoc | undefined;
  const slotPresence = presence(slotFile(dir));
  if (slotPresence === 'present') {
    try {
      const value = readSlot(consumer, agent, id);
      if (validateSlotDoc(value).length || value.id !== id || value.agent !== agent ||
          value.ia.l0 !== position.l0 || value.ia.l1 !== position.l1 ||
          value.ia.l2 !== position.l2 || value.ia.order !== position.order) row.slot = 'invalid';
      else { row.slot = 'valid'; doc = value; }
    } catch (error) {
      // readSlot currently exposes validation failures as these two untyped errors.
      // Unknown errors stay errors if the reader's wording changes. Never return the message.
      const validationError = error instanceof Error && (
        error.message === `Invalid ${agent} slot ${id}` ||
        error.message === `Slot ${agent}/${id} does not match its IA position`
      );
      row.slot = error instanceof SyntaxError || validationError ? 'invalid' :
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error';
    }
  } else if (slotPresence === 'error') row.slot = 'error';

  const pinPresence = presence(pinFile(dir));
  let countedPin = false;
  if (pinPresence === 'present') {
    try {
      const pin = readPin(consumer, agent, id);
      if (!pin) row.pin = 'invalid';
      else {
        countedPin = true;
        try {
          const candidate = readCandidate(consumer, agent, id, pin.candidate);
          if (candidate.sha256 !== pin.sha256) row.pin = 'hash-drift';
          else if (!doc) row.pin = 'unvalidated-candidate';
          else if (validateCandidate(doc.kind, id, candidate.name, candidate.bytes).length) row.pin = 'invalid-candidate';
          else row.pin = 'valid';
        } catch (error) {
          row.pin = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-candidate' : 'error';
        }
      }
    } catch { row.pin = 'error'; }
  } else if (pinPresence === 'error') row.pin = 'error';
  return { row, countedPin };
}

/** Inventory only: candidate versions, rendering and input readiness do not change these counts. */
export function agentSlotCensus(consumer: string, agent: SlotAgent): SlotCensus {
  try {
    const ia = readIa(consumer, agent);
    if (!ia) throw new Error('No slot IA');
    const entries = [...slotPositions(agent, ia)].map(([id, position]) => censusRow(consumer, agent, id, position));
    return {
      state: 'ready', total: entries.length,
      withCandidate: entries.filter(entry => entry.row.candidates.length > 0).length,
      pinned: entries.filter(entry => entry.countedPin).length,
      rows: entries.map(entry => entry.row),
    };
  } catch {
    // Filesystem/validation exceptions can contain private paths or candidate content.
    return { state: 'error', message: 'The slot census could not load.' };
  }
}

/** A failed agent never discards another agent's successful inventory. */
export function slotCensus(consumer: string): Record<SlotAgent, SlotCensus> {
  return Object.fromEntries(SLOT_AGENTS.map(agent => [agent, agentSlotCensus(consumer, agent)])) as Record<SlotAgent, SlotCensus>;
}
