/**
 * The consumer-layout contract's state folder (docs/contracts/consumer-layout.json (not shipped), `stateDir`): where
 * the clossys CLI keeps its machine files, the local run store `runs/` among them. Director cannot import the Producer
 * (the Producer depends on it), so it holds the one value here; state-dir.test.ts pins it to the contract.
 */
export const STATE_DIR = "clossys/.state";
