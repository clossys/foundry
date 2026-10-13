import { RecordLedger, type RecordLedgerProps } from "./RecordLedger.js";
// @ts-expect-error The retired pair type is absent from the direct public module.
import type { LedgerPairData as DirectPair } from "./RecordLedger.js";
// @ts-expect-error The retired pair type is absent from the blocks barrel.
import type { LedgerPairData as BlocksPair } from "./index.js";
// @ts-expect-error The retired pair type is absent from the server barrel.
import type { LedgerPairData as ServerPair } from "./server.js";
// @ts-expect-error The retired pair type is absent from the root barrel.
import type { LedgerPairData as RootPair } from "../index.js";

const record: RecordLedgerProps = { form: "record", id: "record", head: { title: "Record" }, groups: [{ id: "checks", label: "Checks", rows: [{ id: "one", label: "Review" }] }], caption: "Sample data." };
void <RecordLedger {...record} />;
// @ts-expect-error Pair mode is retired from the public RecordLedger contract.
void <RecordLedger form="pairs" items={[]} productLabel="Creates:" />;
// @ts-expect-error Record fields cannot make a retired pair discriminator valid.
void <RecordLedger {...record} form="pairs" />;
// @ts-expect-error A record needs its stable instance id.
void <RecordLedger form="record" head={{ title: "Record" }} groups={record.groups} caption="Sample data." />;
